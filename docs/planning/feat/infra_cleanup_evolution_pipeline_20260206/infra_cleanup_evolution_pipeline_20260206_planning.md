# Infra Cleanup Evolution Pipeline Plan

## Background

The evolution pipeline (~4,500 LOC) under `src/lib/evolution/` runs an iterative text improvement system with 10 agents, 2 pipeline modes, and 5 production callsites. Each callsite independently constructs agents, execution contexts, and pipeline options. Research found 3 of 5 callsites are missing `TreeSearchAgent`, the `DebateAgent` returns hardcoded `costUsd: 0`, and the cost tracker's reservation-release logic leaks phantom reservations. The `run-evolution-local.ts` script reimplements the full pipeline loop (~130 lines) instead of importing `executeFullPipeline`.

## Problem

1. **Callsite divergence**: 5 callsites each construct agents independently. 3 are missing `TreeSearchAgent`, meaning the tree-of-thought feature silently doesn't run in cron, admin trigger, and batch modes.
2. **Cost bugs**: DebateAgent reports `costUsd: 0` in its `AgentResult` despite making 4 LLM calls (observability impact). The reservation-release logic in `CostTrackerImpl.recordSpend()` under-releases when `actualCost < estimatedCost`, leaking phantom reservations that inflate `totalReserved` and can cause premature `BudgetExceededError`. `getAvailableBudget()` doesn't subtract reservations, making supervisor stop-decisions over-optimistic.
3. **Code duplication**: ~40 lines of post-completion logic (persist variants, agent metrics, strategy config, run summary) are duplicated between `executeMinimalPipeline` and `executeFullPipeline`. The local CLI reimplements the full pipeline loop instead of calling the shared function.
4. **Error handling bugs**: DebateAgent mutates `state.debateTranscripts` *before* checking `BudgetExceededError` in 4 catch blocks — corrupts checkpoint state on budget errors. `IterativeEditingAgent.runOpenReview` and `runInlineCritique` swallow non-budget errors silently with no logging. EvolutionAgent creative exploration (`evolvePool.ts:267-269`) swallows `BudgetExceededError` entirely — never re-throws. Tournament `Promise.allSettled` (`tournament.ts:255-259`) absorbs `BudgetExceededError` in rejected promises. BeamSearch mini-tournament (`beamSearch.ts:102-110`) catches but doesn't re-throw `BudgetExceededError`.
5. **Dead code & duplication**: `ratingToDisplay()` in `core/rating.ts` is exported but never called in production (test-only). (`isConverged()` is used by `tournament.ts:296` — NOT dead.) JSON parsing pattern `response.match(/\{[\s\S]*\}/)` is duplicated 5+ times across agents. Barrel `index.ts` exports 58 items but only ~15-20 are used externally. Critique prompt logic duplicated between `reflectionAgent.ts` and `iterativeEditingAgent.ts`.
6. **Config & type issues**: `DEFAULT_EVOLUTION_CONFIG.budgetCaps` values sum to **1.10** (10 agents × varying caps) — per-agent caps are achievable but total exceeds 100%, which is intentional (not all agents run every iteration) but undocumented. `PipelineAgent` interface lacks `estimateCost()` that `AgentBase` requires. `budgetCaps` typed as `Record<string, number>` — typos silently fall back to 0.20. `core/validation.ts` (91 lines of complex state contracts) has no test file.
7. **Cost visualization bug**: `costEstimator.ts:272` uses non-regex `.replace('evolution_', '')` instead of `/^evolution_/` — strips all occurrences not just prefix, corrupting baseline agent names in DB.

## Options Considered

### Callsite Consolidation

**Option A: Agent factory + context factory** — Create `createDefaultAgents(): PipelineAgents` and `createPipelineContext(...)` factory functions in the barrel export. Each callsite calls these instead of manually constructing agents.
- Pros: Simple, low-risk, fixes TreeSearchAgent gap immediately
- Cons: Context construction still has per-callsite differences (LLM client ID, feature flags)

**Option B: Full pipeline builder** — Create a `PipelineBuilder` class with fluent API: `new PipelineBuilder(runId).withConfig(config).withFeatureFlags(flags).build()`.
- Pros: Elegant, extensible, single source of truth
- Cons: Over-engineering for 5 callsites; adds a new abstraction layer

**Option C (Chosen): Agent factory + shared `preparePipelineRun()` helper** — Create `createDefaultAgents()` for agents and a `preparePipelineRun()` function that takes minimal inputs (runId, content, title, explanationId, config, llmClientId) and returns `{ ctx, agents, costTracker, logger }`. Callsites can still customize (e.g., mock LLM for local), but the default path is shared.
- Pros: Balances simplicity with deduplication, easy to review, low blast radius
- Cons: Local CLI still needs its own LLM client path (but shares agent construction)

### Cost Bug Fixes

**Option A: Minimal fixes** — Fix DebateAgent's `costUsd`, fix reservation release, fix `getAvailableBudget()`.
- Pros: Targeted, easy to test, low risk
- Cons: Doesn't address deeper questions (should agents track their own cost?)

**Option B (Chosen): Minimal fixes + documentation** — Same fixes as A, plus add clear doc comments explaining the 3-layer cost model.

### Pipeline Duplication

**Option A (Chosen): Extract `finalizePipelineRun()` helper** — Move shared post-completion logic to a helper called from both pipeline modes.
- Pros: Simple extraction, easy to test
- Cons: None significant

**Option B: Merge into single pipeline function** — Combine minimal and full modes.
- Pros: Single code path
- Cons: Minimal mode has intentionally different behavior (no supervisor, single pass)

## Phased Execution Plan

### Phase 1: Extract `createDefaultAgents()` factory & fix agent gaps across callsites

**Goal**: Single source of truth for agent construction. Fix 6 missing-agent gaps across 4 callsites.

**Agent divergence (current state):**

| Agent | PipelineAgents | evolution-runner | local CLI | run-batch | cron route | admin trigger |
|-------|:-:|:-:|:-:|:-:|:-:|:-:|
| TreeSearchAgent | optional | ✅ | ✅ | ❌ | ❌ | ❌ |
| SectionDecomposition | optional | ❌ | ✅ | ❌ | ❌ | ✅ |
| OutlineGeneration | optional | ✅ | conditional | ✅ | ✅ | ✅ |

All other 9 agents are present in all callsites.

**Files modified:**
- `src/lib/evolution/core/pipeline.ts` — Add `createDefaultAgents(): PipelineAgents` with all 12 agent imports
- `src/lib/evolution/index.ts` — Re-export `createDefaultAgents`
- `src/app/api/cron/evolution-runner/route.ts` — Use factory (adds TreeSearchAgent + SectionDecompositionAgent)
- `src/lib/services/evolutionActions.ts` — Use factory (adds TreeSearchAgent)
- `scripts/run-batch.ts` — Use factory (adds TreeSearchAgent + SectionDecompositionAgent)
- `scripts/evolution-runner.ts` — Use factory (adds SectionDecompositionAgent)
- `scripts/run-evolution-local.ts` — Use factory (already has all; conditional OutlineGeneration handled separately)

**Placement**: Put `createDefaultAgents()` in `index.ts` (barrel), NOT in `core/pipeline.ts`. Reason: `core/` currently has zero imports from `agents/`. Adding 12 agent imports to `pipeline.ts` would create a new `core/ → agents/` dependency direction. The barrel already imports all agents for re-export, so placing the factory there adds no new dependency edges.

**Code sketch:**
```typescript
// In index.ts — already imports all agent classes for re-export
export function createDefaultAgents(): PipelineAgents {
  return {
    generation: new GenerationAgent(),
    calibration: new CalibrationRanker(),
    tournament: new Tournament(),
    evolution: new EvolutionAgent(),
    reflection: new ReflectionAgent(),
    iterativeEditing: new IterativeEditingAgent(),
    treeSearch: new TreeSearchAgent(),
    sectionDecomposition: new SectionDecompositionAgent(),
    debate: new DebateAgent(),
    proximity: new ProximityAgent(),
    metaReview: new MetaReviewAgent(),
    outlineGeneration: new OutlineGenerationAgent(),
  };
}
```

Note: `PairwiseRanker` is excluded — it's used internally by `Tournament`, not as a standalone pipeline agent.

**Tests:**
- New unit test: `createDefaultAgents()` returns all 12 agents with correct names matching `PipelineAgents` keys
- Verify every optional field in `PipelineAgents` has a non-undefined value

---

### Phase 2: Fix cost infrastructure bugs

**Goal**: Fix 3 identified cost bugs and improve cost tracking accuracy.

**Bug 2a — DebateAgent `costUsd: 0`:**

**File:** `src/lib/evolution/agents/debateAgent.ts`

The agent makes 4 LLM calls via `llmClient.complete()` which triggers `costTracker.recordSpend()` via the `onUsage` callback. So global budget tracking is correct. But the `AgentResult.costUsd` returned by `execute()` is hardcoded to `0`, making OTel spans and log messages show zero cost.

**Fix:** Replace `costUsd: 0` with `costUsd: ctx.costTracker.getAgentCost(this.name)` at the final successful return. For early returns (failures before all calls complete), keep `costUsd: ctx.costTracker.getAgentCost(this.name)` too, to capture partial spend.

```typescript
// Before (line 319):
return { agentType: 'debate', success: true, costUsd: 0, variantsAdded: 1 };

// After:
return { agentType: 'debate', success: true, costUsd: ctx.costTracker.getAgentCost(this.name), variantsAdded: 1 };
```

All early-return `costUsd: 0` lines (6 total) should also be updated to use `ctx.costTracker.getAgentCost(this.name)`.

**Bug 2b — Reservation release leak:**

**File:** `src/lib/evolution/core/costTracker.ts`

When `actualCost < estimatedCost`, `recordSpend()` releases `min(agentReserved, actualCost * 1.3)` which is less than the original reservation of `estimatedCost * 1.3`. The remaining phantom reservation is never released.

Example: estimate $0.10 → reserve $0.13 → actual $0.05 → release $0.065 → leaked $0.065.

**Fix:** Add a FIFO reservation queue per agent. Push the exact `withMargin` amount in `reserveBudget()`, shift it in `recordSpend()`. Both sides shown below:

```typescript
// New field on CostTrackerImpl:
private reservationQueues: Map<string, number[]> = new Map();

// In reserveBudget() — after existing checks pass, before updating totals:
async reserveBudget(agentName: string, estimatedCost: number): Promise<void> {
  const withMargin = estimatedCost * 1.3;
  // ... existing cap checks ...

  // Track individual reservation for FIFO release
  const queue = this.reservationQueues.get(agentName) ?? [];
  queue.push(withMargin);
  this.reservationQueues.set(agentName, queue);

  this.reservedByAgent.set(agentName, (this.reservedByAgent.get(agentName) ?? 0) + withMargin);
  this.totalReserved += withMargin;
}

// In recordSpend() — replace the old min() release with queue shift:
recordSpend(agentName: string, actualCost: number): void {
  this.spentByAgent.set(agentName, (this.spentByAgent.get(agentName) ?? 0) + actualCost);
  this.totalSpent += actualCost;

  // Release exactly one reservation (FIFO).
  // Safe if queue is empty (recordSpend called without prior reservation — e.g., test mocks).
  const queue = this.reservationQueues.get(agentName);
  if (queue && queue.length > 0) {
    const releaseAmount = queue.shift()!;
    this.reservedByAgent.set(agentName, Math.max(0, (this.reservedByAgent.get(agentName) ?? 0) - releaseAmount));
    this.totalReserved = Math.max(0, this.totalReserved - releaseAmount);
  }
}
```

**Bug 2c — `getAvailableBudget()` ignores reservations:**

**File:** `src/lib/evolution/core/costTracker.ts`

`getAvailableBudget()` returns `budgetCapUsd - totalSpent` without subtracting `totalReserved`. The supervisor uses this to decide when to stop. Without reservation subtraction, the pipeline can continue into iterations where the first LLM call will immediately throw `BudgetExceededError` (because `reserveBudget` DOES check totalReserved).

**Callsite audit for `getAvailableBudget()`:**
- `pipeline.ts:489` — OTel span attribute (informational only, safe to change)
- `pipeline.ts:555` → `supervisor.shouldStop(state, availableBudget)` → `supervisor.ts:225`: `if (availableBudget < this.cfg.minBudget)` — **this is the key consumer**. Subtracting reservations makes this check *more conservative* (stops sooner), which is the correct direction. Previously the supervisor was over-optimistic, letting the pipeline enter iterations where the first LLM call would immediately throw `BudgetExceededError`.
- `tournament.ts:202` — budget pressure calculation. Subtracting reservations makes pressure higher, reducing comparisons. Correct direction.
- All test mocks return constant values and are unaffected.

**Fix:**
```typescript
getAvailableBudget(): number {
  return this.budgetCapUsd - this.totalSpent - this.totalReserved;
}
```

**Note**: With the reservation queue fix (Bug 2b), `totalReserved` will correctly reach 0 after all calls complete, so `getAvailableBudget()` converges to `budgetCapUsd - totalSpent` between iterations (when no calls are in-flight). The behavioral change only affects mid-iteration checks.

**Bug 2d — DebateAgent state mutation before error check:**

**File:** `src/lib/evolution/agents/debateAgent.ts`

In 4 catch blocks (lines ~232, 245, 259, 282), the agent pushes to `state.debateTranscripts` *before* checking if the error is `BudgetExceededError`. If budget is exceeded mid-debate, a partial transcript is saved to state, then the error is re-thrown. The pipeline checkpoints this corrupted state.

**Fix:** Move `state.debateTranscripts.push(transcript)` to *after* the BudgetExceededError check in each catch block:

```typescript
// Before:
} catch (error) {
  state.debateTranscripts.push(transcript);  // ← corrupts state
  if (error instanceof BudgetExceededError) throw error;
  return { agentType: 'debate', success: false, costUsd: ctx.costTracker.getAgentCost(this.name), error: ... };
}

// After:
} catch (error) {
  if (error instanceof BudgetExceededError) throw error;
  state.debateTranscripts.push(transcript);  // ← only on non-budget errors
  return { agentType: 'debate', success: false, costUsd: ctx.costTracker.getAgentCost(this.name), error: ... };
}
```

**Bug 2e — IterativeEditingAgent swallows errors silently:**

**File:** `src/lib/evolution/agents/iterativeEditingAgent.ts`

`runOpenReview()` (line ~157) catches non-budget errors and returns `null` with no logging. This makes debugging impossible when LLM calls fail for non-budget reasons.

**Fix:** Add `ctx.logger.warn(...)` before returning null in the catch block.

**Bug 2f — EvolutionAgent creative exploration swallows BudgetExceededError:**

**File:** `src/lib/evolution/agents/evolvePool.ts`

Lines 267-269: catch block logs error but does NOT check for `BudgetExceededError`. If budget exceeded during creative exploration, error is swallowed and pipeline continues with corrupted budget state.

**Fix:** Add `BudgetExceededError` check before the generic error log:
```typescript
// Before:
} catch (error) {
  logger.error('Creative exploration error', { error: String(error) });
}

// After:
} catch (error) {
  if (error instanceof BudgetExceededError) throw error;
  logger.error('Creative exploration error', { error: String(error) });
}
```

**Bug 2g — Tournament Promise.allSettled swallows BudgetExceededError:**

**File:** `src/lib/evolution/agents/tournament.ts`

Lines 255-259: Swiss round matches run via `Promise.allSettled()`. Line 264 checks `result.status !== 'fulfilled'` and skips, but never extracts the rejection reason to check for `BudgetExceededError`.

**Fix:** After `Promise.allSettled`, scan ALL rejected promises for `BudgetExceededError` and re-throw the first one found. Process fulfilled results first so partial work is preserved:
```typescript
// After existing result processing loop:
for (const r of roundResults) {
  if (r.status === 'rejected' && r.reason instanceof BudgetExceededError) {
    throw r.reason;
  }
}
```

**Bug 2h — BeamSearch mini-tournament catches but doesn't re-throw BudgetExceededError:**

**File:** `src/lib/evolution/treeOfThought/beamSearch.ts`

Lines 102-110: `BudgetExceededError` is caught, logged as warning, and survivors are used as-is. This silently degrades beam search quality instead of pausing the run.

**Fix:** Re-throw `BudgetExceededError` after saving partial survivors to state. The caller (`TreeSearchAgent.execute()`) already has a try-catch that returns partial results on budget errors, so re-throwing here is safe and consistent with depth 1-2 behavior:
```typescript
catch (err) {
  if (err instanceof BudgetExceededError) {
    // Save partial survivors before propagating
    rankedSurvivors = filterResult.survivors.slice(0, beamWidth);
    throw err;  // Let TreeSearchAgent handle graceful degradation
  }
  throw err;
}
```

**Bug 2i — costEstimator agent-name stripping uses non-regex replace:**

**File:** `src/lib/evolution/core/costEstimator.ts`

Line 272: `.replace('evolution_', '')` strips ALL occurrences of "evolution_", not just the prefix. The visualization code at `evolutionVisualizationActions.ts:362,656,670` correctly uses `.replace(/^evolution_/, '')`.

**Fix:** Change to regex: `.replace(/^evolution_/, '')`

**Bug 2j — BudgetCaps sum to 1.10 (110%):**

**File:** `src/lib/evolution/config.ts`

The 10 default `budgetCaps` values sum to **1.10** (not 1.0). This is intentional — not all agents run every iteration (feature-flagged, phase-gated), so the total can exceed 100%. However, this is undocumented and could confuse future developers.

**Fix:** Add a comment explaining the intentional over-allocation:
```typescript
// Budget caps sum to >1.0 intentionally: not all agents run every iteration.
// Per-agent caps are checked individually by costTracker.reserveBudget().
```

**Tests:**
- Unit test: `costTracker.test.ts` — reservation release fully releases on recordSpend
- Unit test: `costTracker.test.ts` — getAvailableBudget subtracts reservations
- Unit test: `costTracker.test.ts` — reservation leak scenario (estimate high, actual low) no longer leaks
- Unit test: `costTracker.test.ts` — assert `totalReserved === 0` after all recordSpend calls complete
- Unit test: `debateAgent.test.ts` — verify costUsd > 0 when agent makes LLM calls
- Unit test: `debateAgent.test.ts` — BudgetExceededError mid-debate does NOT push partial transcript
- Unit test: `evolvePool.test.ts` — BudgetExceededError during creative exploration is re-thrown
- Unit test: `tournament.test.ts` — BudgetExceededError in Swiss round is propagated from Promise.allSettled

---

### Phase 3: Extract `finalizePipelineRun()` from duplicated post-completion code

**Goal**: DRY up the ~40 lines of post-completion logic shared between both pipeline modes.

**File:** `src/lib/evolution/core/pipeline.ts`

**Code sketch:**
```typescript
/** Shared post-completion: persist variants, metrics, strategy config, and run summary. */
async function finalizePipelineRun(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger,
  stopReason: string,
  durationSeconds: number,
  supervisor?: PoolSupervisor,
): Promise<void> {
  const supabase = await createSupabaseServiceClient();

  // Run summary
  const rawSummary = buildRunSummary(ctx, stopReason, durationSeconds, supervisor);
  const summary = validateRunSummary(rawSummary, logger, runId);
  if (summary) {
    const { error } = await supabase.from('evolution_runs')
      .update({ run_summary: summary }).eq('id', runId);
    if (error) {
      logger.warn('Failed to persist run_summary', { runId, error: error.message });
    }
  }

  await persistVariants(runId, ctx, logger);
  await persistAgentMetrics(runId, ctx, logger);
  await linkStrategyConfig(runId, ctx, logger);
}
```

Replace the duplicated blocks in both `executeMinimalPipeline` (lines ~414–436) and `executeFullPipeline` (lines ~646–668) with a single call to `finalizePipelineRun()`.

**Note on DB update divergence:** The two modes have slightly different `evolution_runs` status updates (minimal: always `'completed'`; full: `'completed'` with conditional `error_message`). The status update stays in each pipeline function — only the post-status logic (summary, variants, metrics, config) is extracted into `finalizePipelineRun()`. `buildRunSummary()` already handles `supervisor === undefined` (minimal mode) gracefully.

**Tests:**
- Existing integration tests should continue passing (behavior unchanged)
- Add unit test: `finalizePipelineRun` calls all 4 persistence functions (mock Supabase)

---

### Phase 4: Extract `preparePipelineRun()` context factory

**Goal**: Consolidate the duplicated context construction across the 4 callsites that use `executeFullPipeline`.

**File:** `src/lib/evolution/core/pipeline.ts` (or new `src/lib/evolution/core/pipelineFactory.ts`)

**Code sketch:**
```typescript
export interface PipelineRunInputs {
  runId: string;
  originalText: string;
  title: string;
  explanationId: number;
  configOverrides?: Partial<EvolutionRunConfig>;
  /** Required when llmClient is not provided. Ignored when llmClient is set. */
  llmClientId?: string;
  /** Optional pre-built LLM client. If omitted, creates standard client using llmClientId. */
  llmClient?: EvolutionLLMClient;
}

export interface PreparedPipelineRun {
  ctx: ExecutionContext;
  agents: PipelineAgents;
  config: EvolutionRunConfig;
  costTracker: CostTrackerImpl;
  logger: EvolutionLogger;
}

export function preparePipelineRun(inputs: PipelineRunInputs): PreparedPipelineRun {
  const config = resolveConfig(inputs.configOverrides ?? {});
  const state = new PipelineStateImpl(inputs.originalText);
  const costTracker = createCostTracker(config);
  const logger = createEvolutionLogger(inputs.runId);
  if (!inputs.llmClient && !inputs.llmClientId) {
    throw new Error('Either llmClient or llmClientId must be provided');
  }
  const llmClient = inputs.llmClient
    ?? createEvolutionLLMClient(inputs.llmClientId!, costTracker, logger);

  const ctx: ExecutionContext = {
    payload: {
      originalText: inputs.originalText,
      title: inputs.title,
      explanationId: inputs.explanationId,
      runId: inputs.runId,
      config,
    },
    state,
    llmClient,
    logger,
    costTracker,
    runId: inputs.runId,
  };

  return { ctx, agents: createDefaultAgents(), config, costTracker, logger };
}
```

**Callsite updates:**
- `evolution-runner.ts`: Replace ~20 lines of setup with `preparePipelineRun()`
- `cron route.ts`: Replace ~25 lines of setup with `preparePipelineRun()`
- `evolutionActions.ts`: Replace ~25 lines of setup with `preparePipelineRun()`
- `run-batch.ts`: Replace ~20 lines of setup with `preparePipelineRun()`
- `run-evolution-local.ts`: Use `preparePipelineRun({ ..., llmClient: createMockLLMClient() })` — passes custom LLM client via optional field

**Tests:**
- Unit test: `preparePipelineRun` returns valid context with all agents
- Verify each callsite still works via existing integration tests

---

### Phase 5: Refactor `run-evolution-local.ts` to use `executeFullPipeline` for `--full` mode

**Goal**: Eliminate the reimplemented pipeline loop (~130 lines) in the local CLI.

The local CLI's `runFullPipeline()` reimplements the iteration loop, phase detection, and agent execution sequence from `pipeline.ts`. This creates drift risk and misses features added to the canonical pipeline (e.g., OTel spans, enhanced checkpoint format with supervisor state).

**Approach**: Replace `runFullPipeline()` in `run-evolution-local.ts` with a call to the canonical `executeFullPipeline()`. The bank-checkpoint feature can be implemented as a post-iteration hook or by checking state after the pipeline completes.

**Key challenge**: The local CLI uses its own `createDirectLLMClient()` and `createMockLLMClient()` instead of the standard `createEvolutionLLMClient()`. Solution: pass the custom LLM client into the context manually while using `createDefaultAgents()` for agents.

**Files modified:**
- `scripts/run-evolution-local.ts` — Remove `runFullPipeline()`, `runMinimalPipeline()`, and local `runAgent()`. Import and call `executeFullPipeline` / `executeMinimalPipeline` from `pipeline.ts`. Keep custom LLM client and bank logic.

**Tests:**
- Manual: `npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --mock`
- Manual: `npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --full --mock --iterations 3`
- Verify bank checkpoints still work with `--bank --bank-checkpoints 2,4`

---

### Phase 6: Clean up, dead code removal, and documentation

**Goal**: Remove dead code, extract shared utilities, tighten public API, update docs.

**Dead code removal:**
- `core/rating.ts` — Delete `ratingToDisplay()` (exported but only used in tests). Keep `isConverged()` — it IS used by `tournament.ts:296`.
- `core/adaptiveAllocation.ts` — `computeAdaptiveBudgetCaps()` and `budgetPressureConfig()` are exported but never called. Add a `TODO: wire into pipeline` comment rather than delete (feature is described in elo_budget_optimization.md as planned).
- Supervisor's `generationPayload.strategyRotation` — generated by `getPhaseConfig()` but ignored by `GenerationAgent` which always uses all 3 strategies. Add a `TODO` comment in supervisor.ts noting this dead code path.

**Extract shared JSON parsing utility:**
The pattern `response.match(/\{[\s\S]*\}/)` + `JSON.parse()` appears in 5+ locations:
- `reflectionAgent.ts:67-70`
- `debateAgent.ts:108-110`
- `iterativeEditingAgent.ts:153-155, 211-214`
- `treeOfThought/beamSearch.ts:344-354`

Extract to a shared utility:
```typescript
// In core/llmClient.ts or new core/jsonParser.ts
export function extractJSON<T = unknown>(response: string): T | null {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}
```

**Align PipelineAgent ↔ AgentBase interface:**
`PipelineAgent` in `pipeline.ts` lacks `estimateCost()` that `AgentBase` in `base.ts` requires. Since no agent implements `estimateCost()` meaningfully, remove it from `AgentBase` rather than adding it everywhere.

**~~Fix PipelineAgents field name mismatch~~:** False positive — interface actually defines `metaReview?: PipelineAgent` (pipeline.ts:460), matching all callsites. No change needed.

**Fix budget caps typing:**
Change `budgetCaps: Record<string, number>` to use a typed agent name union to catch typos at compile time.

**Tighten barrel exports:**
`index.ts` exports 58 items but only ~15-20 are used externally. Consider organizing into:
- Public API (services, UI, callsites)
- Internal API (cross-module, tests)

This is low priority — defer unless it causes confusion.

**Documentation updates:**
- `docs/feature_deep_dives/evolution_pipeline.md` — Update callsite list, note factory functions
- `docs/feature_deep_dives/elo_budget_optimization.md` — Update cost tracker docs to reflect bug fixes

## Testing

### Unit Tests (New)
- `src/lib/evolution/core/costTracker.test.ts`:
  - Reservation queue: push on reserveBudget, shift on recordSpend, totalReserved === 0 after all calls
  - getAvailableBudget subtracts reservations (returns budgetCap - spent - reserved)
  - Multiple reserve+recordSpend cycles don't accumulate phantom reservations
  - Edge case: recordSpend without prior reservation (no crash, no negative totalReserved)
  - Update existing test at line 90-98 to also assert `totalReserved === 0`
- `src/lib/evolution/core/pipeline.test.ts`:
  - `createDefaultAgents()` returns PipelineAgents with all 12 agents, all non-undefined
  - `finalizePipelineRun()` calls all 4 persistence functions (mock Supabase)
- `src/lib/evolution/agents/debateAgent.test.ts`:
  - `costUsd` > 0 after successful execution (all 9 return paths)
  - BudgetExceededError mid-debate does NOT push to `state.debateTranscripts`
- `src/lib/evolution/agents/evolvePool.test.ts`:
  - BudgetExceededError during creative exploration is re-thrown (Bug 2f)
- `src/lib/evolution/agents/tournament.test.ts`:
  - BudgetExceededError in Swiss round Promise.allSettled is propagated (Bug 2g)
- `src/lib/evolution/treeOfThought/beamSearch.test.ts`:
  - BudgetExceededError in mini-tournament is re-thrown after saving partial survivors (Bug 2h)
- `src/lib/evolution/core/costEstimator.test.ts`:
  - Agent-name stripping uses prefix-only regex: `evolution_foo` → `foo`, `bar_evolution_baz` → `bar_evolution_baz` (Bug 2i)
- `src/lib/evolution/core/validation.test.ts` (new file):
  - Cover the 5 phase-level state contract guards (91 lines, currently untested)

### Unit Tests (Modified)
- Update existing costTracker tests that assert old reservation-release behavior (line 45 `min()` logic)
- Update debateAgent tests that check early-return costUsd values (was 0, now getAgentCost)

### Manual Verification (Stage)
- Run a pipeline via cron → verify TreeSearchAgent + SectionDecompositionAgent appear in agent logs
- Run a pipeline via admin trigger → verify TreeSearchAgent appears
- Run a batch experiment → verify TreeSearchAgent + SectionDecompositionAgent appear
- Compare `evolution_run_agent_metrics` costs before/after fix → debate agent should show non-zero cost
- Compare budget utilization → no premature BudgetExceededError from phantom reservations
- Run `run-evolution-local.ts --mock` → verify it still works with custom LLM client via preparePipelineRun

## Documentation Updates

The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/evolution_pipeline.md` - Update callsite section, add factory function docs, update agent list
- `docs/feature_deep_dives/elo_budget_optimization.md` - Update cost tracker section with bug fix details, document 3-layer cost model
- `docs/feature_deep_dives/tree_of_thought_revisions.md` - Note that TreeSearchAgent is now in all callsites
