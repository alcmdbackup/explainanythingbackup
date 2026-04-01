# Look For Bugs Evolution Plan

## Background
Systematic bug hunt across the evolution pipeline codebase and admin UI. Multi-agent scanning found ~85 raw bugs, deduplicated to ~76 unique. Top 50 verified against source: 42 confirmed, 3 partial, 5 not-a-bug. This plan organizes fixes into phases by severity and dependency.

## Requirements (from GH Issue)
- Scan `evolution/src/` for error handling gaps, race conditions, and logic errors
- Review pipeline finalization for data consistency issues
- Check budget tracking edge cases (reserve-before-spend, partial results)
- Verify arena sync and variant persistence correctness
- Review experiment lifecycle state transitions for race conditions
- Check metric propagation and stale flag cascading for correctness
- Test evolution admin UI pages with Playwright (headless)
- Check experiment wizard, run detail, strategy pages for broken flows
- Look for rendering issues, missing error states, and accessibility problems
- Cross-reference documented behavior (in evolution docs) against actual code

## Problem
The evolution pipeline has 42 confirmed bugs spanning pipeline logic, metrics, race conditions, UI/React, test quality, and documentation drift. Two HIGH severity bugs affect data integrity: incorrect `iterationsRun` on early exit writes bad summaries to DB, and stale metric recomputation overwrites real metrics with zeros. Multiple MEDIUM bugs cause silent data loss (experiment costs dropping winner-less runs), UI confusion (reversed cancel button), and test unreliability (mocks targeting wrong functions). Fixes must be phased to avoid destabilizing the pipeline.

## Options Considered
- [x] **Option A: Phase by severity** — Fix HIGH bugs first, then MEDIUM pipeline/data, then MEDIUM UI, then LOW. Minimizes risk of data corruption while allowing incremental progress.
- [ ] **Option B: Phase by subsystem** — Fix all pipeline bugs, then all UI bugs, then all test bugs. Groups related changes but delays critical fixes in other subsystems.
- [ ] **Option C: Single large PR** — Fix everything at once. Risky, hard to review, and difficult to bisect regressions.

**Selected: Option A** — severity-first phasing ensures data integrity bugs are fixed immediately.

## Phased Execution Plan

### Phase 1: HIGH Severity — Data Integrity Fixes (2 bugs + 1 related partial)
- [x] **C1**: Fix `iterationsRun` in `runIterationLoop.ts:226` — changed guard to only apply when `stopReason === 'iterations_complete'`
- [x] **S7**: Fix stale metric recomputation in `recomputeMetrics.ts` — skip match-dependent metrics (total_matches, decisive_rate), read existing cost from metrics table
- [x] **S8** (partial): Fix stale metric error recovery in `recomputeMetrics.ts` — use `claimedNames` instead of `staleNames` when re-marking on error

### Phase 2: MEDIUM Severity — Pipeline & Data Consistency (8 bugs + 2 related partial)
- [ ] **P18**: DEFERRED — requires DB migration for atomic arena match count RPC
- [x] **C3**: Fix `computeExperimentMetrics` in `manageExperiments.ts` — left join + JS-side winner filtering
- [x] **S4**: Fix experiment name dedup in `manageExperiments.ts` — query-based dedup with `.or()` and regex suffix parsing
- [ ] **S10**: DEFERRED — requires DB migration for cost aggregation RPC
- [x] **C8** (partial): Fix fire-and-forget cost write race in `createLLMClient.ts` — awaited writeMetric calls with try/catch
- [ ] **S11**: DEFERRED — depends on C8, uses metrics table for cost (S10 migration needed)
- [x] **P2**: Fix triage cutoff in `rankVariants.ts` — recompute top-20% inside elimination check each iteration
- [x] **P14** (partial): Fix comparison cache key in `computeRatings.ts` — order-dependent key using `${textA.length}:${textA}|${textB.length}:${textB}`
- [x] **P11**: Fix H1 detection in `enforceVariantFormat.ts` — added `.trimStart()` before H1 regex
- [x] **C11**: Remove deprecated `update_strategy_aggregates` RPC call in `persistRunResults.ts`

### Phase 3: MEDIUM Severity — UI/React Fixes (10 bugs)
- [x] **U1-dup**: Fix reversed cancel button condition in `ExperimentHistory.tsx`
- [x] **U-cancel1/U-cancel2/U-server**: Added `revalidatePath` in server action + `router.refresh()` in client components
- [x] **U-stale**: Fix stale detection to use `updated_at` in `experiments/page.tsx`
- [x] **U-arena**: Show `totalEntries` instead of `entries.length` in arena detail page
- [x] **U-hide**: Investigated — not broken as described (client-side filtering already correct)
- [x] **U-key**: Use stable keys (entity ID) instead of array index in `EntityTable.tsx`
- [x] **U-logs**: Track max iteration across page loads for filter dropdown
- [x] **U-dash**: Add `totalRuns` field to DashboardData, use `runs.length` for accurate count

### Phase 4: MEDIUM Severity — Test Quality Fixes (4 bugs)
- [x] **T1**: Fix `matchCounts` keys in `persistRunResults.test.ts` — computed property names `[BASELINE_ID]`
- [x] **T2**: Fix triage test mock in `rankVariants.test.ts` — mock `complete` instead of `completeStructured`
- [x] **T3**: Add missing assertion for `iterationsRun=0` in `runIterationLoop.test.ts`
- [x] **T4**: Fix shared chain state in `service-test-mocks.ts` — fresh `chainable()` per `from()` call

### Phase 5: LOW Severity — Cleanup & Polish (12 bugs)
- [x] **C9**: Align default rating to `-Infinity` (matches `selectWinner`) in `finalization.ts`
- [x] **C7**: Document match count semantics (per-run, not cumulative) in `persistRunResults.ts`
- [x] **P15**: Rename shadowed `result` to `metricResult` in `persistRunResults.ts`
- [x] **S5**: Clamp pagination bounds in `evolutionActions.ts`
- [x] **S6**: Fix arena pagination — default offset=0 when only limit provided
- [ ] **S13**: SKIPPED — current batch-fetch pattern is standard Supabase (no GROUP BY support)
- [x] **P10**: Improve `parseWinner` disambiguation — check winner phrasing when both TEXT A/B mentioned
- [x] **P12**: Improve sentence counting — negative lookbehind for common abbreviations
- [x] **U-redirect**: Redirect `/admin/evolution` to `/admin/evolution/experiments`
- [x] **U-empty**: Replace raw URL with readable suggestion text
- [x] **U-err**: Use `NotFoundCard` with breadcrumbs for strategy error state
- [x] **U-swallow**: Log error details with `console.error` in `EntityListPage.tsx`

### Phase 6: Documentation Fixes (2 bugs)
- [x] **C5**: Update `architecture.md` — 3-Op → 2-Op loop, remove EVOLVE phase references
- [x] **C12**: Update `architecture.md` — fix stale file paths to match current directory structure

### Phase 7: Accessibility (2 bugs)
- [x] **U-a11y1**: Add keyboard support (tabIndex, role, onKeyDown) to step indicators in `ExperimentForm.tsx`
- [x] **U-a11y2**: Add aria-sort, keyboard support, role to sortable headers in arena detail page

## Testing

### Unit Tests
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — test iterationsRun=0 on abort/kill/deadline breaks (C1)
- [x] `evolution/src/lib/metrics/recomputeMetrics.test.ts` — test recomputation preserves real metric values (S7)
- [x] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — fix existing test keys (T1)
- [x] `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — fix mock target (T2)
- [x] `evolution/src/lib/pipeline/manageExperiments.test.ts` — test cost totals include winner-less runs (C3)
- [ ] `evolution/src/lib/shared/enforceVariantFormat.test.ts` — DEFERRED: abbreviation sentence counting test (P12)
- [ ] `evolution/src/lib/shared/computeRatings.test.ts` — DEFERRED: parseWinner disambiguation test (P10)

### Integration Tests
- [ ] `evolution/src/lib/services/costAnalytics.test.ts` — DEFERRED: requires S10 DB migration
- [ ] `evolution/src/lib/services/arenaActions.test.ts` — DEFERRED: pagination + count tests

### E2E Tests
- [ ] E2E specs not yet created — DEFERRED to future work

### Manual Verification
- [ ] Run full evolution pipeline with early abort and verify `iterationsRun` in DB
- [ ] Trigger stale metric recomputation and verify metrics not zeroed out
- [ ] Run concurrent experiments and verify arena match counts are correct

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] E2E specs for UI changes not yet created — DEFERRED to future work

### B) Automated Tests
- [x] Full test suite: `npm run test:unit` — 4994 passed, 0 failed, 13 skipped

## Documentation Updates
The following docs were identified as relevant and need updates:
- [x] `evolution/docs/architecture.md` — remove EVOLVE phase, fix file paths (C5, C12)
- [ ] `evolution/docs/data_model.md` — DEFERRED: deprecated RPC doc update (C11)
- [ ] `evolution/docs/strategies_and_experiments.md` — no lifecycle behavior changes warranting update
- [ ] `docs/feature_deep_dives/error_handling.md` — no error handling pattern changes warranting update

## DB Migrations Required
Phase 2 requires two Supabase RPC migrations before code changes can be deployed:
1. **P18**: `increment_arena_match_count(p_variant_id UUID, p_delta INT)` — atomic match count increment
2. **S10**: `aggregate_costs(p_filters JSONB)` — server-side cost aggregation
3. **S4**: Partial unique index on experiment name: `CREATE UNIQUE INDEX uq_experiment_name_active ON experiments (name) WHERE deleted_at IS NULL;` — must include a data dedup step first (rename any existing duplicates with sequential suffixes before adding the constraint)
4. **S10 note**: The `aggregate_costs` RPC must use parameterized queries internally (e.g., whitelist allowed filter keys and use `format()` with `%L` placeholders) to prevent SQL injection from the JSONB filter input.

### Migration Deployment Order
Migration files should be created in `supabase/migrations/` and deployed **before** the Phase 2 code changes. Deployment sequence:
1. Deploy migration (additive RPCs + constraint — won't break existing code)
2. Verify migration succeeded in target environment
3. Deploy Phase 2 code changes

In CI/CD, ensure the deploy-migrations job runs and succeeds before the app deployment step.

## Rollback Plan
- **Phase 1 (C1, S7, S8)**: These fix data-writing logic. If a regression is discovered:
  1. Revert the commit on the deployment branch
  2. For C1: check `evolution_runs` for any rows with incorrect `iterations_run` values written during the regression window; correct via SQL update using `evolution_run_logs` timestamps to determine actual iteration count
  3. For S7/S8: check `evolution_metrics` for rows with `total_cost=0` or `winner_elo=0` that were updated during the regression window; re-trigger metric recomputation for affected runs after the revert
- **Phase 2 (P18, S4, S10, C8, S11)**: DB migrations are additive RPCs and constraints. If code regresses, revert the code commit; the RPCs remain harmless. If the unique constraint on experiment names causes issues, drop it with a follow-up migration. For S10 rollback: revert to client-side aggregation; the `aggregate_costs` RPC remains harmless. For C8+S11: if reverting S11 without reverting C8, ensure the metrics UI still reads from `run_summary.totalCost` (the pre-fix source) to avoid a silent data inconsistency window.
- **Phase 3-7 (UI, tests, docs)**: Standard git revert. No data corruption risk.

## Review & Discussion

### Iteration 1 (3 agents)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 2/5 | 5 gaps: C1 fix description wrong, S4 missing retry strategy, S7 missing data source, P18 missing SQL pattern, S10 missing DB-level spec |
| Architecture & Integration | 3/5 | 4 gaps: U-cancel fix in wrong layer, S8/P14/C8 partial bugs missing from plan |
| Testing & CI/CD | 2/5 | 4 gaps: E2E spec paths wrong, no rollback plan, P18 migration not mentioned, verification commands broken |

**Actions taken**: Fixed all 13 critical gaps — corrected C1/S7/P18/S10/S4 technical descriptions, added S8/P14/C8 partial bugs, moved U-cancel fix to server action layer, corrected E2E spec paths, added rollback plan and DB migration section.

### Iteration 2 (3 agents)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 0 critical gaps. Minor: S4 partial index DDL, S10 JSONB injection risk, S7 fallback detail, P18 error behavior |
| Architecture & Integration | 4/5 | 0 critical gaps. Minor: C8→S11 ordering enforcement, P14 implementation ambiguity, S4 migration sequencing |
| Testing & CI/CD | 4/5 | 0 critical gaps. Minor: S10 rollback gap, CI/CD gate enforcement, E2E test section vague |

**Actions taken**: Added S4 partial index DDL, S10 parameterization note, CI/CD deployment sequence, S10 rollback coverage, C8→S11 ordering markers, P14 concrete implementation, S7 fallback specificity, E2E test spec file references.

### Iteration 3 (3 agents)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 critical gaps. 4 minor implementation-detail items (P18 error handling, S4 dedup sequencing, S10 unknown key behavior, C8 rollback granularity) — all resolvable by implementer without plan revision. |
| Architecture & Integration | 5/5 | 0 gaps. All integration boundaries, migration dependencies, ordering conflicts resolved. |
| Testing & CI/CD | 5/5 | 0 gaps. S10 rollback covered, CI/CD gate explicit, E2E spec paths verified. |

**✅ CONSENSUS REACHED — Plan is ready for execution.**
