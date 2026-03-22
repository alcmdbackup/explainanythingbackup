# Cost Optimization

The evolution system uses a two-layer budget model to prevent runaway LLM spending. Layer 1 (per-run) enforces synchronous reserve-before-spend tracking within a single pipeline execution. Layer 2 (global) enforces daily and monthly caps across all runs via database-backed reservations with in-memory caching. Both layers must approve a call before it proceeds.

For how costs fit into the pipeline lifecycle, see [Architecture](./architecture.md). For the database tables that store cost data, see [Data Model](./data_model.md).

---

## Two-Layer Budget Flow

```
LLM Call Request
       |
       v
+------------------+     throws BudgetExceededError
| Layer 1: Local   |----> (per-run cap exceeded)
| V2CostTracker    |
| (synchronous)    |
+--------+---------+
         | reserve OK
         v
+------------------+     throws GlobalBudgetExceededError
| Layer 2: Global  |----> (daily/monthly cap exceeded)
| LLMSpendingGate  |
| (DB + cache)     |     throws LLMKillSwitchError
+--------+---------+----> (emergency stop)
         | both pass
         v
   Execute LLM Call
         |
         v
  +------+-------+
  | Record spend  |  costTracker.recordSpend()
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

## Token Estimation

**File:** `evolution/src/lib/pipeline/llm-client.ts`

Cost estimation before an LLM call uses a simple heuristic: **1 token ~ 4 characters** for English text. Input tokens are derived from prompt length (`Math.ceil(chars / 4)`), and output tokens use fixed estimates per agent:

| Agent Phase | Estimated Output Tokens |
|-------------|------------------------|
| generation  | 1000                   |
| evolution   | 1000                   |
| ranking     | 100                    |

The estimated cost formula:

```
cost = (inputTokens * inputPer1M + outputTokens * outputPer1M) / 1,000,000
```

This estimate feeds into `costTracker.reserve()` (with the 1.3x margin applied on top). After the call completes, actual token counts from the API response replace the estimate via `recordSpend()`.

The 4-chars-per-token heuristic is a rough approximation for English text. It works reasonably well for the evolution pipeline because prompts are predominantly natural language (article text, critique instructions, comparison prompts). For code-heavy content or non-Latin scripts, actual token counts may diverge significantly from this estimate -- the 1.3x safety margin in the cost tracker is designed to absorb this variance.

> **Warning:** The output token estimates are static defaults. A generation agent producing a 5000-word article will use far more than the estimated 1000 output tokens. The system handles this correctly through the reserve/spend reconciliation pattern, but it means the reservation may undercount, and the budget overrun log message is expected for long-form generation calls.

---

## LLM Pricing Table

**File:** `src/config/llmPricing.ts`

Prices per 1M tokens (USD). The table includes 30+ model entries; these are the ones most relevant to evolution runs:

| Model               | Input / 1M | Output / 1M |
|---------------------|-----------|-------------|
| gpt-4.1-nano        | $0.10     | $0.40       |
| gpt-4.1-mini        | $0.40     | $1.60       |
| gpt-4.1             | $2.00     | $8.00       |
| gpt-4o              | $2.50     | $10.00      |
| gpt-4o-mini         | $0.15     | $0.60       |
| deepseek-chat       | $0.14     | $0.28       |
| claude-sonnet-4     | $3.00     | $15.00      |
| claude-3-5-haiku    | $0.80     | $4.00       |
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

3. **Fast path** (30s cache TTL) -- If cached spending is well below the daily cap (10% headroom), approves without a DB round-trip.

4. **Near-cap path** -- When spending is close to the cap or cache is cold, calls `check_and_reserve_llm_budget` RPC for an atomic DB reservation. Throws `GlobalBudgetExceededError` if denied.

5. **Monthly cap check** (60s cache TTL) -- Verifies cumulative monthly spend against `monthly_cap_usd`. Throws `GlobalBudgetExceededError` if exceeded.

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

Four error classes handle budget failures at different levels:

| Error                            | Scope     | Source File                                  |
|----------------------------------|-----------|----------------------------------------------|
| `BudgetExceededError`            | Per-run   | `evolution/src/lib/types.ts`                 |
| `BudgetExceededWithPartialResults` | Per-run | `evolution/src/lib/pipeline/errors.ts`       |
| `GlobalBudgetExceededError`      | System    | `src/lib/errors/serviceError.ts`             |
| `LLMKillSwitchError`            | System    | `src/lib/errors/serviceError.ts`             |

```typescript
// Per-run: thrown by V2CostTracker.reserve()
class BudgetExceededError extends Error {
  constructor(agentName: string, spent: number, reserved: number, cap: number);
}

// Per-run: thrown when budget runs out mid-generation but some variants exist
class BudgetExceededWithPartialResults extends BudgetExceededError {
  constructor(partialVariants: TextVariation[], originalError: BudgetExceededError);
}
```

> **Warning:** `BudgetExceededWithPartialResults` extends `BudgetExceededError`. In `catch` blocks, check for `BudgetExceededWithPartialResults` **before** `BudgetExceededError`, or the subclass will be caught by the parent and the partial variants will be lost. This is a common source of bugs.

The global errors (`GlobalBudgetExceededError` and `LLMKillSwitchError`) both extend `ServiceError` from the main app's error infrastructure. They carry structured `details` (category, daily totals, caps) that can be logged or surfaced in admin UI. The kill switch error has no constructor parameters -- it always produces the same message ("LLM kill switch is enabled -- all LLM calls are blocked").

When handling errors in pipeline code, the typical pattern is:

1. Catch `BudgetExceededWithPartialResults` -- save the partial variants to the database, mark the run as `completed` with exit reason `budget`
2. Catch `BudgetExceededError` -- no partial results available, mark the run as `failed`
3. Catch `LLMKillSwitchError` -- abort immediately, do not retry
4. Catch `GlobalBudgetExceededError` -- log the cap details, mark the run as `failed`

---

## Budget Event Logging

**Table:** `evolution_budget_events`
**Migration:** `supabase/migrations/20260306000001_evolution_budget_events.sql`

Every budget operation is logged for audit and debugging:

| Column              | Type          | Description                          |
|---------------------|---------------|--------------------------------------|
| `run_id`            | UUID          | FK to `evolution_runs`               |
| `event_type`        | TEXT          | `reserve`, `spend`, `release_ok`, `release_failed` |
| `agent_name`        | TEXT          | Which agent (generation, ranking, evolution) |
| `amount_usd`        | NUMERIC(10,6) | Dollar amount of this event          |
| `total_spent_usd`   | NUMERIC(10,6) | Running total after event            |
| `total_reserved_usd`| NUMERIC(10,6) | Running reserved total after event   |
| `available_budget_usd` | NUMERIC(10,6) | Remaining budget after event      |
| `invocation_id`     | UUID          | Links to specific agent invocation   |
| `iteration`         | INTEGER       | Pipeline iteration number            |
| `metadata`          | JSONB         | Additional context                   |

Indexed by `(run_id, created_at)` and `(run_id, event_type)` for efficient querying.

The event log is invaluable for post-mortem analysis of budget exhaustion. To trace a run's spending history, query events ordered by `created_at` and watch the `total_spent_usd` and `available_budget_usd` columns converge. Look for `release_failed` events, which indicate that a reservation could not be cleanly released -- usually due to a bug in error handling. The `metadata` JSONB column carries additional context such as the model used, prompt length, or error details that triggered the event.

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
