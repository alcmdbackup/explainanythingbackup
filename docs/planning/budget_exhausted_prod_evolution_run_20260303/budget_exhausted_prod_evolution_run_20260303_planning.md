# Budget Exhausted Prod Evolution Run Plan

## Background

Evolution run `1a67a4ce` stopped at 8/50 iterations claiming budget exhaustion, but actual spend was only $0.029-$0.071 of a $0.10 budget. The root cause is leaked reservations in `CostTracker` -- when LLM calls fail, their pre-call reservations are never released, permanently reducing available budget. A secondary issue is zero visibility into CostTracker's internal state, making this class of bug invisible until it causes a production failure.

## Requirements (from GH Issue #639)

- Fix the leaked reservation bug that caused premature budget exhaustion
- Add visibility into budget tracking (reservations, spend, releases)
- Fix misleading BudgetExceededError message
- Fix GenerationAgent ignoring `generationModel` config
- Fix silent llmCallTracking insert failures

## Problem

CostTracker uses a reserve-before-call / record-after-call pattern, but has no cleanup path when LLM calls fail. Failed calls leave orphaned reservations in `totalReserved`, which counts against the budget cap. Over multiple iterations, these leaked reservations accumulate and trigger false budget exhaustion. There is no way to detect this at runtime or diagnose it post-mortem because CostTracker has no event log.

## Options Considered

### Option A: Try/catch in llmClient.ts + budget event log table (CHOSEN)
- Add `releaseReservation()` to CostTracker
- Wrap `callLLM` in try/catch, release reservation on failure
- Add `evolution_budget_events` table for full audit trail
- Emit events from CostTracker for every reserve/spend/release
- **Pros:** Fixes root cause, adds permanent visibility, minimal blast radius
- **Cons:** New table + migration, slight write overhead per LLM call

### Option B: Remove reservation system entirely
- Check budget before call but don't track reservations
- Rely on `totalSpent` alone for budget enforcement
- **Pros:** Simpler code, no leak possible
- **Cons:** Loses protection against concurrent overspend on parallel calls, budget enforcement is less accurate

### Option C: Timeout-based reservation expiry
- Auto-expire reservations older than N seconds
- **Pros:** Self-healing without code changes to callers
- **Cons:** Adds complexity, arbitrary timeout, masks the real problem

## Phased Execution Plan

### Phase 1: Fix leaked reservations (root cause)

**Files modified:**
- `evolution/src/lib/types.ts` (CostTracker interface -- add `releaseReservation`)
- `evolution/src/lib/core/costTracker.ts` (implement `releaseReservation`)
- `evolution/src/lib/core/llmClient.ts` (try/catch around `callLLM`)

**Changes:**

1. Add `releaseReservation(agentName: string): void` to the `CostTracker` interface in `types.ts` (line ~461-473):
```typescript
export interface CostTracker {
  reserveBudget(agentName: string, estimatedCost: number): Promise<void>;
  recordSpend(agentName: string, actualCost: number, invocationId?: string): void;
  /** Release the most recent reservation for an agent without recording spend. Used on LLM call failure. */
  releaseReservation(agentName: string): void;
  // ... existing methods unchanged
}
```

2. Implement `releaseReservation` in `CostTrackerImpl`:
```typescript
releaseReservation(agentName: string): void {
  const queue = this.reservationQueues.get(agentName);
  if (queue?.length) {
    const releaseAmount = queue.shift()!;
    this.reservedByAgent.set(agentName, Math.max(0, (this.reservedByAgent.get(agentName) ?? 0) - releaseAmount));
    this.totalReserved = Math.max(0, this.totalReserved - releaseAmount);
  }
}
```

3. Wrap both `complete()` and `completeStructured()` in `llmClient.ts` with try/catch:
```typescript
await costTracker.reserveBudget(agentName, estimate);
try {
  const result = await callLLM(...);
  return result;
} catch (err) {
  costTracker.releaseReservation(agentName);
  throw err;
}
```

**Safety analysis -- no double-release:**
- `onUsage` fires inside `callLLM` before it returns. On success, `recordSpend` shifts the reservation from the FIFO queue before the try block exits normally.
- On failure (callLLM throws before onUsage fires), the catch block calls `releaseReservation` which shifts from the queue.
- If `onUsage` fires but then `callLLM` throws afterward: `recordSpend` already shifted the reservation, so `releaseReservation` finds an empty queue and no-ops safely.
- Edge case: `onUsage`/`recordSpend` itself throws (caught silently by `saveTrackingAndNotify`'s try/catch in llms.ts lines 102-110). In this case `callLLM` still resolves successfully, so the catch block doesn't fire. The reservation remains un-released. This is acceptable because `recordSpend` only throws on negative cost (unreachable in practice). If this ever changes, a `finally`-based approach could be considered, but would add complexity for a near-impossible scenario.

**Concurrency note:** Under parallel calls (e.g., `run2PassReversal` uses `Promise.all`), the FIFO queue may release amounts in a different order than reserved. This is acceptable: aggregate totals (`totalReserved`, `reservedByAgent`) remain correct even if individual release amounts don't match the specific call that completed.

**Mock CostTracker interface update (required for TypeScript compilation):**

Adding `releaseReservation` (Phase 1) and `setEventLogger` (Phase 2) to the `CostTracker` interface will break ALL mock factories. These must ALL be updated to include both new methods. Use `grep -rn 'makeMockCostTracker\|createMockCostTracker' --include='*.ts'` to verify completeness at implementation time.

Complete list of mock factories to update (use `grep -rn 'function.*CostTracker.*: CostTracker' --include='*.ts'` to verify completeness -- note not all use the "Mock" naming convention):
- `evolution/src/testing/evolution-test-helpers.ts:355` -- shared `createMockCostTracker()` (used by outlineGenerationAgent.test.ts and others)
- `evolution/src/lib/core/llmClient.test.ts:32` -- local `makeMockCostTracker()`
- `evolution/src/lib/core/pipelineFlow.test.ts:65` -- local
- `evolution/src/lib/core/pipeline.test.ts:50` -- local
- `evolution/src/lib/core/metricsWriter.test.ts:40` -- local
- `evolution/src/lib/core/arenaIntegration.test.ts:55` -- local
- `evolution/src/lib/core/arena.test.ts:90` -- local
- `evolution/src/lib/agents/pairwiseRanker.test.ts:25` -- local
- `evolution/src/lib/agents/tournament.test.ts:25` -- local
- `evolution/src/lib/agents/debateAgent.test.ts:43` -- local
- `evolution/src/lib/agents/evolvePool.test.ts:35` -- local
- `evolution/src/lib/agents/iterativeEditingAgent.test.ts:59` -- local
- `evolution/src/lib/agents/treeSearchAgent.test.ts:32` -- local
- `evolution/src/lib/agents/sectionDecompositionAgent.test.ts:47` -- local `createMockCostTracker()`
- `evolution/src/lib/treeOfThought/beamSearch.test.ts:80` -- local `makeCostTracker()` (note: no "Mock" in name)

Each needs: `releaseReservation: jest.fn()` and `setEventLogger: jest.fn()`

**Tests (colocated with source):**
- `evolution/src/lib/core/costTracker.test.ts`:
  - `releaseReservation` pops from FIFO, decrements `totalReserved` and `reservedByAgent`
  - `releaseReservation` on empty queue is a no-op (no throw)
  - Multiple reserve + partial release sequence
- `evolution/src/lib/core/llmClient.test.ts`:
  - Update `makeMockCostTracker()` to include `releaseReservation: jest.fn()` and `setEventLogger: jest.fn()`
  - Test: when `callLLM` throws, `releaseReservation` is called with correct agentName
  - Test: when `callLLM` succeeds, `releaseReservation` is NOT called (recordSpend handles it)

### Phase 2: Add budget event log table

**Files modified:**
- New migration: `supabase/migrations/20260306000001_evolution_budget_events.sql`
- `evolution/src/lib/core/costTracker.ts` (add optional event logger via setter)
- `evolution/src/lib/types.ts` (add `BudgetEventLogger` type, add `setEventLogger` to CostTracker interface)
- `evolution/src/lib/index.ts` (wire up logger in `preparePipelineRun` and `prepareResumedPipelineRun`)

**Migration:**
```sql
-- Budget event audit log for diagnosing reservation leaks and budget exhaustion.
CREATE TABLE evolution_budget_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL CHECK (event_type IN ('reserve', 'spend', 'release_ok', 'release_failed')),
  agent_name TEXT NOT NULL,
  amount_usd NUMERIC(10,6) NOT NULL,
  total_spent_usd NUMERIC(10,6) NOT NULL,
  total_reserved_usd NUMERIC(10,6) NOT NULL,
  available_budget_usd NUMERIC(10,6) NOT NULL,
  invocation_id UUID,
  iteration INTEGER,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_budget_events_run ON evolution_budget_events (run_id, created_at);
CREATE INDEX idx_budget_events_type ON evolution_budget_events (run_id, event_type);

-- Rollback: DROP TABLE IF EXISTS evolution_budget_events CASCADE;
```

**CostTracker changes -- setter-based wiring (avoids constructor signature change):**

The logger is injected via a `setEventLogger()` setter after construction, avoiding changes to `createCostTracker` / `createCostTrackerFromCheckpoint` factory signatures.

1. Add `BudgetEventLogger` type and `setEventLogger` to the `CostTracker` interface in `types.ts`:
```typescript
export type BudgetEventLogger = (event: {
  eventType: 'reserve' | 'spend' | 'release_ok' | 'release_failed';
  agentName: string;
  amountUsd: number;
  totalSpentUsd: number;
  totalReservedUsd: number;
  availableBudgetUsd: number;
  invocationId?: string;
  iteration?: number;
}) => void;

export interface CostTracker {
  // ... existing methods ...
  /** Attach an optional event logger for audit trail. */
  setEventLogger(logger: BudgetEventLogger): void;
}
```

2. In `CostTrackerImpl`, add a private `eventLogger?: BudgetEventLogger` field and `setEventLogger()` method. Emit events (synchronously, fire-and-forget) from `reserveBudget`, `recordSpend`, and `releaseReservation`. The callback itself is synchronous; async DB work happens inside the callback closure.

3. Wire up in `preparePipelineRun` and `prepareResumedPipelineRun` in `evolution/src/lib/index.ts`:
```typescript
// After costTracker creation, before building ctx:
const runId = inputs.runId;
costTracker.setEventLogger((event) => {
  // Fire-and-forget Supabase insert (uses service role, bypasses RLS)
  supabaseAdmin.from('evolution_budget_events').insert({
    run_id: runId,
    event_type: event.eventType,
    agent_name: event.agentName,
    amount_usd: event.amountUsd,
    total_spent_usd: event.totalSpentUsd,
    total_reserved_usd: event.totalReservedUsd,
    available_budget_usd: event.availableBudgetUsd,
    invocation_id: event.invocationId ?? null,
    iteration: event.iteration ?? null,
  }).then(({ error }) => {
    if (error) logger.warn('Budget event insert failed', { error: error.message });
  });
});
```

Key design choices:
- Uses `supabaseAdmin` (service role) to bypass RLS -- avoids the same silent failure class as Phase 5
- The callback is synchronous (returns void); the Supabase insert is fire-and-forget via `.then()` so it never blocks the LLM hot path
- Both `preparePipelineRun` and `prepareResumedPipelineRun` get the same wiring

**Tests (colocated):**
- `evolution/src/lib/core/costTracker.test.ts`:
  - `setEventLogger` callback fires with correct `eventType` and running totals for reserve/spend/release sequence
  - Without `setEventLogger`, no errors (logger is optional)

### Phase 3: Fix BudgetExceededError message

**Files modified:**
- `evolution/src/lib/types.ts` (BudgetExceededError constructor)
- `evolution/src/lib/core/costTracker.ts` (throw site)

**Change:** Update `BudgetExceededError` to include both spent and reserved:
```typescript
export class BudgetExceededError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly spent: number,
    public readonly reserved: number,
    public readonly cap: number,
  ) {
    super(`Budget exceeded for ${agentName}: spent $${spent.toFixed(4)} + $${reserved.toFixed(4)} reserved = $${(spent + reserved).toFixed(4)} committed, cap $${cap.toFixed(4)}`);
  }
}
```

Update throw site in `costTracker.ts:26`:
```typescript
throw new BudgetExceededError('total', this.totalSpent, this.totalReserved, this.budgetCapUsd);
```

**All callers that construct BudgetExceededError (must be updated from 3-arg to 4-arg):**
- `evolution/src/lib/core/costTracker.ts:26` -- the production throw site
- `evolution/src/lib/core/costTracker.test.ts` -- test assertions
- `evolution/src/lib/core/critiqueBatch.test.ts:149, 162` -- `new BudgetExceededError('test', 1.0, 0.5)` -> add 0 reserved
- `evolution/src/lib/core/persistence.test.ts:83, 97` -- `new BudgetExceededError('generation', 5.0, 5.0)` -> add 0 reserved
- `evolution/src/lib/core/pipelineFlow.test.ts:192` -- `new BudgetExceededError('flowCritique', 1.0, 0.5)` -> add 0 reserved
- `evolution/src/lib/core/pipeline.test.ts:1379` -- `new BudgetExceededError('tournament', 5.0, 5.0)` -> add 0 reserved
- `evolution/src/lib/core/errorClassification.test.ts:66` -- `new BudgetExceededError('test', 1.0, 0.5)` -> add 0 reserved
- `evolution/src/lib/treeOfThought/beamSearch.test.ts:287, 311, 331, 332, 344` -- add 0 reserved
- `evolution/src/lib/agents/debateAgent.test.ts:210` -- add 0 reserved
- `evolution/src/lib/agents/sectionDecompositionAgent.test.ts:208` -- add 0 reserved
- `evolution/src/lib/agents/calibrationRanker.test.ts:183, 201` -- add 0 reserved
- `evolution/src/lib/agents/outlineGenerationAgent.test.ts:234` -- add 0 reserved
- `evolution/src/lib/agents/treeSearchAgent.test.ts:270, 278` -- add 0 reserved
- `evolution/src/lib/agents/iterativeEditingAgent.test.ts:369, 584` -- add 0 reserved
- `src/__tests__/integration/evolution-pipeline.integration.test.ts:202` -- add 0 reserved

Pattern: all test-site constructors use `(name, spent, cap)`. These become `(name, spent, 0, cap)` -- the `0` for reserved is correct since tests are simulating a budget-exceeded scenario where the exact reserved amount doesn't matter.

**Tests:**
- Existing tests pass after mechanical update (3-arg -> 4-arg with `0` reserved)
- Add one new test in `costTracker.test.ts` verifying the error message includes both spent and reserved amounts

### Phase 4: Fix GenerationAgent model passthrough

**Files modified:**
- `evolution/src/lib/agents/generationAgent.ts`

**Change:** The `GenerationAgent.execute()` method receives the full `ExecutionContext` which includes `ctx.payload.config`. The config has a `generationModel` field. Pass it through to `llmClient.complete()`:
```typescript
// In generationAgent.ts, line ~79:
const generatedText = await llmClient.complete(prompt, this.name, {
  model: ctx.payload.config.generationModel,
  invocationId,
});
```

**Tests (colocated):**
- `evolution/src/lib/agents/generationAgent.test.ts`: Verify `complete()` is called with `{ model: config.generationModel, invocationId }` where `config.generationModel` comes from `ctx.payload.config`

### Phase 5: Fix llmCallTracking silent failures

**Files modified:**
- `src/lib/services/llms.ts` (the `saveLlmCallTracking` function)

**Investigation approach:** The existing `saveLlmCallTracking` (llms.ts) already has error logging. The likely root cause is the FK constraint `evolution_invocation_id` referencing `evolution_agent_invocations.id` -- the invocation row may not yet exist when the LLM tracking row is inserted (race condition: LLM call completes before the invocation row is committed).

**Fix options (investigate at execution time):**
1. Make the FK nullable and insert without it, then backfill
2. Ensure invocation row is committed before LLM calls begin
3. Remove the FK constraint and rely on application-level consistency
4. Use deferred FK constraint

**Minimum change:** Add the `evolution_invocation_id` only when it's confirmed to exist (check before insert), and ensure error logging is visible even in production (currently may be swallowed by the generic catch).

**Tests:**
- `src/lib/services/llms.test.ts` (colocated) or `src/__tests__/integration/evolution-pipeline.integration.test.ts`: Verify that after an evolution LLM call completes, a row exists in `llmCallTracking` with the correct `evolution_invocation_id` and `estimated_cost_usd > 0`

## Testing

### Unit Tests (new/modified, colocated with source files)
- `evolution/src/lib/core/costTracker.test.ts` -- releaseReservation, setEventLogger, BudgetExceededError 4-arg constructor
- `evolution/src/lib/core/llmClient.test.ts` -- reservation cleanup on callLLM failure, mock CostTracker interface update
- `evolution/src/lib/agents/generationAgent.test.ts` -- model passthrough from config
- **15 mock CostTracker factories** updated with `releaseReservation` + `setEventLogger` (see Phase 1 list)
- **19 test files** with BudgetExceededError constructor calls updated (3-arg -> 4-arg, see Phase 3 list)

### Integration Tests
- Budget event log rows created during a pipeline run
- llmCallTracking rows created (currently 0 in prod)

### Manual Verification on Stage
- Run an evolution experiment with a small budget ($0.10, 10 iterations)
- Verify run completes iterations proportional to budget (not stopping early)
- Query `evolution_budget_events` to verify full audit trail with reserve/spend/release events
- Query `llmCallTracking` to verify rows exist with cost data
- Intentionally trigger an LLM failure (e.g., invalid model) and verify reservation is released (check `evolution_budget_events` for `release_ok` event after failure)

## Documentation Updates

- `evolution/docs/evolution/cost_optimization.md` -- Document the budget event log table and how to query it for debugging
- `evolution/docs/evolution/reference.md` -- Update CostTracker API docs with `releaseReservation`, `setEventLogger`, and `BudgetEventLogger`
- `docs/docs_overall/debugging.md` -- Add section on debugging budget exhaustion using `evolution_budget_events`
