# Sanity Check Cost Infra and Add Cost Estimate to Start Pipeline Plan

## User Goal
On the evolution dashboard, when creating a new "strategy" or starting a pipeline run, display the projected cost prior to saving — either automatically or via a "Estimate Cost" button. After runs complete, verify estimate accuracy and surface a cost review panel so the admin can evaluate whether estimates are trustworthy.

## Background
The evolution pipeline has a complete cost estimation module (`costEstimator.ts`) that predicts run costs using historical baselines or heuristic fallback. However, it's only called from a CLI batch script. No server action exposes it to the frontend, the `estimated_cost_usd` DB column is never written, and `computeCostPrediction()` (estimated vs actual delta) is never called. The admin UI shows actual costs after runs complete but never shows estimates before a run starts.

## Problem
Users have no visibility into projected cost before starting a pipeline run or creating a strategy. The "Start Run" card and strategy editor both accept budget inputs but don't show what the run will likely cost given the selected models, iterations, and agent configuration. After runs complete, there's no way to evaluate whether cost predictions were accurate, which makes it hard to trust estimates or improve the estimation model. Additionally, `refreshAgentCostBaselines()` has no scheduled caller, so the data-driven estimation path is inactive — all estimates fall back to heuristics.

## Options Considered

### Pre-run estimation trigger
1. **Button click** — User clicks "Estimate Cost" after selecting strategy + budget → calls server action → shows result. Pros: explicit, no wasted calls. Cons: extra click.
2. **Auto-estimate on strategy change** — Estimate fires automatically when strategy dropdown changes. Pros: seamless. Cons: extra API calls on every selection change; needs debounce.
3. **Hybrid** — Auto-estimate on strategy change with debounce, plus manual "Refresh Estimate" button. **Selected approach.**

### Where to show estimates
1. **StartRunCard only** — Minimal change, shows estimate before pipeline start.
2. **StartRunCard + StrategyDialog** — Also show when creating/editing strategies.
3. **StartRunCard + StrategyDialog + Runs table** — Also show est. cost column in runs table for completed runs.
4. **All above + dedicated Cost Review panel** — Full accuracy monitoring. **Selected approach (phased).**

### Baseline refresh strategy
1. **Cron job** — Daily/weekly refresh via scheduled endpoint. Simple but decoupled from actual usage.
2. **Lazy refresh** — When estimate is requested and baselines are stale (>24h), refresh first. Pros: always fresh when needed. Cons: first estimate after staleness is slow.
3. **Post-run refresh** — Call `refreshAgentCostBaselines()` inside `finalizePipelineRun()` after each completed run. Pros: baselines improve with every run. Cons: adds ~1s to finalization. **Selected approach.**

## Input Validation & Security

All server actions in this plan follow the project's admin-only pattern (`requireAdmin()` gate). Additional validation:

- **`strategyId`**: Validate as UUID v4 format before DB query. Reject with `400 Bad Request` if malformed.
- **`budgetCapUsd`**: Validate `typeof === 'number'`, `isFinite()`, range `0.01–100.00`. Reject out-of-range values.
- **`textLength`**: Validate as positive integer, clamp to range `100–100000`. Default `5000` if omitted.
- **JSONB columns** (`cost_estimate_detail`, `cost_prediction`): Validate shape before write using a Zod schema:
  ```typescript
  const RunCostEstimateSchema = z.object({
    totalUsd: z.number().nonnegative(),
    perAgent: z.record(z.string(), z.number().nonnegative()),
    perIteration: z.number().nonnegative(),
    confidence: z.enum(['high', 'medium', 'low']),
  });
  const CostPredictionSchema = z.object({
    estimatedUsd: z.number().nonnegative(),
    actualUsd: z.number().nonnegative(),
    deltaUsd: z.number(),
    deltaPercent: z.number(),
    confidence: z.enum(['high', 'medium', 'low']),
    perAgent: z.record(z.string(), z.object({
      estimated: z.number().nonnegative(),
      actual: z.number().nonnegative(),
    })),
  });
  ```
- **Race condition mitigation for `refreshAgentCostBaselines()`**: The function is called inside `finalizePipelineRun()` which runs once per completed run. Concurrent runs finalizing simultaneously could invoke it in parallel. Mitigation: use a Supabase advisory lock (`pg_try_advisory_lock`) at the start of `refreshAgentCostBaselines()` so concurrent callers skip rather than collide. This is a best-effort optimization — stale baselines are acceptable since heuristic fallback is always available.
  - **Implementation**: Call `supabase.rpc('pg_try_advisory_lock', { key: 8675309 })` (fixed numeric key, constant `BASELINE_REFRESH_LOCK_KEY = 8675309`). If lock not acquired, return `{ updated: 0, errors: [], skipped: true }`. Release is automatic at transaction end.
  - **Test mechanics**: Mock the Supabase `rpc` call. First call returns `true` (lock acquired) → verify refresh runs. Second concurrent call returns `false` (lock held) → verify function returns early with `skipped: true` and does not execute any aggregate queries.
- **Zod validation failure handling**: If `RunCostEstimateSchema.safeParse()` fails at queue time, log the error and set `estimated_cost_usd = null` / `cost_estimate_detail = null` (graceful degradation — queueing still succeeds). If `CostPredictionSchema.safeParse()` fails at finalization, log the error and skip writing `cost_prediction` (finalization still succeeds). These are defensive guards against unexpected data shapes from the estimator.

## Type Definitions

New types to add to `src/lib/evolution/types.ts`:

```typescript
/** Extended run row fields for cost estimation */
export interface RunCostFields {
  estimated_cost_usd: number | null;
  cost_estimate_detail: RunCostEstimate | null;
  cost_prediction: CostPrediction | null;
}

/** Strategy accuracy stats returned by getStrategyAccuracyAction */
export interface StrategyAccuracyStats {
  strategyId: string;
  strategyName: string;
  runCount: number;
  avgDeltaPercent: number;
  stdDevPercent: number;
}

/** Cost accuracy overview returned by getCostAccuracyOverviewAction */
export interface CostAccuracyOverview {
  recentDeltas: Array<{ runId: string; deltaPercent: number; createdAt: string }>;
  perAgentAccuracy: Record<string, { avgEstimated: number; avgActual: number; avgDeltaPercent: number }>;
  confidenceCalibration: Record<'high' | 'medium' | 'low', { count: number; avgAbsDeltaPercent: number }>;
  outliers: Array<{ runId: string; deltaPercent: number; estimatedUsd: number; actualUsd: number }>;
}
```

## Phased Execution Plan

### Phase 1: Server action + StartRunCard integration
**Goal:** Show estimated cost before starting a pipeline run.

**Files to create/modify:**
- `src/lib/services/evolutionActions.ts` — Add `estimateRunCostAction(strategyId, budgetCapUsd, textLength?)` server action
  - Follow the enhanced server action pattern: `withLogging` + `serverReadRequestId` + `handleError` (matching `strategyRegistryActions.ts`)
  - Validate inputs: `strategyId` as UUID, `budgetCapUsd` as number in `[0.01, 100.00]`, `textLength` as positive int in `[100, 100000]` (default 5000)
  - Fetches strategy config from `strategy_configs` via `supabase.from('strategy_configs').select('config').eq('id', strategyId).single()`
  - Maps `StrategyConfig` → `RunCostConfig`: `{ generationModel, judgeModel, maxIterations: config.iterations, agentModels }`
  - Calls `estimateRunCostWithAgentModels(runCostConfig, textLength ?? 5000)` (default 5000 chars)
  - Returns `RunCostEstimate { totalUsd, perAgent, perIteration, confidence }`
  - **Cold-start handling**: If `agent_cost_baselines` table is empty (no prior runs), the estimator falls back to heuristics and returns `confidence: 'low'`. The UI should indicate "Estimate based on heuristics — accuracy improves after first run."
- `src/app/admin/quality/evolution/page.tsx` — Update `StartRunCard`:
  - After strategy selection changes (debounced 500ms), call `estimateRunCostAction`
  - Display: "Estimated cost: $X.XX (confidence: high/medium/low)" below the budget input
  - When `confidence === 'low'`, show info tooltip: "No historical data yet — estimate is heuristic-based"
  - Show per-agent breakdown in a collapsible detail section
  - If estimate > budget, show warning: "Estimate ($X.XX) exceeds budget ($Y.YY)"

**Tests:**
- `src/lib/services/evolutionActions.test.ts` — Unit test for `estimateRunCostAction`:
  - Mock strategy fetch + mock `estimateRunCostWithAgentModels`
  - Test invalid `strategyId` (non-UUID) → returns validation error
  - Test `budgetCapUsd` out of range → returns validation error
  - Test `textLength` clamping (negative → rejected, 0 → rejected, 200000 → clamped to 100000)
  - Test cold-start: mock `estimateRunCostWithAgentModels` returning `confidence: 'low'` → verify passthrough
  - Test strategy not found → returns appropriate error

### Phase 2: Store estimate at queue time
**Goal:** Persist the estimate so it can be compared to actuals later.

**Files to modify:**
- `src/lib/services/evolutionActions.ts` — In `queueEvolutionRunAction`:
  - After resolving strategy config, call `estimateRunCostWithAgentModels()`
  - Validate result with `RunCostEstimateSchema` before writing
  - Write `estimated_cost_usd` (total) to `content_evolution_runs` row (column already exists, currently unpopulated)
  - Write full `RunCostEstimate` to new `cost_estimate_detail` JSONB column
- `supabase/migrations/` — New migration: `20260210000001_add_cost_estimate_columns.sql`
  - Add `cost_estimate_detail JSONB DEFAULT NULL` to `content_evolution_runs`
  - Add `cost_prediction JSONB DEFAULT NULL` to `content_evolution_runs`
  - Note: `estimated_cost_usd NUMERIC` column already exists (added in migration `20260205000003`). This migration only adds the two new JSONB columns.
  - Add comment: `COMMENT ON COLUMN content_evolution_runs.cost_estimate_detail IS 'Full RunCostEstimate JSON stored at queue time';`
  - Add comment: `COMMENT ON COLUMN content_evolution_runs.cost_prediction IS 'CostPrediction JSON comparing estimate to actual, stored at completion';`
  - **Rollback SQL** (in comment block at top of migration):
    ```sql
    -- ROLLBACK:
    -- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS cost_estimate_detail;
    -- ALTER TABLE content_evolution_runs DROP COLUMN IF EXISTS cost_prediction;
    ```

**Tests:**
- Update `queueEvolutionRunAction` integration test to verify `estimated_cost_usd` is populated
- Test that `cost_estimate_detail` JSONB matches `RunCostEstimateSchema`
- Test that queueing still succeeds if estimation throws (graceful degradation — set `estimated_cost_usd = null`)

### Phase 3: Compute delta at completion + refresh baselines
**Goal:** After each run, compute estimated-vs-actual delta and refresh baselines.

**Files to modify:**
- `src/lib/evolution/core/pipeline.ts` — In `finalizePipelineRun()`, after `persistAgentMetrics()`:
  - Read `cost_estimate_detail` from the run row
  - If present, call `computeCostPrediction(estimated, costTracker.getAllAgentCosts())`
  - Validate result with `CostPredictionSchema` before writing
  - Store result as `content_evolution_runs.cost_prediction` JSONB
  - Call `refreshAgentCostBaselines(30)` to update baselines for future estimates
  - **Latency note**: `refreshAgentCostBaselines()` adds ~1-2s to finalization. This is acceptable because finalization already performs multiple DB writes (agent metrics, strategy aggregates, hall of fame) and runs asynchronously after pipeline completion. The baseline refresh is fire-and-forget — if it fails, the run still finalizes successfully.
  - **Error handling**: Wrap both `computeCostPrediction` and `refreshAgentCostBaselines` in try-catch. Log errors but do not fail the finalization.
- `src/lib/evolution/index.ts` — Export `computeCostPrediction` and `refreshAgentCostBaselines`

**Tests:**
- Unit test: `finalizePipelineRun` stores `cost_prediction` when `cost_estimate_detail` exists on run row
- Unit test: `finalizePipelineRun` skips `computeCostPrediction` when no estimate exists (no error)
- Unit test: `refreshAgentCostBaselines` is called after completion
- Unit test: `refreshAgentCostBaselines` failure does not fail finalization (error is logged)
- Unit test: Concurrent `refreshAgentCostBaselines` calls — verify advisory lock prevents duplicate work

### Phase 4: Surface estimate vs actual in existing UI
**Goal:** Show cost accuracy on run detail and runs table.

**Files to modify:**
- `src/lib/services/evolutionVisualizationActions.ts` — Update `getEvolutionRunBudgetAction` to also return `estimated_cost_usd`, `cost_estimate_detail`, `cost_prediction` from the run row
- `src/components/evolution/tabs/BudgetTab.tsx` — Add estimated vs actual comparison:
  - Side-by-side bars per agent (estimated in outline, actual in solid)
  - Delta badge: "+12% over estimate" or "-5% under estimate"
  - Confidence indicator from the original estimate
  - **Graceful degradation**: If `cost_estimate_detail` is null, hide the comparison section entirely (show only actual costs as today)
- `src/app/admin/quality/evolution/page.tsx` — Add "Est." column to runs table:
  - Show `estimated_cost_usd` formatted as dollar amount
  - Color-code: green (actual ≤ estimate), amber (10-30% over), red (>30% over)
  - Show "—" for runs without estimates

**Tests:**
- `BudgetTab.test.tsx` — Test rendering with estimate data (side-by-side bars, delta badge, confidence)
- `BudgetTab.test.tsx` — Test rendering without estimate data (comparison section hidden)
- `evolutionVisualizationActions.test.ts` — Test that budget action returns estimate fields when present
- `evolutionVisualizationActions.test.ts` — Test that budget action returns nulls for estimate fields when absent

### Phase 5: Strategy accuracy aggregates
**Goal:** Show how predictable each strategy's cost is.

**Files to modify:**
- `src/lib/services/costAnalyticsActions.ts` — New file for cost accuracy actions (keeps `eloBudgetActions.ts` focused on ELO/budget concerns). Add `getStrategyAccuracyAction()`:
  - Follow enhanced server action pattern (`withLogging` + `serverReadRequestId` + `handleError`)
  - Query `content_evolution_runs` grouped by `strategy_config_id`
  - For runs with both `estimated_cost_usd` and `total_cost_usd`: compute avg delta %, std dev
  - Return `StrategyAccuracyStats[]`
- `src/app/admin/quality/strategies/page.tsx` — Show accuracy in `StrategyDetailRow`:
  - "Avg estimation error: ±15% across 8 runs"
  - Or "No estimate data yet" for strategies without estimates

**Tests:**
- `costAnalyticsActions.test.ts` — Unit test for accuracy aggregation with mock data
- `costAnalyticsActions.test.ts` — Test with no matching runs → returns empty array
- `costAnalyticsActions.test.ts` — Test with runs missing estimates → excluded from calculation

### Phase 6: Cost Review panel on optimization dashboard
**Goal:** Dedicated panel for monitoring estimation accuracy system-wide.

**Files to create/modify:**
- `src/lib/services/costAnalyticsActions.ts` — Add `getCostAccuracyOverviewAction()`:
  - Follow enhanced server action pattern
  - Accuracy over time: `deltaPercent` for last N runs (default N=50)
  - Per-agent accuracy: avg estimated vs avg actual per agent
  - Confidence calibration: accuracy grouped by confidence level
  - Outliers: runs where `abs(deltaPercent) > 50%`
  - Return `CostAccuracyOverview`
- `src/app/admin/quality/optimization/page.tsx` — Add "Cost Accuracy" tab:
  - Line chart: estimation delta % over time (Recharts)
  - Table: per-agent accuracy breakdown
  - Cards: "High confidence accuracy: ±8%", "Low confidence accuracy: ±42%"
  - Outlier list with links to run detail

**Tests:**
- `costAnalyticsActions.test.ts` — Unit test for overview action with mock data
- `costAnalyticsActions.test.ts` — Test with empty data → returns zeroed structure
- Component test for the Cost Accuracy tab

### Phase 7 (optional): Estimate in StrategyDialog
**Goal:** Show cost estimate when creating/editing strategies.

**Files to modify:**
- `src/app/admin/quality/strategies/page.tsx` — In `StrategyDialog`:
  - After model/iteration fields change (debounced), call `estimateRunCostAction` with the form's current config
  - Display estimate below the form: "Projected cost per run: ~$X.XX"
  - Useful for comparing presets before saving

## Testing

### Unit tests (new)
- `estimateRunCostAction` — Mock strategy fetch, verify correct `RunCostConfig` mapping
- `estimateRunCostAction` — Input validation: invalid UUID, out-of-range budget, invalid textLength
- `estimateRunCostAction` — Cold-start: empty baselines → heuristic fallback with `confidence: 'low'`
- `estimateRunCostAction` — Strategy not found → appropriate error
- `queueEvolutionRunAction` — Zod validation failure on `RunCostEstimateSchema` → graceful degradation (sets `estimated_cost_usd = null`, queue succeeds)
- `finalizePipelineRun` cost prediction path — Verify `computeCostPrediction` called when estimate exists
- `finalizePipelineRun` cost prediction path — Verify skipped when no estimate (no error)
- `finalizePipelineRun` cost prediction path — Verify `refreshAgentCostBaselines` failure doesn't fail finalization
- `finalizePipelineRun` cost prediction path — Zod validation failure on `CostPredictionSchema` → `cost_prediction` not written, finalization succeeds
- `refreshAgentCostBaselines` — Advisory lock acquired → refresh runs, aggregates updated
- `refreshAgentCostBaselines` — Advisory lock not acquired (concurrent call) → returns `{ skipped: true }`, no aggregate queries executed
- `getStrategyAccuracyAction` — Aggregation logic with mock data
- `getStrategyAccuracyAction` — Empty/missing estimate data → excluded from stats
- `getCostAccuracyOverviewAction` — Overview computation with mock data
- `getCostAccuracyOverviewAction` — Empty data → zeroed structure

### Component tests (new)
- `StartRunCard` — Displays estimate after strategy selection (mock `estimateRunCostAction` return)
- `StartRunCard` — Debounce: rapid strategy changes only trigger one `estimateRunCostAction` call (use `jest.useFakeTimers`, advance 500ms)
- `StartRunCard` — Shows "Estimate exceeds budget" warning when `totalUsd > budgetCapUsd`
- `StartRunCard` — Shows low-confidence tooltip when `confidence === 'low'`
- `StartRunCard` — Collapses/expands per-agent breakdown
- `StartRunCard` — Shows loading state during estimate fetch
- Runs table — "Est." column renders `estimated_cost_usd` formatted as dollar amount
- Runs table — Color-codes: green (actual ≤ estimate), amber (10-30% over), red (>30% over)
- Runs table — Shows "—" for runs without estimates
- Cost Accuracy tab — Renders line chart with delta % data points
- Cost Accuracy tab — Renders empty state when no runs have estimate data
- Cost Accuracy tab — Outlier list renders clickable links to run detail

### Unit tests (updated)
- `BudgetTab.test.tsx` — Render with estimate data (comparison section shown, side-by-side bars, delta badge)
- `BudgetTab.test.tsx` — Render without estimate data (comparison section hidden, only actual costs shown)
- `evolutionVisualizationActions.test.ts` — Budget action returns estimate fields when present
- `evolutionVisualizationActions.test.ts` — Budget action returns nulls when absent

### Integration tests
- `evolution-actions.integration.test.ts` — Queue run verifies `estimated_cost_usd` is populated
- `evolution-actions.integration.test.ts` — Queue run succeeds even if estimation throws (graceful degradation)
- Full pipeline integration — Verify `cost_prediction` stored after completion
- Full pipeline integration — End-to-end: estimate stored at queue → run completes → cost_prediction computed → delta matches expected

### Migration tests
- Verify migration applies cleanly on a fresh DB
- Verify rollback SQL drops columns without error
- Verify existing rows (without new columns) have `NULL` defaults
- **Note**: Migration CI dry-run validation (e.g., `supabase db push --dry-run` on PRs) is a pre-existing project gap — the current CI pipeline (`ci.yml`) does not validate migrations before merge. Adding a CI gate is out of scope for this feature but noted as a follow-up improvement.

### Manual verification
- Start a run via admin UI → verify estimate shows before clicking "Start Pipeline"
- Verify cold-start behavior: first run shows "heuristic-based estimate" with low confidence
- After run completes → check Budget tab shows estimated vs actual
- Check runs table shows Est. column with color coding
- Check strategy detail shows accuracy stats
- Check Cost Accuracy tab on optimization dashboard

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/elo_budget_optimization.md` — Add cost estimation UI, cost accuracy panel, baseline refresh
- `docs/feature_deep_dives/evolution_pipeline.md` — Add estimated_cost_usd write at queue, cost_prediction at completion, baseline refresh in finalization
- `docs/feature_deep_dives/evolution_framework.md` — Add cost estimate to run creation flow
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — Add est vs actual on Budget tab, Est. column on runs table, Cost Accuracy tab
- `docs/feature_deep_dives/comparison_infrastructure.md` — No changes needed (cost estimate doesn't affect Hall of Fame workflows)
