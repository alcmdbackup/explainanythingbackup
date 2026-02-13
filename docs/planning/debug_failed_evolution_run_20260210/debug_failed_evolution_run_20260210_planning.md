# Debug Failed Evolution Run Plan

## Background
Evolution run 5db6fadd failed at COMPETITION iteration 10 due to an unhandled DeepSeek API socket timeout in IterativeEditingAgent. The agent's main edit loop has unprotected LLM calls that propagate transient network errors as fatal run failures. GenerationAgent survived the same timeout in the same iteration because it uses Promise.allSettled. This project will audit all agents for unprotected LLM calls, add pipeline-level retry for transient errors, and improve error categorization to prevent transient network issues from killing long-running evolution runs.

## Requirements (from GH Issue #402)
1. **Audit all agents for unprotected LLM calls** — Check every agent's execute() method for bare `await llmClient.complete()` or `callLLM()` calls not wrapped in try-catch. Agents to audit: IterativeEditingAgent, SectionDecompositionAgent, DebateAgent, EvolutionAgent, TreeSearchAgent, OutlineGenerationAgent, CalibrationRanker, Tournament.

2. **Fix IterativeEditingAgent** — Wrap the edit generation (line 88) and diff comparison (line 100) in try-catch. On transient error, increment `consecutiveRejections` and `continue` the loop rather than crashing.

3. **Fix other agents with unprotected calls** — Apply the same pattern: catch transient errors, log them, and gracefully degrade (skip that operation) rather than crash.

4. **Add pipeline-level retry in `runAgent()`** — For transient `FetchError`/socket timeout errors, retry the agent 1-2 times with exponential backoff before marking the run as failed.

5. **Improve error categorization** — Add a `isTransientError()` helper that identifies socket timeouts, connection resets, 429 rate limits, and 5xx server errors as retryable.

6. **Add unit tests** — Test transient error handling in IterativeEditingAgent and the pipeline retry logic.

7. **Update documentation** — Update evolution/reference.md error recovery table with new retry behavior.

## Problem
Evolution pipeline runs are expensive, long-running operations (67+ minutes, $15 budgets). A single transient network error from any LLM provider (DeepSeek socket timeout, OpenAI 429, etc.) can crash an entire run, losing all progress accumulated over dozens of iterations. The pipeline has no concept of "retryable" errors — every non-budget error is treated as fatal. Five of twelve agents have fully protected LLM calls, but the remaining agents (including IterativeEditingAgent, the most edit-intensive agent) have unprotected bare awaits that propagate transient errors as run-killing crashes.

## Options Considered

### Option A: Agent-level fixes only
- Wrap unprotected LLM calls in each agent with try-catch
- **Pro:** Minimal change footprint, each agent handles its own errors
- **Con:** No pipeline-level safety net; new agents could repeat the same mistake

### Option B: Pipeline-level retry only
- Add retry logic in `runAgent()` for transient errors
- **Pro:** Single point of defense, covers all agents automatically
- **Con:** Retrying an entire agent is expensive (re-runs all LLM calls in that agent); doesn't address agents that could gracefully skip a single failed call

### Option C: Both agent-level + pipeline-level (CHOSEN)
- Agent-level: Wrap unprotected calls so agents degrade gracefully on single-call failures
- Pipeline-level: Add retry with backoff in `runAgent()` as a safety net for errors that agents can't handle (e.g., error in `canExecute()`, error in state mutation)
- **Pro:** Defense in depth — agents handle common cases, pipeline handles edge cases
- **Con:** More code to write and test; must be careful not to double-retry

### Option D: SDK-level timeout increase
- Increase `maxRetries` and `timeout` in llms.ts client configs
- **Pro:** Zero changes to evolution code
- **Con:** Doesn't solve the structural problem; longer timeouts just delay the crash

## Phased Execution Plan

### Phase 1: Error Classification Infrastructure
**Files:** 1 new (`core/errorClassification.ts`), 1 new test (`core/errorClassification.test.ts`), 1 export added (`src/lib/evolution/index.ts`)

1. Create `src/lib/evolution/core/errorClassification.ts`:
   ```typescript
   /**
    * Classifies errors as transient (retryable) or fatal.
    * Used by agents for graceful degradation and by pipeline for retry logic.
    *
    * NOTE: This is evolution-pipeline specific. See /src/lib/errorHandling.ts
    * for global error categorization (categorizeError).
    */
   import { APIConnectionError, RateLimitError, InternalServerError } from 'openai';

   export function isTransientError(error: unknown): boolean {
     if (!(error instanceof Error)) return false;

     // OpenAI SDK typed error classes (works for DeepSeek too since it uses OpenAI SDK)
     // Note: APIConnectionTimeoutError extends APIConnectionError, so it's covered by inheritance.
     if (error instanceof APIConnectionError) return true;
     if (error instanceof RateLimitError) return true;
     if (error instanceof InternalServerError) return true;

     // Walk the cause chain — middleware/wrappers may nest the original SDK error
     if ('cause' in error && error.cause instanceof Error) {
       return isTransientError(error.cause);
     }

     const msg = error.message.toLowerCase();
     // Socket/network errors
     if (msg.includes('socket timeout')) return true;
     if (msg.includes('econnreset')) return true;
     if (msg.includes('econnrefused')) return true;
     if (msg.includes('etimedout')) return true;
     if (msg.includes('fetch failed')) return true;
     // HTTP status codes (for non-SDK errors)
     if (/\b(429|408|500|502|503|504)\b/.test(msg)) return true;
     if (msg.includes('rate limit')) return true;
     if (msg.includes('internal server error')) return true;
     if (msg.includes('bad gateway')) return true;
     if (msg.includes('service unavailable')) return true;
     if (msg.includes('gateway timeout')) return true;
     return false;
   }
   ```

2. Export from `src/lib/evolution/index.ts` (the barrel export — note: `core/index.ts` does not exist):
   ```typescript
   export { isTransientError } from './core/errorClassification';
   ```

3. Write unit test `src/lib/evolution/core/errorClassification.test.ts`:
   - Test each message pattern (socket timeout, ECONNRESET, 429, 5xx, 408, etc.)
   - Test OpenAI SDK error class instances using correct constructors:
     - `new APIConnectionError({ message: 'Connection failed', cause: undefined })` — named-object constructor
     - `new RateLimitError(429, undefined, 'Rate limited', undefined as any)` — extends `APIError(status, error, message, headers)`
     - `new InternalServerError(500, undefined, 'Internal server error', undefined as any)` — same 4-arg constructor
     - Note: `APIConnectionTimeoutError` extends `APIConnectionError` so `instanceof APIConnectionError` covers it
   - Test error.cause chain: `new Error('Wrapper', { cause: new APIConnectionError({...}) })` should return true
   - Test non-transient errors return false (BudgetExceededError, ZodError, LLMRefusalError, generic Error)
   - Test non-Error inputs return false (string, null, undefined, plain object)
   - ~18 test cases total

**Verification:** `npm test -- errorClassification`

### Phase 2: Fix IterativeEditingAgent (Critical Path)
**Files modified:** `src/lib/evolution/agents/iterativeEditingAgent.ts` (1 file)

Wrap the edit generation (line 88) and diff comparison (line 100) in a try-catch inside the existing `for` loop (line 71). The try block covers lines 86-127 (the entire edit→validate→judge→accept/reject block):

```typescript
// Inside the for loop (line 71), wrap the edit→judge block:
try {
  // EDIT: generate targeted fix
  const editPrompt = buildEditPrompt(current.text, editTarget);
  const editedText = await llmClient.complete(editPrompt, this.name);

  // Validate format
  const formatResult = validateFormat(editedText);
  if (!formatResult.valid) {
    logger.warn('Edit failed format validation', { cycle, issues: formatResult.issues });
    consecutiveRejections++;
    continue;
  }

  // JUDGE: callLLM closure defined here, inside the try block
  const callLLM = (prompt: string) =>
    llmClient.complete(prompt, this.name, { model: ctx.payload.config.judgeModel });
  const result = await compareWithDiff(current.text, editedText, callLLM);

  // ... accept/reject logic unchanged (lines 102-127) ...
} catch (error) {
  if (error instanceof BudgetExceededError) throw error;
  logger.warn('Edit cycle failed, treating as rejection', {
    cycle,
    error: error instanceof Error ? error.message : String(error),
    isTransient: isTransientError(error),
  });
  consecutiveRejections++;
  continue;
}
```

**Key design decisions:**
- BudgetExceededError is re-thrown (consistent with all other agents)
- All other errors (transient or not) increment `consecutiveRejections` and continue the loop
- After `maxConsecutiveRejections` (default 3), the agent stops gracefully and returns `success: false`
- The callLLM closure is defined INSIDE the try block so compareWithDiff errors are caught
- No distinction between transient and permanent errors at agent level — the agent degrades the same way. The `isTransient` field is logged for observability only.

**Test additions in `iterativeEditingAgent.test.ts`:**

Use existing test patterns (`makeMockLLMClient`, `mockRejectedValueOnce`):

```typescript
it('catches transient LLM error in edit loop and continues', async () => {
  const mockClient = makeMockLLMClient();
  // First call: runOpenReview succeeds (returns null via internal catch)
  // Second call: edit generation throws socket timeout
  (mockClient.complete as jest.Mock)
    .mockResolvedValueOnce(VALID_OPEN_REVIEW)    // runOpenReview
    .mockRejectedValueOnce(new Error('Socket timeout'))  // edit generation
    .mockResolvedValueOnce(VALID_OPEN_REVIEW);   // if loop continues
  const ctx = makeCtx({ llmClient: mockClient });
  const result = await agent.execute(ctx);
  expect(result.success).toBe(false);  // no variants added
  expect(result.variantsAdded).toBe(0);
});

it('re-throws BudgetExceededError from edit generation', async () => {
  const mockClient = makeMockLLMClient();
  (mockClient.complete as jest.Mock)
    .mockResolvedValueOnce(VALID_OPEN_REVIEW)
    .mockRejectedValueOnce(new BudgetExceededError('iterativeEditing', 1.0, 0.5));
  const ctx = makeCtx({ llmClient: mockClient });
  await expect(agent.execute(ctx)).rejects.toThrow(BudgetExceededError);
});

it('catches transient error in compareWithDiff and continues', async () => {
  const mockClient = makeMockLLMClient();
  (mockClient.complete as jest.Mock)
    .mockResolvedValueOnce(VALID_OPEN_REVIEW)
    .mockResolvedValueOnce(VALID_ARTICLE);  // edit generation succeeds
  mockCompareWithDiff.mockRejectedValueOnce(new Error('ECONNRESET'));
  const ctx = makeCtx({ llmClient: mockClient });
  const result = await agent.execute(ctx);
  expect(result.success).toBe(false);
  expect(result.variantsAdded).toBe(0);
});

it('exhausts maxConsecutiveRejections on repeated transient errors', async () => {
  const mockClient = makeMockLLMClient();
  // All edit calls throw transient errors
  (mockClient.complete as jest.Mock)
    .mockResolvedValueOnce(VALID_OPEN_REVIEW)
    .mockRejectedValue(new Error('Socket timeout'));
  const ctx = makeCtx({ llmClient: mockClient });
  const result = await agent.execute(ctx);
  expect(result.success).toBe(false);
  expect(result.variantsAdded).toBe(0);
  // Agent should have stopped after maxConsecutiveRejections (default 3)
});
```

**Verification:** `npm test -- iterativeEditingAgent`

### Phase 3: Fix Other Agents with Unprotected Calls
**Files modified:** `calibrationRanker.ts`, `diffComparison.ts`, `comparison.ts` (3 files)

#### 3a. CalibrationRanker — Add BudgetExceededError re-throw from allSettled

In `calibrationRanker.ts`, add a BudgetExceededError scan after EACH of the two `Promise.allSettled` result processing blocks. Insert after the fulfilled-result processing loop at ~line 154 (end of first batch) and ~line 179 (end of second batch):

```typescript
// After processing fulfilled results from first allSettled batch (~line 154):
for (const r of results) {
  if (r.status === 'rejected' && r.reason instanceof BudgetExceededError) {
    throw r.reason;
  }
}

// Same pattern after second allSettled batch (~line 179):
for (const r of remainingResults) {
  if (r.status === 'rejected' && r.reason instanceof BudgetExceededError) {
    throw r.reason;
  }
}
```

This matches the pattern already used by Tournament at lines 296-300.

**Test additions in `calibrationRanker.test.ts`:**
```typescript
it('re-throws BudgetExceededError from allSettled rejected promises', async () => {
  // Mock one comparison to reject with BudgetExceededError
  // Verify it propagates after processing fulfilled results
});
```

#### 3b. Document caller contract for diffComparison.ts and comparison.ts

Add JSDoc to `compareWithDiff` function signature (diffComparison.ts, line ~35):
```typescript
/**
 * Diff-based comparison with direction-reversal bias mitigation.
 * Makes 2 sequential LLM calls via callLLM callback. Does NOT catch errors —
 * callers must handle LLM failures. Known callers:
 * - IterativeEditingAgent (line 100) — protected by try-catch (Phase 2 fix)
 * - sectionEditRunner (line 71) — protected by parent Promise.allSettled
 * - beamSearch (line 70) — protected by try-catch
 */
```

Same pattern for `compareWithBiasMitigation` in comparison.ts (line ~37):
```typescript
/**
 * Bias-mitigated pairwise comparison (A vs B + B vs A).
 * Makes 2 sequential LLM calls via callLLM callback. Does NOT catch errors —
 * callers must handle LLM failures.
 */
```

**Verification:** `npm test -- calibrationRanker`

### Phase 4: Pipeline-Level Retry in runAgent()
**Files modified:** `src/lib/evolution/core/pipeline.ts` (1 file)

#### 4a. No-Rollback Retry Design

**Design decision: NO state rollback on retry.**

The previous iteration's plan proposed snapshotting and restoring pool/entrants state. All 3 reviewers flagged this as unsafe because:
- Truncating `pool.length` orphans entries in `poolIds` Set, `ratings` Map, `matchCounts` Map
- `newEntrantsThisIteration` is `string[]` not `Set<string>`
- `CostTracker` FIFO queue has complex multi-reservation semantics

**Instead, we simply re-run the agent without rollback.** This is safe because:
- **No duplicate variants:** Each agent call generates new `uuid4()` IDs. The failed attempt may leave 0-N partial variants in the pool, but they have unique IDs and won't conflict with retry variants.
- **Append-only pool:** Extra variants from the failed attempt are harmless — they have no ratings yet (CalibrationRanker hasn't run) and will naturally sink in Elo if low quality.
- **Idempotent pool dedup:** `addToPool()` checks `poolIds.has(variation.id)` (state.ts:47), preventing any theoretical re-add.
- **CostTracker safety:** Failed attempt's `recordSpend()` calls for completed LLM calls are already committed (correct). The one dangling reservation from the failed call is small (single LLM call estimate) and is popped FIFO by the next `recordSpend()`. Budget accounting may be slightly inflated but never underestimated.
- **Ratings/matches from partial attempt:** Harmless — they represent valid comparison results and don't need to be undone. Re-ranking in subsequent agents corrects any drift.

```typescript
async function runAgent(
  runId: string,
  agent: PipelineAgent,
  ctx: ExecutionContext,
  phase: PipelinePhase,
  logger: EvolutionLogger,
  maxRetries: number = 1,
): Promise<AgentResult | null> {
  if (!agent.canExecute(ctx.state)) {
    logger.debug('Skipping agent (preconditions not met)', { agent: agent.name, phase });
    return null;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const agentSpan = createAppSpan(`evolution.agent.${agent.name}`, {
      agent: agent.name,
      iteration: ctx.state.iteration,
      phase,
      attempt,
    });

    try {
      logger.debug('Executing agent', { agent: agent.name, iteration: ctx.state.iteration, phase, attempt });
      const result = await agent.execute(ctx);
      agentSpan.setAttributes({
        success: result.success ? 1 : 0,
        cost_usd: result.costUsd,
        variants_added: result.variantsAdded ?? 0,
      });
      logger.info('Agent completed', {
        agent: agent.name,
        success: result.success,
        costUsd: result.costUsd,
        variantsAdded: result.variantsAdded,
        matchesPlayed: result.matchesPlayed,
      });
      await persistCheckpoint(runId, ctx.state, agent.name, phase, logger);
      return result;
    } catch (error) {
      agentSpan.recordException(error as Error);
      agentSpan.setStatus({ code: 2, message: (error as Error).message });

      if (error instanceof BudgetExceededError) {
        // Budget errors are never retried — pause immediately
        await persistCheckpoint(runId, ctx.state, agent.name, phase, logger).catch(() => {});
        logger.warn('Budget exceeded, pausing run', { agent: agent.name, error: error.message });
        await markRunPaused(runId, error);
        throw error;
      }

      // Retry transient errors (attempt < maxRetries means we have retries left)
      if (isTransientError(error) && attempt < maxRetries) {
        const backoffMs = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s...
        logger.warn('Agent failed with transient error, retrying', {
          agent: agent.name,
          attempt: attempt + 1,
          maxRetries,
          backoffMs,
          error: (error as Error).message,
        });
        // No state rollback — partial mutations are safe (see design notes above)
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      // Fatal error or retries exhausted — persist checkpoint and fail
      await persistCheckpoint(runId, ctx.state, agent.name, phase, logger).catch(() => {});
      logger.error('Agent failed', { agent: agent.name, error: String(error), attempts: attempt + 1 });
      await markRunFailed(runId, agent.name, error);
      throw error;
    } finally {
      agentSpan.end();
    }
  }
  // Unreachable, but TypeScript needs it
  throw new Error('Unreachable: runAgent loop exhausted without return or throw');
}
```

#### 4b. Call-Site Updates

All 6 `runAgent()` call sites in `pipeline.ts` (lines 914, 933, 975, 982, 987, 992) use the new `maxRetries` parameter with the default value of 1, so **no call-site changes are needed**. The default is applied automatically. If we want to disable retry for specific agents in the future, we can pass `maxRetries: 0` at those call sites.

#### 4c. Why No Rollback is the Right Choice

| Concern | Why Safe Without Rollback |
|---------|--------------------------|
| Duplicate variants | New uuid4() on retry; addToPool dedup via poolIds |
| Extra partial variants | Append-only pool; no Elo yet; will sink naturally |
| Cost double-counting | recordSpend() already committed for completed calls; one dangling reservation is small and consumed FIFO |
| Rating corruption | Partial ratings from valid comparisons; re-ranking corrects drift |
| newEntrantsThisIteration | May have extra IDs; CalibrationRanker will compare them again (idempotent via comparison cache) |

#### 4d. Testing runAgent() Retry

Since `runAgent` is a **private** function in pipeline.ts, we test it through `executeFullPipeline`. We add a new `describe` block in the **existing** `src/lib/evolution/core/pipeline.test.ts` to reuse the mock infrastructure already set up there (Supabase, instrumentation, helper factories).

**Note on retry amplification:** The SDK retries 3 times internally (`maxRetries: 3` in llms.ts), then our pipeline-level retry re-runs the entire agent once (`maxRetries: 1` default). For a persistent transient error, total LLM call attempts = `(3+1 SDK) * (1+1 pipeline) = 8`. This is intentional defense-in-depth but must be documented in Phase 5 error handling docs.

**Note on OTel spans:** The retry loop creates one span per attempt (not one for the whole runAgent call). This is intentional — each attempt should be a separate traceable operation. Transient retries do NOT persist a checkpoint (to minimize latency); checkpoints are only persisted on BudgetExceededError and on final failure (retries exhausted or fatal error).

**Add to existing `pipeline.test.ts`:**

```typescript
// Uses existing mocks: jest.mock('@/lib/utils/supabase/server'), jest.mock('instrumentation')
// Uses existing helpers: makeMockLogger, PipelineStateImpl
// IMPORT ADDITION: Add BudgetExceededError to the import from '../types' at line 8:
//   import { BASELINE_STRATEGY, EvolutionRunSummarySchema, BudgetExceededError } from '../types';

describe('executeFullPipeline — runAgent retry on transient errors', () => {
  // Reuse the existing makeSpyAgent/makeAllAgents pattern from the iterativeEditing describe block
  function makeSpyAgent(name: string, executionOrder: string[]): PipelineAgent {
    return {
      name,
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockImplementation(async () => {
        executionOrder.push(name);
        return { success: true, costUsd: 0, variantsAdded: 0, matchesPlayed: 0 };
      }),
    };
  }

  function makeIntegrationCtx(budgetCalls: number[]): ExecutionContext {
    const config = resolveConfig({
      maxIterations: 5,
      expansion: { maxIterations: 1, minPool: 5, diversityThreshold: 0.25, minIterations: 3 },
      plateau: { window: 2, threshold: 0.02 },
    });
    const state = new PipelineStateImpl('Test article text.');
    let budgetIdx = 0;
    const costTracker: CostTracker = {
      reserveBudget: jest.fn().mockResolvedValue(undefined),
      recordSpend: jest.fn(),
      getAgentCost: jest.fn().mockReturnValue(0),
      getTotalSpent: jest.fn().mockReturnValue(0),
      getAvailableBudget: jest.fn(() => budgetCalls[budgetIdx++] ?? 0.005),
      getAllAgentCosts: jest.fn().mockReturnValue({}),
    };
    return {
      payload: { originalText: state.originalText, title: 'Test', explanationId: 1, runId: 'retry-test', config },
      state,
      llmClient: { complete: jest.fn(), completeStructured: jest.fn() } as unknown as EvolutionLLMClient,
      logger: makeMockLogger(),
      costTracker,
      runId: 'retry-test',
    };
  }

  function makeAllAgentsWithOverride(
    executionOrder: string[],
    overrides: Partial<Record<keyof PipelineAgents, PipelineAgent>>,
  ): PipelineAgents {
    return {
      generation: makeSpyAgent('generation', executionOrder),
      calibration: makeSpyAgent('calibration', executionOrder),
      tournament: makeSpyAgent('tournament', executionOrder),
      evolution: makeSpyAgent('evolution', executionOrder),
      reflection: makeSpyAgent('reflection', executionOrder),
      iterativeEditing: makeSpyAgent('iterativeEditing', executionOrder),
      debate: makeSpyAgent('debate', executionOrder),
      proximity: makeSpyAgent('proximity', executionOrder),
      metaReview: makeSpyAgent('metaReview', executionOrder),
      ...overrides,
    };
  }

  const pipelineOpts = {
    supervisorResume: { phase: 'COMPETITION' as const, strategyRotationIndex: 0, ordinalHistory: [], diversityHistory: [] },
    // Disable agents not provided in makeAllAgentsWithOverride to prevent undefined agent access
    featureFlags: { ...DEFAULT_EVOLUTION_FLAGS, sectionDecompositionEnabled: false },
    startMs: Date.now(),
  };

  it('retries agent on transient error and succeeds on second attempt', async () => {
    const executionOrder: string[] = [];
    let callCount = 0;
    const flakeyGeneration: PipelineAgent = {
      name: 'generation',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async () => {
        callCount++;
        executionOrder.push('generation');
        if (callCount === 1) throw new Error('Socket timeout');
        return { success: true, costUsd: 0, variantsAdded: 1, matchesPlayed: 0 };
      }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { generation: flakeyGeneration });
    const ctx = makeIntegrationCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('retry-test', agents, ctx, ctx.logger, pipelineOpts);

    expect(flakeyGeneration.execute).toHaveBeenCalledTimes(2);
    // Run should complete (not fail), generation retried successfully
  });

  it('marks run failed after transient retries exhausted', async () => {
    const executionOrder: string[] = [];
    const alwaysFailGeneration: PipelineAgent = {
      name: 'generation',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async () => { throw new Error('Socket timeout'); }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { generation: alwaysFailGeneration });
    const ctx = makeIntegrationCtx([2.0, 2.0, 0.005]);

    await expect(
      executeFullPipeline('retry-test', agents, ctx, ctx.logger, pipelineOpts),
    ).rejects.toThrow('Socket timeout');
    // 1 initial + 1 retry = 2 calls
    expect(alwaysFailGeneration.execute).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient errors', async () => {
    const executionOrder: string[] = [];
    const fatalGeneration: PipelineAgent = {
      name: 'generation',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async () => { throw new Error('Invalid JSON response'); }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { generation: fatalGeneration });
    const ctx = makeIntegrationCtx([2.0, 2.0, 0.005]);

    await expect(
      executeFullPipeline('retry-test', agents, ctx, ctx.logger, pipelineOpts),
    ).rejects.toThrow('Invalid JSON response');
    expect(fatalGeneration.execute).toHaveBeenCalledTimes(1);
  });

  it('does not retry BudgetExceededError (pauses instead)', async () => {
    const executionOrder: string[] = [];
    const budgetGeneration: PipelineAgent = {
      name: 'generation',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async () => { throw new BudgetExceededError('generation', 5.0, 5.0); }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { generation: budgetGeneration });
    const ctx = makeIntegrationCtx([2.0, 2.0, 0.005]);

    await expect(
      executeFullPipeline('retry-test', agents, ctx, ctx.logger, pipelineOpts),
    ).rejects.toThrow(BudgetExceededError);
    expect(budgetGeneration.execute).toHaveBeenCalledTimes(1);
  });

  it('preserves partial state from failed attempt (no rollback)', async () => {
    const executionOrder: string[] = [];
    let callCount = 0;
    const partialGeneration: PipelineAgent = {
      name: 'generation',
      canExecute: jest.fn().mockReturnValue(true),
      execute: jest.fn(async (ctx: ExecutionContext) => {
        callCount++;
        ctx.state.addToPool({
          id: `variant-attempt-${callCount}`,
          text: 'test', version: 1, parentIds: [],
          strategy: 'test', createdAt: Date.now() / 1000, iterationBorn: 0,
        });
        if (callCount === 1) throw new Error('Socket timeout');
        return { success: true, costUsd: 0, variantsAdded: 1, matchesPlayed: 0 };
      }),
    };
    const agents = makeAllAgentsWithOverride(executionOrder, { generation: partialGeneration });
    const ctx = makeIntegrationCtx([2.0, 2.0, 0.005]);

    await executeFullPipeline('retry-test', agents, ctx, ctx.logger, pipelineOpts);

    // Pool has baseline + variant-attempt-1 (partial, from failed) + variant-attempt-2 (from retry)
    expect(ctx.state.pool.length).toBeGreaterThanOrEqual(3);
    expect(ctx.state.poolIds.has('variant-attempt-1')).toBe(true);
    expect(ctx.state.poolIds.has('variant-attempt-2')).toBe(true);
  });
});
```

**Mock patterns used in tests:**
- **Socket timeout:** `new Error('Socket timeout')` — matches `isTransientError` via message
- **ECONNRESET:** `new Error('ECONNRESET')` — matches `isTransientError` via message
- **APIConnectionError:** `import { APIConnectionError } from 'openai'; new APIConnectionError({ message: 'Connection failed', cause: undefined })` — matches via `instanceof`
- **RateLimitError:** `import { RateLimitError } from 'openai'; new RateLimitError(429, undefined, 'Rate limited', undefined as any)` — extends `APIError(status, error, message, headers)`
- **InternalServerError:** `import { InternalServerError } from 'openai'; new InternalServerError(500, undefined, 'Internal server error', undefined as any)` — same 4-arg `APIError` constructor
- **Wrapped cause chain:** `new Error('LLM wrapper failed', { cause: new APIConnectionError({ message: 'timeout', cause: undefined }) })` — matches via `isTransientError` recursive cause walk
- **BudgetExceededError:** `new BudgetExceededError('agent', 1.0, 0.5)` — bypasses retry, triggers pause
- **Non-transient:** `new Error('Invalid JSON response')` — does NOT match `isTransientError`, no retry

**Verification:** `npm test -- pipeline`

### Phase 5: Documentation & Final Verification
**Files modified:** 4 docs

1. **`docs/evolution/reference.md`** — Update "Error Recovery Paths" table:
   - Add row: `Transient network error (socket timeout, 429, 5xx) | Agent degrades (if internal handling) + pipeline retries once with 1s backoff | Run continues; no manual intervention`
   - Update "Edge Cases & Guards" section with transient error behavior

2. **`docs/evolution/architecture.md`** — Update "Error Recovery Paths" table:
   - Add row: `Transient LLM error | Agent degrades gracefully + pipeline retries once | No manual intervention needed`

3. **`docs/evolution/agents/overview.md`** — Add "Transient Error Handling" section:
   - Document the caller contract for `diffComparison.ts` (`compareWithDiff`) and `comparison.ts` (`compareWithBiasMitigation`)
   - Note which agents have internal protection (Tier 1) vs rely on pipeline retry (Tier 2)
   - Reference `isTransientError()` in `core/errorClassification.ts`

4. **`docs/feature_deep_dives/error_handling.md`** — Add "Transient Error Classification" section:
   - Document `isTransientError()` and the error patterns it matches (OpenAI SDK classes + message patterns + cause chain walking)
   - Explain defense-in-depth strategy (agent-level catch + pipeline-level retry)
   - Document retry amplification: SDK retries 3× internally, pipeline retries agent 1×, total = up to 8 LLM attempts for persistent transient errors. This is intentional but must be explicit to prevent future maintainers from adding yet another retry layer.
   - Note `executeMinimalPipeline` (single-article mode, lines 708-779) does NOT have retry logic — it has its own simpler agent loop. Future work may add retry there.
   - Note this is evolution-specific; global error categorization remains in `errorHandling.ts`

**Final verification:**
```bash
npm run lint
npx tsc --noEmit
npm run build
npm test -- --testPathPatterns="errorClassification|iterativeEditingAgent|calibrationRanker|pipeline"
npm test -- --testPathPatterns="evolution"  # full regression
```

## Testing

### New Unit Tests
| Test File | Tests | What's Covered |
|-----------|-------|----------------|
| `core/errorClassification.test.ts` | ~18 | Message patterns, OpenAI SDK class instances (correct constructors), error.cause chain walking, non-transient rejection, non-Error inputs |
| `agents/iterativeEditingAgent.test.ts` | +4 | Transient error in edit → continue, transient in compareWithDiff → continue, BudgetExceeded → re-throw, exhausted rejections |
| `agents/calibrationRanker.test.ts` | +2 | BudgetExceededError re-throw from first and second allSettled batches |
| `core/pipeline.test.ts` | +5 | Retry on transient → succeed, retry exhausted → fail, no retry on fatal, no retry on BudgetExceeded, partial state preserved (no rollback) |

### Mock Patterns
- **Socket timeout:** `(mockClient.complete as jest.Mock).mockRejectedValueOnce(new Error('Socket timeout'))`
- **ECONNRESET:** `mockRejectedValueOnce(new Error('ECONNRESET'))`
- **APIConnectionError:** `import { APIConnectionError } from 'openai'; mockRejectedValueOnce(new APIConnectionError({ message: 'Connection failed', cause: undefined }))`
- **RateLimitError:** `import { RateLimitError } from 'openai'; mockRejectedValueOnce(new RateLimitError(429, undefined, 'Rate limited', undefined as any))`
- **InternalServerError:** `import { InternalServerError } from 'openai'; mockRejectedValueOnce(new InternalServerError(500, undefined, 'ISE', undefined as any))`
- **Wrapped cause:** `mockRejectedValueOnce(new Error('Wrapper', { cause: new APIConnectionError({ message: 'timeout', cause: undefined }) }))`
- **BudgetExceededError:** `mockRejectedValueOnce(new BudgetExceededError('agent', 1.0, 0.5))`
- **Non-transient:** `mockRejectedValueOnce(new Error('Invalid JSON response'))`

### Existing Tests (regression)
- Run full evolution test suite: `npm test -- --testPathPatterns="evolution"`
- All existing agent tests must continue passing (no behavioral change for non-error paths)

### Manual Verification
- Use `npx tsx scripts/run-evolution-local.ts --file <file> --mock` with a patched mock that injects a socket timeout mid-run
- Check admin UI Logs tab shows retry attempts with `[WARN]` level entries

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/reference.md` - Update error recovery table and edge cases section with retry behavior
- `docs/evolution/architecture.md` - Update error recovery paths table
- `docs/evolution/agents/overview.md` - Note transient error handling pattern for agents
- `docs/feature_deep_dives/error_handling.md` - Add transient error categorization

## Rollback Plan
All changes are additive (new try-catch, new helper, new retry param). If issues arise:
- Remove `isTransientError()` calls and pipeline retry logic → reverts to current fail-fast behavior
- Set `maxRetries: 0` in runAgent calls to disable retry without removing code
- No database migrations, no API changes, no config changes
