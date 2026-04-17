# Cost Optimization

The evolution system uses a two-layer budget model to prevent runaway LLM spending. Layer 1 (per-run) enforces synchronous reserve-before-spend tracking within a single pipeline execution. Layer 2 (global) enforces daily and monthly caps across all runs via database-backed reservations with in-memory caching. Both layers must approve a call before it proceeds.

For how costs fit into the pipeline lifecycle, see [Architecture](./architecture.md). For the database tables that store cost data, see [Data Model](./data_model.md).

> **Per-purpose cost split.** Every LLM call passes a typed `AgentName` label as the
> second argument to `llm.complete()` (defined in `evolution/src/lib/core/agentNames.ts`,
> currently `'generation' | 'ranking' | 'seed_title' | 'seed_article'`). The V2 cost
> tracker buckets per-call costs under this label in `phaseCosts[label]` (race-free
> per-key accumulator under Node single-threaded execution). After every call,
> `createLLMClient.ts` writes `cost`, `generation_cost`, and `ranking_cost` to
> `evolution_metrics` via `writeMetricMax` — a Postgres RPC using
> `ON CONFLICT DO UPDATE SET value = GREATEST(...)` so concurrent out-of-order writes
> can never overwrite a larger value with a smaller one. The `COST_METRIC_BY_AGENT`
> lookup determines which static metric name receives the per-purpose write.
>
> **Local integration test setup:** Run `supabase db reset` (or
> `supabase migration up --local`) before `npm run test:integration` to ensure the
> `upsert_metric_max` RPC is available in the local DB. CI applies migrations to staging
> automatically via `.github/workflows/ci.yml` `deploy-migrations` job.

---

## Three-Layer Budget Flow

```
LLM Call Request
       |
       v
+------------------------+     throws BudgetExceededError
| Layer 1a: Per-Run      |----> (run-level cap exceeded — stops entire run)
| V2CostTracker          |
| (synchronous)          |
+--------+---------------+
         | run reserve OK
         v
+------------------------+     throws IterationBudgetExceededError
| Layer 1b: Per-Iteration|----> (iteration cap exceeded — stops this iteration only)
| IterationBudgetTracker |
| (synchronous)          |
+--------+---------------+
         | iteration reserve OK
         v
+------------------+     throws GlobalBudgetExceededError
| Layer 2: Global  |----> (daily/monthly cap exceeded)
| LLMSpendingGate  |
| (DB + cache)     |     throws LLMKillSwitchError
+--------+---------+----> (emergency stop)
         | all pass
         v
   Execute LLM Call
         |
         v
  +------+-------+
  | Record spend  |  iterTracker.recordSpend() → costTracker.recordSpend()
  | Reconcile     |  gate.reconcileAfterCall()
  +--------------+
```

---

## Layer 1: Per-Run Cost Tracker

**File:** `evolution/src/lib/pipeline/cost-tracker.ts`

The V2 cost tracker uses a reserve-before-spend pattern with a 1.3x safety margin. Every LLM call must reserve budget before execution, then either record the actual spend on success or release the reservation on failure.

### Factory and Interface

```typescript
export function createCostTracker(budgetUsd: number): V2CostTracker;

export interface V2CostTracker {
  reserve(phase: string, estimatedCost: number): number;
  recordSpend(phase: string, actualCost: number, reservedAmount: number): void;
  release(phase: string, reservedAmount: number): void;
  getTotalSpent(): number;
  getPhaseCosts(): Record<string, number>;
  getAvailableBudget(): number;
}
```

### Reserve-Before-Spend Lifecycle

1. **`reserve(phase, estimatedCost)`** -- Multiplies the estimate by 1.3x (the `RESERVE_MARGIN`) and checks if `totalSpent + totalReserved + margined > budgetUsd`. If so, throws `BudgetExceededError`. Returns the margined amount. This method is **synchronous** -- critical for parallel safety under Node.js's single-threaded event loop.

2. **`recordSpend(phase, actualCost, reservedAmount)`** -- Deducts the reservation from `totalReserved`, adds `actualCost` to `totalSpent`, and accumulates into per-phase costs. Logs an error if spend exceeds the cap (overrun detection, not prevention).

3. **`release(phase, reservedAmount)`** -- Releases the reservation without spending. Used when an LLM call fails or is skipped.

Per-phase costs are tracked under keys like `generation`, `ranking`, and `evolution`, which map to the pipeline's agent names. Use `getPhaseCosts()` to inspect the breakdown after a run. The `getAvailableBudget()` method returns `max(0, budgetUsd - totalSpent - totalReserved)`, giving callers a real-time view of remaining headroom including outstanding reservations.

The tracker is designed as a plain closure (not a class) returned by the factory function. Internal state (`totalSpent`, `totalReserved`, `phaseCosts`) is captured via closure variables, making it impossible for external code to mutate the state directly. This is an intentional design choice for safety in a system where budget correctness is critical.

> **Warning:** The 1.3x margin is a heuristic. Actual costs can still exceed the budget if the LLM returns significantly more tokens than estimated. The tracker logs overruns but does not roll back completed calls. Monitor the `[V2CostTracker] Budget overrun` log message in production to detect models or prompts that consistently exceed estimates.

### Budget Postcondition Assertions

The cost tracker includes runtime postcondition assertions to detect invariant violations:

- **Precondition:** `createCostTracker(budgetUsd)` rejects NaN, Infinity, negative, and zero values.
- **Core invariant (unconditional):** After every `recordSpend()`, if `totalSpent + totalReserved > budgetUsd * 1.01`, an error is logged. This runs in all environments to detect overruns without crashing the pipeline.
- **Strict assertions (gated):** When `EVOLUTION_ASSERTIONS=true` (set in test/dev environments), the tracker throws on postcondition violations:
  - `totalReserved >= 0` after `reserve()`, `recordSpend()`, and `release()`
  - `Number.isFinite(totalSpent)` after `recordSpend()`

Set `EVOLUTION_ASSERTIONS=true` in CI via `jest.setup.js` to catch invariant violations in tests.

---

## Layer 1b: Per-Iteration Budget Enforcement

**File:** `evolution/src/lib/pipeline/infra/trackBudget.ts`

Each iteration in `config.iterationConfigs[]` specifies a `budgetPercent` (1-100).
At runtime, the dollar amount is computed as `(budgetPercent / 100) * totalBudgetUsd`.
The `createIterationBudgetTracker(iterationBudgetUsd, runTracker, iterationIndex)` factory
wraps the run-level `V2CostTracker` with an additional per-iteration budget check.

### Reserve Sequence

1. **Run-level check** — `runTracker.reserve()` is called first. If the run budget is
   exhausted, `BudgetExceededError` is thrown (stops the entire run).
2. **Iteration-level check** — if `iterSpent + iterReserved + margined > iterationBudgetUsd`,
   the run-level reservation is released and `IterationBudgetExceededError` is thrown
   (stops only the current iteration; the loop advances to the next `iterationConfig`).

### IterationBudgetExceededError

```typescript
class IterationBudgetExceededError extends BudgetExceededError {
  readonly iterationIndex: number;
}
```

This error extends `BudgetExceededError` so existing catch blocks that handle budget
errors will also catch iteration budget errors. The orchestrator catches
`IterationBudgetExceededError` specifically at the iteration boundary to record
`stopReason: 'iteration_budget_exceeded'` and continue to the next iteration.

---

## Budget Pressure Tiers

**File:** `evolution/src/lib/pipeline/rank.ts`

The ranking phase scales the number of pairwise comparisons based on how much of the run budget has been consumed. The `budgetFraction` (spent / cap) determines the tier:

| Tier   | Budget Consumed | Max Comparisons |
|--------|-----------------|-----------------|
| Low    | < 50%           | 40              |
| Medium | 50% -- 80%      | 25              |
| High   | 80%+            | 15              |

```typescript
function getBudgetTier(budgetFraction: number): 'low' | 'medium' | 'high' {
  if (budgetFraction >= 0.8) return 'high';
  if (budgetFraction >= 0.5) return 'medium';
  return 'low';
}
```

This ensures ranking degrades gracefully rather than failing outright when a run is near its budget limit. Early iterations get thorough rankings (40 comparisons); later iterations near the cap get abbreviated rankings (15 comparisons) that still produce a usable ordering.

The `budgetFraction` is computed by the pipeline supervisor before each ranking phase and passed into `rankPool()`. The tier is also recorded in the iteration result as `budgetTier` alongside the raw `budgetPressure` value, so the admin UI can display how aggressively ranking was throttled in each iteration. When a run exits with reason `budget`, inspecting the final tier helps determine whether the budget was genuinely insufficient or whether the estimation was too conservative.

---

## Cost Estimation

### Per-Call Estimation (Reserve-Before-Spend)

**File:** `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`

Before each LLM call, cost is estimated using **1 token ~ 4 characters** and fixed output token estimates (1000 for generation, 100 for ranking). This feeds `costTracker.reserve()` with a 1.3x margin. After the call, actual costs are computed from the provider's **real token counts** (`usage.prompt_tokens` + `usage.completion_tokens`) via `calculateLLMCost` — the same helper `llmCallTracking.estimated_cost_usd` uses — and passed to `recordSpend()`. This replaced a string-length heuristic (`response.length / 4`) that inflated actual costs 30–800% for models whose responses don't have a clean 4 chars/token ratio.

### Pre-Dispatch Estimation (Budget-Aware)

**File:** `evolution/src/lib/pipeline/infra/estimateCosts.ts`

Before dispatching generateFromSeedArticle agents, the orchestrator uses empirical cost estimation to determine how many agents the budget can support. This uses:

- **Empirical output characters per strategy** (measured from staging DB):

| Strategy | Avg Output Chars | ~Tokens |
|----------|-----------------|---------|
| grounding_enhance | 11,799 | 2,950 |
| structural_transform | 9,956 | 2,489 |
| lexical_simplify | 5,836 | 1,459 |
| default (other strategies) | 9,197 | 2,299 |

- **Deterministic ranking cost**: `min(poolSize - 1, maxComparisonsPerVariant)` comparisons × 2 LLM calls (bias mitigation) × comparison cost. Comparison prompt = 698 chars overhead + 2 × article length.

Key functions: `estimateGenerationCost()`, `estimateRankingCost()`, `estimateAgentCost()`, `estimateSwissPairCost()`.

### Budget-Aware Dispatch

The orchestrator computes two budget floors from strategy config:
- `parallelFloor` — parallel generation dispatches only up to `budget - parallelFloor` worth of agents
- `sequentialFloor` — sequential generation stops when the next agent would breach this floor

Each floor may be specified in either of two mutually-exclusive units (StrategyConfig fields):
- **Fraction of budget**: `minBudgetAfterParallelFraction` / `minBudgetAfterSequentialFraction` (0-1). Resolves to `budget × fraction`.
- **Multiple of agent cost**: `minBudgetAfterParallelAgentMultiple` / `minBudgetAfterSequentialAgentMultiple` (≥ 0). Resolves to `estAgentCost × N`. Parallel uses the initial `estimateAgentCost()` output. Sequential uses `actualAvgCostPerAgent` once available (live feedback from the parallel batch), falling back to the initial estimate.

Legacy field names `budgetBufferAfterParallel` / `budgetBufferAfterSequential` are migrated to `minBudgetAfter*Fraction` automatically via Zod preprocess, and kept as output aliases for one release cycle to enable safe rollback.

```
|--- Parallel (budget > parallelFloor) ---|--- Sequential (budget > sequentialFloor) ---|--- Swiss ---|
```

After the parallel batch, runtime feedback (`actualAvgCostPerAgent` from completed agents) replaces the empirical estimate for sequential dispatch decisions.

### Estimation Feedback Loop

Each generateFromSeedArticle invocation records `estimatedCost` and `estimationErrorPct` in its `execution_detail` JSONB for post-hoc analysis. The per-phase `generation.cost` and `ranking.cost` in execution_detail use scope-isolated `getOwnSpent()` deltas (not shared `getTotalSpent()` deltas) so they reflect only this agent's own LLM spend under parallel dispatch. Query via:
```sql
SELECT (execution_detail->'generation'->>'estimatedCost')::NUMERIC,
       (execution_detail->>'estimationErrorPct')::NUMERIC
FROM evolution_agent_invocations WHERE agent_name = 'generate_from_seed_article';
```

Finalization rolls these up into run-level metrics (`cost_estimation_error_pct`,
`estimated_cost`, `generation_estimation_error_pct`, `ranking_estimation_error_pct`,
`estimation_abs_error_usd`) and strategy/experiment propagation metrics. The
**Cost Estimates tab** on run and strategy detail pages (see
[Visualization](./visualization.md)) renders these plus a projected-vs-actual
**Budget Floor Sensitivity** module that answers: *how many extra/fewer sequential
invocations ran (and how much wall time was added/saved) because we over/under-
estimated agent invocation cost?*

### Cost Calibration Table (shadow-deploy, 2026-04-14)

Adds a DB-backed replacement for the hardcoded `EMPIRICAL_OUTPUT_CHARS` and
`OUTPUT_TOKEN_ESTIMATES` constants so calibration updates don't require code deploys.

- **Table:** `evolution_cost_calibration` keyed on
  `(strategy, generation_model, judge_model, phase)`.
- **Refresh:** `evolution/scripts/refreshCostCalibration.ts` (daily cron) aggregates
  the last `COST_CALIBRATION_SAMPLE_DAYS` days (default 14) of
  `evolution_agent_invocations.execution_detail` into per-slice upserts.
- **Loader:** `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts` — in-memory
  singleton Map with `COST_CALIBRATION_TTL_MS` (default 5 min) TTL. Promise-coalesced
  refresh for thundering-herd protection. Distinct fallback paths for row-missing
  (silent) vs DB error (log + last-known-good). Aggregated 60s-window
  observability log (`cost_calibration_lookup`).
- **Kill switch:** `COST_CALIBRATION_ENABLED` env var (default `'false'`). When unset
  or `'false'`, the loader returns null and `estimateCosts.ts` + `createEvolutionLLMClient.ts`
  use the existing hardcoded constants — identical to pre-calibration behavior.
  Flip to `'true'` only after two weeks of populated data and verification via the
  Cost Estimates tab.

---

## LLM Pricing Table

**File:** `src/config/llmPricing.ts`

Prices per 1M tokens (USD). The table includes 30+ model entries; these are the ones most relevant to evolution runs:

| Model               | Input / 1M | Output / 1M |
|---------------------|-----------|-------------|
| qwen-2.5-7b-instruct (**default judge**) | $0.04 | $0.10 |
| qwen/qwen3-8b      | $0.05     | $0.40       |
| gpt-5-nano          | $0.05     | $0.40       |
| google/gemini-2.5-flash-lite | $0.10 | $0.40 |
| gpt-4.1-nano        | $0.10     | $0.40       |
| gpt-4.1-mini        | $0.40     | $1.60       |
| gpt-4.1             | $2.00     | $8.00       |
| gpt-4o              | $2.50     | $10.00      |
| gpt-4o-mini         | $0.15     | $0.60       |
| deepseek-chat       | $0.28     | $0.42       |
| claude-sonnet-4     | $3.00     | $15.00      |
| Unknown (fallback)  | $10.00    | $30.00      |

Model lookup uses exact match first, then longest-prefix match (e.g., `gpt-4o-2024-11-20` matches the `gpt-4o` entry). Unknown models fall back to conservative default pricing ($10/$30 per 1M tokens).

Key functions:
- `getModelPricing(model: string): ModelPricing` -- returns `{ inputPer1M, outputPer1M, reasoningPer1M? }`
- `calculateLLMCost(model, promptTokens, completionTokens, reasoningTokens?): number` -- returns USD rounded to 6 decimal places
- `formatCost(cost: number): string` -- `$0.0042` for sub-cent, `$1.23` otherwise

The pricing table also includes reasoning models (o1, o3-mini) with a separate `reasoningPer1M` field. When present, reasoning tokens are billed at this rate in addition to the standard input/output costs. The evolution pipeline does not currently use reasoning models, but the pricing infrastructure supports them for future use.

Note that the evolution pipeline's `llm-client.ts` imports `getModelPricing` from this shared config file rather than maintaining its own pricing. This ensures a single source of truth for all cost calculations across the application.

---

## Layer 2: Global LLM Spending Gate

**File:** `src/lib/services/llmSpendingGate.ts`

The `LLMSpendingGate` is a singleton that enforces system-wide daily and monthly caps. It sits in the main application (not the `evolution/` subtree) because it guards all LLM calls across the system.

### Check Sequence

Each call to `checkBudget(callSource, estimatedCostUsd?)` executes:

1. **Kill switch check** (5s cache TTL) -- If `kill_switch_enabled` is true in `llm_cost_config`, throws `LLMKillSwitchError` immediately.

2. **Category routing** -- `callSource` starting with `evolution_` routes to the `evolution` category with its own daily cap; everything else goes to `non_evolution`.

3. **Fast path** (30s cache TTL) -- If cached spending is well below the daily cap (10% headroom), approves the daily check without a DB round-trip, then falls through to the monthly cap check.

4. **Near-cap path** -- When spending is close to the cap or cache is cold, calls `check_and_reserve_llm_budget` RPC for an atomic DB reservation. Throws `GlobalBudgetExceededError` if denied.

5. **Monthly cap check** (60s cache TTL) -- Always runs (including after the fast path). Verifies cumulative monthly spend against `monthly_cap_usd`. Throws `GlobalBudgetExceededError` if exceeded.

6. **Post-call reconciliation** -- `reconcileAfterCall()` runs in a `finally` block. It calls `reconcile_llm_reservation` RPC to release the reservation and update actual spend. Failures are logged but not re-thrown (non-fatal). The cache for the relevant category is also invalidated so the next call gets a fresh spending snapshot.

The gate uses a singleton pattern via `getSpendingGate()`. The in-memory caches (spending, kill switch, monthly) are instance-level, so they are shared across all concurrent requests within the same Node.js process. Call `invalidateCache()` if you need to force a fresh read from the database (e.g., after changing config values).

### Config Keys

Stored in the `llm_cost_config` table:

| Key                     | Default | Description                    |
|-------------------------|---------|--------------------------------|
| `daily_cap_usd`         | $50     | Non-evolution daily limit      |
| `evolution_daily_cap_usd` | $25   | Evolution daily limit          |
| `monthly_cap_usd`       | $500    | System-wide monthly limit      |
| `kill_switch_enabled`   | false   | Emergency stop for all LLM calls |

> **Warning:** The spending gate fails **closed** -- if the DB is unreachable, all LLM calls are blocked. This is intentional to prevent uncontrolled spending during outages.

---

## Error Hierarchy

Five error classes handle budget failures at different levels:

| Error                            | Scope          | Source File                                  |
|----------------------------------|----------------|----------------------------------------------|
| `BudgetExceededError`            | Per-run        | `evolution/src/lib/types.ts`                 |
| `IterationBudgetExceededError`   | Per-iteration  | `evolution/src/lib/pipeline/infra/trackBudget.ts` |
| `BudgetExceededWithPartialResults` | Per-run      | `evolution/src/lib/pipeline/errors.ts`       |
| `GlobalBudgetExceededError`      | System         | `src/lib/errors/serviceError.ts`             |
| `LLMKillSwitchError`            | System         | `src/lib/errors/serviceError.ts`             |

```typescript
// Per-run: thrown by V2CostTracker.reserve()
class BudgetExceededError extends Error {
  constructor(agentName: string, spent: number, reserved: number, cap: number);
}

// Per-run: thrown when budget runs out mid-phase but partial results exist
class BudgetExceededWithPartialResults extends BudgetExceededError {
  constructor(partialData: unknown, originalError: BudgetExceededError);
}
```

> **Warning:** `BudgetExceededWithPartialResults` extends `BudgetExceededError`. In `catch` blocks, check for `BudgetExceededWithPartialResults` **before** `BudgetExceededError`, or the subclass will be caught by the parent and the partial data will be lost. This is a common source of bugs. The `partialData` field is typed as `unknown` and may contain either `Variant[]` (from the generation phase) or `RankResult` (from the ranking phase). Callers must inspect the data to determine which type they received.

The global errors (`GlobalBudgetExceededError` and `LLMKillSwitchError`) both extend `ServiceError` from the main app's error infrastructure. They carry structured `details` (category, daily totals, caps) that can be logged or surfaced in admin UI. The kill switch error has no constructor parameters -- it always produces the same message ("LLM kill switch is enabled -- all LLM calls are blocked").

When handling errors in pipeline code, the typical pattern is:

1. Catch `BudgetExceededWithPartialResults` -- save the partial variants to the database, mark the run as `completed` with exit reason `budget`
2. Catch `BudgetExceededError` -- no partial results available, mark the run as `failed`
3. Catch `LLMKillSwitchError` -- abort immediately, do not retry
4. Catch `GlobalBudgetExceededError` -- log the cap details, mark the run as `failed`

---

## Agent Cost Scope Pattern

Under parallel agent dispatch, a shared `V2CostTracker` serves two purposes: **budget gating** (must be shared, synchronous `reserve()`) and **cost attribution** (should be per-agent). Without isolation, `getTotalSpent()` deltas absorbed sibling agents' costs — `cost_usd` on invocations was timing-dependent and could be nearly double the true value.

**Solution:** `createAgentCostScope(shared: V2CostTracker): AgentCostScope` (in `trackBudget.ts`) wraps the shared tracker in a per-invocation scope:

- `reserve()`, `release()`, `getTotalSpent()`, `getAvailableBudget()`, `getPhaseCosts()` — **delegated** to shared tracker; budget gating is unchanged
- `recordSpend()` — **intercepted**: calls shared tracker AND increments a private `ownSpent` counter
- `getOwnSpent()` — returns only this scope's LLM costs, independent of other agents

`Agent.run()` creates a scope per invocation, passes it as `costTracker` in `extendedCtx`, AND **builds the `EvolutionLLMClient` inside the scope** (from `ctx.rawProvider` + `ctx.defaultModel` via `createEvolutionLLMClient`). The per-invocation client's `recordSpend` calls go through the scope's intercept, so `scope.getOwnSpent()` is authoritative. `MergeRatingsAgent` opts out via `usesLLM = false` since it doesn't make LLM calls.

The `cost_usd` written to `evolution_agent_invocations` comes from `scope.getOwnSpent()` — the direct sum of this invocation's `recordSpend` calls, with no sibling cost bleed even under parallel dispatch. `detail.totalCost` is still populated (Agent.run falls back to it when `getOwnSpent()` returns 0, as with MergeRatingsAgent which makes no LLM calls).

---

## Budget Event Logging

> **Note:** The `evolution_budget_events` table was dropped during the V2 schema consolidation and no longer exists. The reserve/spend/release pattern is still used in-memory by the `V2CostTracker` (see Layer 1 above), but individual budget events are no longer persisted to a dedicated table. Cost auditing now relies on `evolution_agent_invocations` records and the cost aggregation mechanisms described below.

The conceptual model remains: every LLM call follows a reserve-before-spend lifecycle (`reserve` → `spend` or `release`). The `V2CostTracker` tracks these operations in-memory per run. For post-mortem analysis of budget usage, use the per-run cost summary stored on the `evolution_runs` row and the per-invocation costs in `evolution_agent_invocations`.

### EntityLogger Integration

When an `EntityLogger` instance is passed to `createCostTracker`, budget events are logged as structured log entries with `phaseName: 'budget'`. The following events are emitted:

- **`reserve`** — Logged on each budget reservation with estimated cost and margined amount.
- **`spend`** — Logged when actual cost is recorded after a successful LLM call.
- **`overrun`** — Logged at `warn` level when actual spend exceeds the reserved amount.
- **50% threshold** — Logged at `info` level when cumulative spend crosses 50% of the run budget.
- **80% threshold** — Logged at `warn` level when cumulative spend crosses 80% of the run budget.

Each log entry includes context fields such as `budgetFraction`, `spent`, `reserved`, and `budgetUsd` for post-mortem analysis.

### Controlling Log Volume

The `EVOLUTION_LOG_LEVEL` environment variable (default: `info`) acts as a kill switch for pipeline log volume. Set to `warn` or `error` to suppress `debug` and `info` budget event logs in high-throughput environments. See [Reference — Environment Variables](./reference.md#environment-variables) for details.

---

## Cost Aggregation

**Migration:** `supabase/migrations/20260319000001_evolution_run_cost_helpers.sql`

Three mechanisms aggregate costs from the `evolution_agent_invocations` table:

1. **`get_run_total_cost(p_run_id UUID)`** -- PostgreSQL function (SECURITY DEFINER) returning `COALESCE(SUM(cost_usd), 0)` for a single run. Restricted to `service_role`.

2. **`evolution_run_costs` view** -- Aggregates `SUM(cost_usd)` grouped by `run_id` for batch queries (e.g., admin list pages).

3. **`idx_invocations_run_cost`** -- Covering index on `(run_id, cost_usd)` so cost aggregation queries scan the index without touching the heap.

---

## Cost Analytics (Admin Dashboard)

**File:** `evolution/src/services/costAnalytics.ts`

Server actions for the admin dashboard, all requiring admin authentication:

- **`getCostSummaryAction(filters?)`** -- Returns `totalCost`, `totalCalls`, `totalTokens`, `avgCostPerCall` for a filtered time range (default: last 30 days). Also reports `nullCostCount` for records missing cost data.

- **`getDailyCostsAction(filters?)`** -- Daily breakdown from the `daily_llm_costs` database view. Returns `{ date, callCount, totalTokens, totalCost }[]`.

- **`getCostByModelAction(filters?)`** -- Per-model breakdown with `promptTokens`, `completionTokens`, `reasoningTokens`, and `totalCost`. Sorted by cost descending.

- **`getCostByUserAction(filters?)`** -- Top spenders with `userId`, `callCount`, `totalTokens`, `totalCost`. Accepts `limit` (default 20).

- **`backfillCostsAction(options?)`** -- One-time backfill for records with NULL `estimated_cost_usd`. Processes in batches (default 500), supports `dryRun` mode. Logs an audit action on completion.

---

## Orphaned Reservation Cleanup

**File:** `evolution/src/lib/ops/orphanedReservations.ts`

When a process crashes mid-run, budget reservations in the global spending gate can become orphaned -- permanently blocking that budget capacity. The cleanup function delegates to the gate's `cleanupOrphanedReservations()` method, which calls the `reset_orphaned_reservations` database RPC:

```typescript
export async function cleanupOrphanedReservations(): Promise<void> {
  const gate = getSpendingGate();
  await gate.cleanupOrphanedReservations();
}
```

This should be called periodically (e.g., on server startup or via a scheduled job) to reclaim leaked reservations.

Orphaned reservations are a natural consequence of the two-layer model: the global gate reserves capacity in the database, but if the process crashes between reservation and reconciliation, that capacity is permanently locked. The `reset_orphaned_reservations` RPC identifies reservations that have been held longer than a threshold (typically based on stale timestamps in the `daily_cost_rollups` table) and releases them back to the available pool. Without periodic cleanup, a series of crashes could gradually reduce the effective daily cap to zero.

See [Agents](./agents/overview.md) for how individual agents interact with the budget system.
