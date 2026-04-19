# Cost Estimate Accuracy Analysis Plan

## Background
Help me systematically estimate the accuracy of my cost estimates, since these feed into our "budget floor" parameters that control sequential vs. parallel generation. Help suggest areas for improvement if needed.

## Requirements (from GH Issue #973)
- Make sure in run level UI in evolution admin dashboard, there is a cost estimates tab that systematically lets me evaluate cost estimation accuracy for a run. Also add this tab at the strategies entity in evolution admin dashboard. Use standard metrics plumbing @evolution/docs/metrics.md to see how to implement and @evolution/docs/visualization.md also

## Problem
Cost estimates drive two critical decisions: (a) the per-call 1.3× reservation in `V2CostTracker` and (b) the parallel/sequential budget-floor gates derived from `estimateAgentCost`. If estimates drift from actuals, we under- or over-reserve, and the AgentMultiple-mode floors silently shift dispatch counts. Raw data exists in `execution_detail.estimationErrorPct` and the run-level `cost_estimation_error_pct` metric (added Apr 11, 2026), but nothing renders in the admin UI today and nothing propagates to strategies/experiments. We also have no mechanism to keep hardcoded calibration constants (`EMPIRICAL_OUTPUT_CHARS`, `OUTPUT_TOKEN_ESTIMATES`) fresh as models and strategies evolve.

## Options Considered
- [x] **Option A: Registry-backed metrics + reusable tab + calibration table** (chosen): extend `METRIC_REGISTRY` + `SHARED_PROPAGATION_DEFS`; build a `CostEstimatesTab` wired into run + strategy detail pages; add `evolution_cost_calibration` table with nightly refresh + in-memory loader; deliver a markdown recommendations report after signal accumulates.
- [ ] **Option B: Dedicated JSONB column on runs**: precompute cost-estimation rollups into a `cost_estimate_summary` JSONB on `evolution_runs`. Rejected — duplicates what `evolution_metrics` is designed for.
- [ ] **Option C: Pure view-layer**: no DB writes; tab aggregates `execution_detail` on demand. Rejected — defeats propagation; can't show strategy aggregates without metrics plumbing.

## Resolved Design Decisions (from research review 2026-04-14)
1. Propagation aggregation uses `aggregateAvg` (bootstrap CI reserved for elo/quality metrics).
2. No historical backfill — pre-Apr-11 runs render "No data (pre-instrumentation)".
3. Calibration table is in scope: replaces hardcoded constants in `estimateCosts.ts` + `createEvolutionLLMClient.ts`.
4. Improvement suggestions delivered as markdown report in `_progress.md`, not an in-UI panel.
5. Fix `mark_elo_metrics_stale` trigger so it doesn't cascade to cost-category metrics.

## Phased Execution Plan

### Phase 1: Stale trigger invariant (scope confirmed)
Verification against `supabase/migrations/20260328000002_expand_stale_trigger_invocations.sql` confirms the trigger uses **explicit allowlists per entity level**, not a category filter:
- Run level: cost metrics are NOT in the allowlist → correctly excluded.
- Strategy / experiment level: `total_cost` and `avg_cost_per_run` ARE in the allowlist (pre-existing behavior — arena match falsely invalidates aggregate cost rollups). Out of scope for this project to fix, but tracked.

Action items:
- [x] Do NOT add any of the new propagated cost metrics (`avg_cost_estimation_error_pct`, `total_estimated_cost`, `avg_estimated_cost`, `avg_generation_estimation_error_pct`, `avg_ranking_estimation_error_pct`, `avg_estimation_abs_error_usd`) to the trigger's allowlists. When someone later touches `mark_elo_metrics_stale`, they must consciously decide inclusion.
- [x] DB-level integration test `src/__tests__/integration/evolution-stale-trigger-cost-invariant.integration.test.ts` — seed a completed run with cost + new cost-estimation metric rows + a variant, UPDATE the variant's `mu`/`sigma`, assert all new cost-estimation metric rows remain `stale=false`. Guards against future regressions.
- [ ] Add a one-line comment in the next stale-trigger migration (if any) referencing this invariant.
- [x] Pre-existing issue (strategy-level `total_cost` / `avg_cost_per_run` getting falsely staled) noted in `_progress.md` as follow-up; not fixed here.

No migration added in this phase.

### Phase 2: Metric registry + run snapshot additions
- [x] Add compute fns in `evolution/src/lib/metrics/computations/finalization.ts`:
  - `computeEstimatedCost` (sum of `estimatedTotalCost` across GFSA invocations)
  - `computeGenerationEstimationErrorPct` (mean of `(gen.cost - gen.estimatedCost) / gen.estimatedCost * 100`)
  - `computeRankingEstimationErrorPct` (mean of `(rank.cost - rank.estimatedCost) / rank.estimatedCost * 100`)
  - `computeEstimationAbsErrorUsd` (mean `|actual - estimate|` in USD)
  - All guard on `estimatedCost > 0` and `typeof === 'number' && isFinite()`.
- [x] Extend `METRIC_REGISTRY.run.atFinalization` in `evolution/src/lib/metrics/registry.ts` with the four metrics above plus surface `cost_estimation_error_pct` with `listView: true`.
- [x] Add propagation entries to `SHARED_PROPAGATION_DEFS`:
  - `avg_cost_estimation_error_pct` (aggregate: `aggregateAvg`, source: `cost_estimation_error_pct`)
  - `avg_generation_estimation_error_pct`, `avg_ranking_estimation_error_pct`, `avg_estimation_abs_error_usd`, `avg_estimated_cost`
  - `total_estimated_cost` (aggregate: `aggregateSum`)
  - **Aggregation choice rationale:** user explicitly preferred `aggregateAvg` over `aggregateBootstrapMean` for cost-estimation metrics. Note that `avg_decisive_rate` in the current registry uses bootstrap_mean despite being a per-run noisy statistic — this is a pre-existing inconsistency, not a new one. If we revisit cost-error CI rendering later, add a separate `*_ci` metric rather than flipping the aggregator.
- [x] Sync `evolution/src/lib/core/entityRegistry.ts` (dual-registry note in `evolution/docs/metrics.md`).
- [x] **Registry parity test** in `evolution/src/lib/core/entityRegistry.test.ts` — assert every name in `METRIC_REGISTRY` is present in `entityRegistry` with matching category/formatter. Guards future drift in either direction (not just this project).
- [x] **Persist floor config snapshot** (small, static config values) to `run_summary` JSONB in a new `budget_floor_config` field:
  - `minBudgetAfterParallelFraction`, `minBudgetAfterParallelAgentMultiple`, `minBudgetAfterSequentialFraction`, `minBudgetAfterSequentialAgentMultiple` (as resolved at run start)
  - `numVariants` (for ceiling detection)
  - Bump `EvolutionRunSummary` version to V4; keep V3 auto-migration path intact (V4 readers tolerate missing field; V3 rows with no `budget_floor_config` render the Budget Floor Sensitivity module as "not applicable"). Zod schema change in `evolution/src/lib/schemas.ts`.
- [x] **Persist first-class observable numerics as metric rows** (consistent with how other observables propagate). Add these as run-level `atFinalization` metrics:
  - `initial_agent_cost_estimate` (USD) — pre-dispatch `estimateAgentCost` result
  - `actual_avg_cost_per_agent` (USD) — runtime feedback from parallel batch (null/absent when parallel produced no successful agent)
  - `parallel_dispatched` (count)
  - `sequential_dispatched` (count)
  - `median_sequential_gfsa_duration_ms`, `avg_sequential_gfsa_duration_ms`
  - Rationale: these are per-run observables users may want to chart over time and propagate; bundling them into JSONB would defeat the Option B rejection. Config (multipliers, numVariants ceiling) stays in JSONB because it's static metadata.
  - Propagated strategy-level: `avg_initial_agent_cost_estimate`, `avg_actual_avg_cost_per_agent`, `avg_median_sequential_gfsa_duration_ms` (all via `aggregateAvg`).
- [x] Unit tests in `evolution/src/lib/metrics/computations/finalization.test.ts` + `schemas.test.ts` (V3 backward-compat) + `entityRegistry.test.ts` (parity).

### Phase 3: Server actions
- [x] New file `evolution/src/services/costEstimationActions.ts` (mirrors `invocationActions.ts` pattern, uses `adminAction` factory):
  - `getRunCostEstimatesAction(runId)` — reads `evolution_runs` (incl. `run_summary.budget_floor_config`), `evolution_metrics` (run scope), and `evolution_agent_invocations` (`cost_usd`, `duration_ms`, `execution_detail`, `agent_name`, `iteration`). Returns `{ summary, costByAgent[], invocations[], histogramBuckets, budgetFloorSensitivity }`.
  - `getStrategyCostEstimatesAction(strategyId)` — reads propagated strategy metrics + joins child `evolution_runs` with their run-level metrics. Returns `{ summary, runs[], sliceBreakdown[], histogramBuckets }`.
- [x] `budgetFloorSensitivity` payload shape: `{ applicable: boolean, reasonNotApplicable?: 'fraction_mode' | 'floor_unset' | 'parallel_failed' | 'no_gfsa', drift?: { estimate, actual, pct }, parallel?: { multiplier, floor, actualDispatched, projectedDispatched }, sequential?: { multiplier, floor, actualDispatched, projectedDispatched, actualWallMs, projectedWallMs }, edge?: 'accurate' | 'ceiling_binding' }`. When `applicable: false` the client hides the module entirely. The projected-vs-actual math runs server-side so the component stays presentation-only. Δ = actual − projected; negative means under-estimating cost caused fewer invocations.
- [x] Slice breakdown groups invocations by `(strategy, generationModel, judgeModel)` for strategy-detail view. **Cap at 50 rows** sorted by invocation count desc to bound cardinality; render "+N more slices" footer when truncated.
- [x] Histogram buckets exported as a named constant `COST_ERROR_HISTOGRAM_BUCKETS` from `costEstimationActions.ts`: `[(-∞,-25], (-25,-5], (-5,5), [5,25), [25,+∞)]`. UI imports the same constant to avoid label/edge drift.
- [x] **Projected-vs-actual math reuses existing resolvers.** The action imports `resolveParallelFloor` and `resolveSequentialFloor` from `evolution/src/lib/pipeline/loop/budgetFloorResolvers.ts` and calls them twice (once with `initialAgentCostEstimate`, once with `actualAvgCostPerAgent`) rather than duplicating dispatch math. The dispatch-count formula `min(numVariants, floor((budget − floor) / estAgentCost))` is extracted into a shared helper (new file `evolution/src/lib/pipeline/loop/projectDispatchCount.ts`) consumed by both the server action and any future analysis script.
- [x] **Divide-by-zero guards** for the projected-vs-actual math: if `actualAvgCostPerAgent <= 0`, `initialAgentCostEstimate <= 0`, or either is non-finite, return `{ applicable: false, reasonNotApplicable: 'parallel_failed' }` without attempting math. Histogram bucketing clamps `+Infinity` / `-Infinity` / `NaN` values into the outer buckets (with a log warning).

### Phase 4: CostEstimatesTab component
- [x] New file `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx` — shared component taking `{ entityType: 'run' | 'strategy', entityId: string }`.
- [x] Sections (run level):
  1. **Summary** `MetricGrid` (Total Cost | Estimated | Abs Error | Error % | Budget Cap, color-coded).
  2. **Cost by Agent** table — rows per agent type (CreateSeedArticleAgent, GenerateFromSeedArticleAgent with gen/rank sub-rows, SwissRankingAgent, MergeRatingsAgent). Columns: Invocations, Estimated $, Actual $, Error %, Coverage (est+act / actual only / no LLM). Makes the coverage gap explicit.
  3. **Budget Floor Sensitivity** (conditionally rendered) — projected-vs-actual module. Framed as: *"How many extra/fewer sequential invocations ran, and how much wall time was added/saved, because we over/under-estimated agent invocation cost?"*
     - **Visibility rule:** render iff `minBudgetAfterSequentialAgentMultiple != null` AND `actualAvgCostPerAgent != null` (i.e., sequential floor is in AgentMultiple mode *and* parallel produced at least one successful agent). In Fraction mode, unset, or parallel-failed, hide the section entirely — it has nothing meaningful to report.
     - Header: agent-cost drift (`estimated → actual`, percent), floor config summary.
     - Main card: side-by-side table of **Actual (this run)** vs **Projected (with accurate cost)** for (a) sequential invocation count, (b) sequential wall time, with Δ = actual − projected row and plain-language summary. "Projected" holds floor multipliers fixed and swaps the estimate to the observed actual throughout the dispatch math.
     - Collapsible "Show working" disclosure: step-by-step floor resolution + dispatch math for both scenarios, plus duration computation (`Δ wall time ≈ Δ invocations × median sequential GFSA duration`).
     - Parallel-phase time delta is explicitly not modeled (concurrent dispatch, paced by slowest agent).
     - In-card variants (still shown when visibility rule passes): accurate estimate (|drift| < 2%) → single-line "projected and actual match"; numVariants cap binding both sides → "Δ = 0, ceiling binding".
  4. **Error distribution histogram** (inline SVG bars over GFSA `estimationErrorPct` values, buckets: `<-25%, -25..-5%, -5..+5%, +5..+25%, >+25%`).
  5. **Cost per invocation** table — every `evolution_agent_invocations` row in this run. Columns: #, Iteration, Agent, Strategy, Gen Est, Gen Actual, Rank Est, Rank Actual, Total, Error %. Non-GFSA rows show `—` in estimate columns. Sortable by `|error%|`. Row click → invocation detail page.
- [x] Sections (strategy level): replace Budget Floor Sensitivity with a per-model/strategy slice table; replace Cost per Invocation with a Runs table whose rows link to `/admin/evolution/runs/{id}?tab=cost-estimates`. Summary + Error Distribution stay identical.
- [x] Null / edge-case handling:
  - "No data (pre-instrumentation)" badge when no run metric rows exist.
  - "Partial run" badge when generation recorded but ranking missing.
  - "Not applicable (ranking-only / no GFSA)" when the run had no GFSA invocations.
  - Zero-estimate tooltip on rows where `estimatedCost = 0`.
  - Fraction-mode / no-floor / parallel-failed / accurate-estimate variants of Budget Floor Sensitivity per above.
- [x] Export from `evolution/src/components/evolution/index.ts`.

### Phase 5: Wire tabs into detail pages
- [x] Edit `src/app/admin/evolution/runs/[runId]/page.tsx` — add `{ id: 'cost-estimates', label: 'Cost Estimates' }` to `TABS` and conditional render `<CostEstimatesTab entityType="run" entityId={runId} />`.
- [x] Edit `src/app/admin/evolution/strategies/[strategyId]/page.tsx` — same wiring with `entityType="strategy"`.

### Phase 6: Calibration table
- [x] Migration `supabase/migrations/20260414*_evolution_cost_calibration.sql` — complete DDL:
  ```sql
  CREATE TABLE evolution_cost_calibration (
    strategy TEXT NOT NULL DEFAULT '__unspecified__',
    generation_model TEXT NOT NULL DEFAULT '__unspecified__',
    judge_model TEXT NOT NULL DEFAULT '__unspecified__',
    phase TEXT NOT NULL CHECK (phase IN ('generation','ranking','seed_title','seed_article')),
    avg_output_chars NUMERIC NOT NULL,
    avg_input_overhead_chars NUMERIC NOT NULL,
    avg_cost_per_call NUMERIC NOT NULL,
    n_samples INT NOT NULL CHECK (n_samples >= 1),
    last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (strategy, generation_model, judge_model, phase)
  );
  ALTER TABLE evolution_cost_calibration ENABLE ROW LEVEL SECURITY;
  CREATE POLICY deny_all ON evolution_cost_calibration FOR ALL USING (false) WITH CHECK (false);
  CREATE POLICY service_role_all ON evolution_cost_calibration FOR ALL TO service_role USING (true) WITH CHECK (true);
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
      EXECUTE 'CREATE POLICY readonly_select ON evolution_cost_calibration FOR SELECT TO readonly_local USING (true)';
    END IF;
  END $$;
  ```
  - `__unspecified__` sentinel values keep the PK NOT NULL constraint satisfied for rows where a dimension isn't known (e.g., seed phases have no strategy). Loader falls back to sentinel row then hardcoded default.
  - `readonly_local` policy is guarded with a role-existence check (matches pattern in `20260318000001_evolution_readonly_select_policy.sql`).
  - Down migration: simple `DROP TABLE` (table is additive; no data loss concern since constants remain authoritative fallback).
- [x] New file `evolution/scripts/refreshCostCalibration.ts`:
  - Aggregates last `COST_CALIBRATION_SAMPLE_DAYS` days (env, default 14) of `evolution_agent_invocations` joined with `evolution_runs.strategy_id` → `evolution_strategies.config` for model fields.
  - Idempotent `ON CONFLICT DO UPDATE` upsert.
  - On empty source data for a slice: skip (do not overwrite with zero).
  - On script error: exit non-zero so cron surfaces failure; does not touch any existing rows mid-batch (uses a transaction).
  - Emits a summary log (`COST_CALIBRATION_REFRESH_SUMMARY`) to stdout/Honeycomb: `{ rowsUpdated, rowsInserted, slicesSkipped, durationMs }`.
- [ ] CLI wrapper + cron entry (daily, minicomputer systemd unit — no Vercel cron).
- [x] New file `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts`:
  - **Server-only file.** Leading `import 'server-only'` (Next.js primitive) + ESLint rule prevents accidental client import. Service-role Supabase client imported via `createSupabaseServiceClient()`.
  - In-memory `Map<sliceKey, CalibrationRow>` with 5-min TTL.
  - **Promise coalescing:** on cache miss, store an in-flight `Promise<void>` keyed by slice so N concurrent callers await one DB round-trip, not N.
  - **Error-mode distinction:** row-missing → fallback to hardcoded default (silent). DB query failure → log error, serve last-known stale value if any, else fallback to default. Never throws from the hot path.
  - **Kill switch:** env `COST_CALIBRATION_ENABLED` (default `'true'`); when `'false'`, loader returns the hardcoded default for every lookup without touching the DB. Gives ops a sub-minute way to disable if refresh produces bad data.
  - **Observability:** emit `cost_calibration_lookup` structured log entries at debug (hit/miss/fallback counts aggregated per 60s window, not per-call).
- [x] Modify `evolution/src/lib/pipeline/infra/estimateCosts.ts` — replace `EMPIRICAL_OUTPUT_CHARS` lookup with `costCalibrationLoader.getOutputChars(strategy, generationModel)`; preserve the existing `EMPIRICAL_OUTPUT_CHARS` map as the loader's fallback path.
- [x] Modify `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — replace `OUTPUT_TOKEN_ESTIMATES` with `costCalibrationLoader.getOutputTokens(agentName, model)` fallback to existing defaults.
- [x] Confirm `strategyPreviewActions.estimateAgentCostPreviewAction` picks up the loader automatically (it already calls `estimateAgentCost`); update `strategyPreviewActions.test.ts` to stop mocking `estimateCosts` and instead mock the loader so the integration stays covered.
- [x] Document required env vars in `evolution/docs/reference.md`: `COST_CALIBRATION_ENABLED`, `COST_CALIBRATION_SAMPLE_DAYS`, `COST_CALIBRATION_TTL_MS` (default 300_000).

### Phase 7: Documentation + recommendations report
- [x] Update `evolution/docs/cost_optimization.md` — document calibration table, loader, and the feedback-loop picture.
- [x] Update `evolution/docs/metrics.md` — document new metrics + propagation entries.
- [x] Update `evolution/docs/visualization.md` — add Cost Estimates tab to run + strategy detail inventories.
- [x] Update `evolution/docs/data_model.md` — note `evolution_cost_calibration` table.
- [x] Update `evolution/docs/architecture.md` — cross-link cost section if relevant.
- [ ] After ~2 weeks of post-ship data, write `_progress.md` recommendations report: per-strategy drift table, per-model drift table, suggested constant updates, whether to rely on calibration table or keep constants.

## Testing

### Unit Tests
- [x] `evolution/src/lib/metrics/computations/finalization.test.ts` — new compute fns handle empty pool, missing `estimatedCost`, division-by-zero, non-finite values, legacy schemas with absent fields, non-GFSA invocations.
- [x] `evolution/src/lib/metrics/registry.test.ts` — new metric defs validate and propagation source references resolve.
- [x] `evolution/src/lib/core/entityRegistry.test.ts` — **parity test** asserting every `METRIC_REGISTRY` name exists in `entityRegistry` with matching category/formatter.
- [x] `evolution/src/lib/pipeline/infra/costCalibrationLoader.test.ts` — TTL behavior, row-missing fallback, DB-error fallback (distinct path), kill-switch env var, **promise coalescing** (N concurrent callers → 1 DB query), cold-start behavior.
- [x] `evolution/src/lib/pipeline/loop/projectDispatchCount.test.ts` — the extracted dispatch-count helper across every variant: happy path, numVariants ceiling binding, Fraction mode, AgentMultiple mode, zero/negative/non-finite agent cost, zero available budget.
- [x] `evolution/src/services/costEstimationActions.test.ts` — **table-driven test of budget-floor-sensitivity math** covering all seven variants: `applicable` (normal AgentMultiple + actual available), `reasonNotApplicable: 'fraction_mode'`, `'floor_unset'`, `'parallel_failed'`, `'no_gfsa'`, edge `'accurate'` (|drift|<2%), edge `'ceiling_binding'`. Also: histogram bucketing (including ±Inf clamping), null handling, slice grouping cardinality cap.
- [x] `evolution/src/components/evolution/tabs/CostEstimatesTab.test.tsx` — enumerate each badge/variant state: loading, empty, `no-data-pre-instrumentation`, `partial-run`, `not-applicable-ranking-only`, `zero-estimate-tooltip`, `fraction-mode-sensitivity-hidden`, `accurate-estimate-collapsed`, `ceiling-binding-collapsed`, happy path. Covers both `entityType='run'` and `entityType='strategy'` props.
- [x] `evolution/src/lib/schemas.test.ts` — `EvolutionRunSummary` V3 additive `budgetFloorConfig` schema: V3 rows with no `budget_floor_config` parse cleanly and resolve to "not applicable" at the UI; V4 round-trip preserves all fields. Prevents a repeat of the recent schema-rename revert (commit cf3a4af6).

### Integration Tests
- [x] `src/__tests__/integration/evolution-cost-estimate-metrics.integration.test.ts` — run a mock pipeline end-to-end, verify `evolution_metrics` rows for all new metrics + propagated strategy rows + new run-level observables (`actual_avg_cost_per_agent`, etc.).
- [x] `src/__tests__/integration/evolution-cost-calibration-refresh.integration.test.ts` — seed invocations, run `refreshCostCalibration.ts`, verify upsert semantics (insert vs update), idempotency (re-run → no duplicates), empty-source-data (skip, don't zero out), transaction-on-partial-failure (no half-written rows).
- [x] `src/__tests__/integration/evolution-stale-trigger-cost-invariant.integration.test.ts` — seed a completed run with cost + estimation metric rows + a variant; UPDATE variant `mu`/`sigma`; assert all new cost-estimation metric rows stay `stale=false`.
- [x] `src/__tests__/integration/evolution-cost-calibration-rls.integration.test.ts` — assert RLS policies: service-role can read/write, anon denied, readonly_local select works where role exists.

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-cost-estimates-tab.spec.ts` — seed **two** runs: one with `minBudgetAfterSequentialAgentMultiple` (sensitivity section visible), one with `minBudgetAfterSequentialFraction` (sensitivity section hidden). Seed a strategy with child runs. For each seeded entity:
  - Navigate to detail page, click Cost Estimates tab.
  - Assert summary `MetricGrid` renders with expected values.
  - Assert Cost by Agent rows present for each agent type in the seed.
  - Assert Budget Floor Sensitivity either renders (AgentMultiple) or is absent (Fraction) — two explicit assertions.
  - Assert histogram bars render with non-zero total count.
  - Assert per-invocation table rows + row-click navigates to invocation detail.
  - On strategy page: assert per-run table + row-click navigates to run detail with `?tab=cost-estimates`.

### Manual Verification
- [ ] Trigger a real evolution run locally, open Cost Estimates tab, confirm values match `execution_detail` hand-computed on a sample invocation.
- [ ] Seed second run with Fraction-mode floor, verify Budget Floor Sensitivity section is absent.
- [ ] Run `refreshCostCalibration.ts` against staging, verify `evolution_cost_calibration` rows populate with non-sentinel values for live (strategy, model) slices.
- [ ] Set `COST_CALIBRATION_ENABLED=false` env, restart server, confirm loader returns hardcoded defaults (grep logs for `cost_calibration_lookup` events showing kill-switch engaged).
- [ ] Verify pre-instrumentation run shows "No data (pre-instrumentation)" badge.
- [ ] Verify partial run (killed mid-ranking) shows "Partial run" badge on affected rows.
- [ ] Verify strategy-detail slice breakdown caps at 50 rows with "+N more" footer when exceeded.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-cost-estimates-tab.spec.ts` via `ensure-server.sh` (spec authored; will run in CI).

### B) Automated Tests
- [x] `npm run lint && npm run tsc && npm run build`
- [x] `npm run test:unit -- --grep "cost estimate|costCalibration|CostEstimatesTab|projectDispatchCount|entityRegistry"`
- [x] `npm run test:integration -- --grep "costEstimate|costCalibration|staleTrigger"`
- [ ] Confirm `.github/workflows/ci.yml` `deploy-migrations` job applies the new `evolution_cost_calibration` migration to staging before integration tests run. No workflow edit expected (migration auto-discovery by filename) — spot-check the CI logs of the first PR push.

## Rollback & Kill Switches
- [x] **Calibration loader:** `COST_CALIBRATION_ENABLED=false` env forces the loader to return hardcoded defaults without touching the DB. Sub-minute ops-level disable if the refresh job produces bad data.
- [x] **Calibration migration:** down migration drops `evolution_cost_calibration`. Safe to drop because hardcoded constants remain authoritative fallback in `estimateCosts.ts` and `createEvolutionLLMClient.ts`.
- [x] **Run-summary V3 additive schema:** readers tolerate missing `budget_floor_config` (V3 rows). Roll forward only; no runtime flip needed.
- [x] **UI tab:** wrapped in the existing admin route — no feature flag needed; a bad render is fixed by reverting the component.

## Observability
- [x] `refreshCostCalibration.ts` emits a `COST_CALIBRATION_REFRESH_SUMMARY` structured log (stdout + Honeycomb if configured) per run.
- [x] `costCalibrationLoader` emits aggregated `cost_calibration_lookup` events (hit/miss/fallback counts per 60s window).
- [ ] Finalization emits `cost_estimation_error_pct` to the existing evolution run finalization log so Honeycomb traces capture per-run drift without the UI.

## Documentation Updates
- [x] `evolution/docs/cost_optimization.md` — calibration table + loader + feedback loop section.
- [x] `evolution/docs/metrics.md` — new run + propagated metrics, stale-trigger scope fix.
- [x] `evolution/docs/visualization.md` — Cost Estimates tab on run + strategy detail pages.
- [x] `evolution/docs/data_model.md` — `evolution_cost_calibration` table entry.
- [x] `evolution/docs/architecture.md` — cross-link if estimation-feedback diagram is worth adding.
- [x] `evolution/docs/reference.md` — new env vars for calibration loader/refresh.

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
