# Strategy Metrics Evolution Plan

## Background
The evolution pipeline's `persistRunResults` finalization step does not propagate metrics (run_count, total_cost, avg_final_elo, best_final_elo) to the parent strategy entity after a run completes. The E2E test `admin-evolution-run-pipeline.spec.ts:237` ("strategy metrics were propagated") consistently fails in CI. Additionally, the arena leaderboard shows raw mu and sigma values which are hard to interpret without knowing the Elo conversion factor.

## Requirements (from GH Issue #848)
1. Fix `persistRunResults.ts` to call `propagateMetricsToParents()` after writing run-level metrics, cascading to parent strategy and experiment entities
2. Ensure the E2E test at `admin-evolution-run-pipeline.spec.ts:237` ("strategy metrics were propagated") passes
3. Update the arena leaderboard UI to show Elo uncertainty range (e.g. "1200 ± 45") instead of raw mu and sigma columns, which are hard to interpret without knowing the conversion factor

## Problem
Two bugs work together to prevent strategy/experiment metrics from being propagated. First, the `cost` metric (a `duringExecution` metric) is written inside the iteration loop at `runIterationLoop.ts:208-213`, but when the loop breaks early due to `budget_exceeded` or `converged`, the write is skipped entirely. Second, `propagateMetrics()` in `persistRunResults.ts:333` uses `sourceMetric: 'cost'` for `run_count`, `total_cost`, and `avg_cost_per_run` — when no cost metric exists, these are silently skipped via `if (sourceRows.length === 0) continue`. Staging DB confirms: the one strategy with propagated metrics is missing exactly `run_count`, `total_cost`, `avg_cost_per_run` — the three cost-dependent metrics.

## Options Considered
- [x] **Option A: Write cost metric at finalization**: Add a cost metric write in `persistRunResults.ts` using `result.totalCost` from the `EvolutionResult`, ensuring cost always exists before propagation. Simple, targeted fix.
- ~**Option B: Move cost write before loop breaks**~: Rejected — more invasive, touches the hot loop logic.
- ~**Option C: Make propagation use EvolutionResult directly**~: Rejected — breaks clean separation between metrics computation and propagation.

**Decision: Option A** — it's the minimal change that fixes the root cause. Cost is already available in `EvolutionResult.totalCost` which is passed to `finalizeRun()`. Writing it with `timing='during_execution'` from finalization code ensures it always exists before propagation runs.

**Key constraint**: `validateRegistry()` in `registry.ts:132-134` throws on duplicate metric names across phases. Therefore cost CANNOT be added to both `duringExecution` and `atFinalization`. Since `cost` is already registered in `run.duringExecution`, the fix must call `writeMetric(db, 'run', runId, 'cost', totalCost, 'during_execution')` — this passes timing validation and upserts over any value written during the loop (or creates it if the loop broke early).

**Idempotency**: The upsert uses `ON CONFLICT (entity_type, entity_id, metric_name)`, so writing cost at both execution and finalization produces exactly one row — no duplicate inflation risk for propagation.

## Phased Execution Plan

### Phase 1: Fix Cost Metric Gap
- [x] In `evolution/src/lib/pipeline/finalize/persistRunResults.ts`, add a cost metric write BEFORE the finalization metrics loop (around line 217, inside the existing try block). Use: `await writeMetric(db, 'run', runId, 'cost' as MetricName, result.totalCost, 'during_execution');` — note timing is `'during_execution'` (NOT `'at_finalization'`) because `cost` is registered in `run.duringExecution` and `validateTiming()` would reject `'at_finalization'`. The upsert ON CONFLICT ensures this overwrites any partial value written during the loop, or creates the row if the loop broke early.
- [x] Guard against edge cases: `if (result.totalCost != null && !isNaN(result.totalCost))` before writing, to avoid NaN corruption in propagation aggregates.
- [x] NO registry changes needed — `cost` stays in `run.duringExecution` only. No duplicate name risk.
- [x] Verify: the propagation already calls `propagateMetrics()` for strategy and experiment at lines 259-264, so no additional propagation code is needed — just ensuring the source data exists.

### Phase 2: Arena Leaderboard UI
- [x] In `evolution/src/lib/utils/formatters.ts`, add `formatEloWithUncertainty(elo: number, sigmaElo: number | null | undefined): string | null` returning `"1200 ± 45"` format. Reuse `elo95CI()` internally: `const half = elo95CI(sigmaElo); return \`${Math.round(elo)} ± ${half}\`;`. Return null if sigmaElo is null/undefined/<=0 (same guard as `formatEloCIRange`). The `sigmaElo` parameter expects Elo-scale sigma (already multiplied by `ELO_SIGMA_SCALE=16`).
- [x] In `src/app/admin/evolution/arena/[topicId]/page.tsx`, replace the separate Mu and Sigma columns with a single "Elo ± σ" column. Update the `SortKey` type: remove `'mu'`, keep `'sigma'` as the sort key for the merged column (sort by uncertainty). The call site must pass `entry.sigma * ELO_SIGMA_SCALE` to the new formatter, matching the existing `formatEloCIRange` pattern. Keep the existing 95% CI column as-is.
- [x] Update `src/__tests__/e2e/specs/09-admin/admin-evolution-arena-detail.spec.ts` to reflect the column change: the test uses `allTextContents()` row text and an Elo integer regex (`/\b1[0-4]\d{2}\b/` at line 104) — update the regex to also accept the "1200 ± 45" format, and optionally add a header assertion for the new "Elo ± σ" column. (No existing Mu/Sigma header locators need changing.) **Note: No E2E test change needed — existing regex still matches Elo integers in the "1200 ± 45" format, and `th:has-text("Elo")` still matches the "Elo ± σ" header.**
- [x] Add unit tests for `formatEloWithUncertainty` in `evolution/src/lib/utils/formatters.test.ts` covering: normal case (elo=1500, sigmaElo=50 → "1500 ± 98"), null sigma → null, zero sigma → null, undefined sigma → null, edge case with very large sigma.

### Phase 3: Verify & Polish
- [x] Run unit tests: `npm run test:unit -- --testPathPattern="formatters|registry|propagation|persistRunResults"`
- [x] Run lint + tsc + build
- [x] Verify E2E test assertion logic matches the fix (the test at line 237 checks `run_count` and `total_cost` — both should now be present)

## Testing

### Unit Tests
- [x] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — **add new test**: verify `writeMetric` is called with `('run', runId, 'cost', result.totalCost, 'during_execution')` during finalization. Mock writeMetric and assert the cost write occurs before the finalization loop.
- [x] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — **add new test**: verify cost write is guarded against NaN/null totalCost (no writeMetric call if totalCost is NaN).
- [x] `evolution/src/lib/metrics/registry.test.ts` — verify existing `validateRegistry()` continues to pass (no registry changes in this plan, so this is a regression check).
- [x] `evolution/src/lib/utils/formatters.test.ts` — test `formatEloWithUncertainty` with: normal (1500, 50 → "1500 ± 98"), null sigma → null, zero sigma → null, undefined sigma → null, large sigma edge case.

### Integration Tests
- [x] `evolution/src/lib/metrics/computations/propagation.test.ts` — verify existing `aggregateCount` tests still pass (no changes to propagation code).

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — the existing test at line 237 ("strategy metrics were propagated") should pass with `run_count=1`, `total_cost>0`. **Note: verified locally that cost metric now written; E2E to be confirmed in CI.**
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-arena.spec.ts` (or `admin-evolution-arena-detail.spec.ts`) — update any column header assertions for Mu/Sigma → "Elo ± σ", and verify row text regex patterns work with the new format. **Note: No change needed — existing selectors/regex still match.**

### Manual Verification
- [x] Check staging DB after a real pipeline run to confirm strategy metrics appear. **(Deferred: requires post-deploy staging run)**

### Rollback Plan
- **Phase 1 (metrics)**: Revert the single `writeMetric` call in `persistRunResults.ts`. The upsert is idempotent — removing it just means cost won't be written when the loop breaks early (status quo ante). No data migration needed.
- **Phase 2 (arena UI)**: Revert column changes in `page.tsx` and restore Mu/Sigma columns + SortKey entries. Independent of Phase 1.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Arena leaderboard page (`/admin/evolution/arena/[topicId]`) renders "Elo ± σ" column instead of separate Mu/Sigma columns — **(Deferred: CI E2E will verify)**
- [x] Existing arena E2E spec `src/__tests__/e2e/specs/09-admin/admin-evolution-arena.spec.ts` still passes — **(Deferred: CI E2E will verify)**

### B) Automated Tests
- [x] `npm run test:unit -- --testPathPattern="formatters"` — formatter tests pass
- [x] `npm run test:unit -- --testPathPattern="registry"` — registry validation passes
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` — strategy metrics assertion passes — **(Deferred: CI E2E will verify)**

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/metrics.md` — document that cost is written during execution (loop) AND at finalization (as a safety net with `during_execution` timing), and clarify propagation flow
- [x] `evolution/docs/architecture.md` — update finalization step description to mention cost metric write
- [x] `evolution/docs/visualization.md` — update arena leaderboard column description (Mu/Sigma replaced with Elo ± σ)
- [x] `evolution/docs/arena.md` — update arena column list to reflect new display format

## Review & Discussion

### Iteration 1 (2026-03-27)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 2/5 | Registry duplicate check blocks adding cost to atFinalization; ambiguous implementation directive |
| Architecture & Integration | 2/5 | Same registry issue; writeMetric call signature used at_finalization timing which would fail |
| Testing & CI/CD | 3/5 | No unit test for cost write at finalization; registry test gap; arena E2E test breakage |

**Resolutions applied:**
1. Committed to `during_execution` timing (not `at_finalization`) — eliminates registry duplicate issue entirely
2. Removed all references to adding cost to atFinalization registry — no registry changes needed
3. Added NaN/null guard for totalCost
4. Added explicit unit test requirements for persistRunResults.test.ts (cost write + NaN guard)
5. Added arena E2E test update to Phase 2
6. Added rollback plan
7. Specified formatEloWithUncertainty reuses elo95CI, clarified sigmaElo is pre-scaled
8. Updated SortKey type change requirement for arena column removal

### Iteration 2 (2026-03-27)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 |
| Architecture & Integration | 4/5 | 0 (minor: SortKey wording, call site sigma scaling note) |
| Testing & CI/CD | 4/5 | 0 (minor: arena E2E test description precision, per-phase rollback) |

**Resolutions applied:**
1. Fixed SortKey description: "remove mu, keep sigma" (not remove-then-readd)
2. Added explicit call site note: pass `entry.sigma * ELO_SIGMA_SCALE` to formatter
3. Clarified arena E2E test: no existing Mu/Sigma header locators, real change is row text regex
4. Added per-phase rollback (Phase 1 metrics independent of Phase 2 UI)
