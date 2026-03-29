# Metrics Integrity Fixes Evolution Plan

## Background
Research identified 12 issues in the evolution metrics system. The core problems are: stale metrics never recomputed (missing RPC), cost metrics don't survive sudden failures, run elo metrics lack confidence intervals, several UI pages don't display or fetch metrics correctly, and E2E tests only check element existence — not metric values or CI display. The system is architecturally sound — the fix is filling implementation gaps, not redesigning.

## Requirements (from GH Issue #865)
- Prior gaps identified
- Metrics are calculated for all entities
    - Confirm for each of 7 entities separately
- Metrics are updated for runs marked as failed by system somehow
- Metrics are updated for runs that fail suddenly
- Metrics are displayed for each list and detail page in the UI
    - Verify this using codebase
    - Verify this using Playwright to look at each section
- Stale metrics get updated correctly
- Make sure we have unit/integration/e2e tests to verify all of the individual points above

## Problem
The evolution metrics system has 12 gaps that prevent correct end-to-end operation. The most critical is a missing `lock_stale_metrics` RPC that blocks all stale metric recomputation. Cost metrics don't survive sudden run failures because they're only written at iteration boundaries, not on each LLM call. Run-level elo metrics (winner_elo, median_elo, etc.) don't include confidence intervals — the DB schema, write path, and UI all support CIs but the compute functions return bare numbers without extracting sigma from variant ratings. This breaks CI propagation to strategy/experiment metrics. List views serve stale data, invocation elo metrics are never invalidated, and several UI pages have display gaps.

## Findings Summary

| # | Finding | Severity | Phase |
|---|---------|----------|-------|
| 1 | Missing `lock_stale_metrics` RPC — stale recomputation completely broken | BLOCKER | 1 |
| 2 | `getBatchMetricsAction` skips stale check — list views serve stale values | HIGH | 2 |
| 3 | Invocation metrics not marked stale by trigger, no recompute handler | MEDIUM | 2 |
| 4 | Cost metric not written on LLM call — lost on sudden failure | MEDIUM | 1 |
| 5 | Strategy list page doesn't fetch metrics | LOW | 3 |
| 6 | RelatedRunsTab hardcodes cost to 0 | LOW | 3 |
| 7 | Dead code `Entity.propagateMetricsToParents()` with type bug | INFO | 3 |
| 8 | Non-atomic finalization metrics writes | INFO | — |
| 9 | Finalization race condition — completed run with no variants | LOW | — |
| 10 | Run elo metrics lack confidence intervals (sigma not extracted from variant ratings) | MEDIUM | 1 |
| 11 | Strategy/experiment propagation never runs — agent-contributed metric `format_rejection_rate` fails `writeMetrics` validation (static `METRIC_REGISTRY` doesn't include runtime-merged agent metrics), throwing an error that aborts the entire finalization try-catch block including propagation. Verified on staging: run `77bc82f0` has all 10 metrics but parent strategy `305d6b89` and experiment `801c98bb` have zero. Root cause: `writeMetrics.ts:43` validates against `METRIC_REGISTRY` not `getEntity().metrics`. | HIGH | 1 |
| 12 | E2E tests check element existence only — no metric value or CI assertions | MEDIUM | 4 |

Findings 8 and 9 are architectural observations (low probability, would require transactional redesign).

## Phased Execution Plan

### Phase 1: Critical Fixes (Findings 1, 4, 10, 11)

- [x] **Create `lock_stale_metrics` RPC migration** — `supabase/migrations/20260328000001_create_lock_stale_metrics.sql`
  - **Approach**: Atomic claim-and-clear pattern using the `stale` flag itself as the lock mechanism. No advisory locks or `SELECT FOR UPDATE` needed.
  - **Why not advisory locks**: Both `pg_try_advisory_xact_lock` (transaction-scoped) and `SELECT FOR UPDATE SKIP LOCKED` release when the Supabase RPC transaction ends. Since recomputation happens in separate TypeScript DB calls AFTER the RPC returns, these locks provide no protection. Session-scoped `pg_try_advisory_lock` would work but requires explicit `pg_advisory_unlock` and Supabase connection pooling may assign different sessions.
  - **Pattern**: The RPC atomically UPDATEs `stale = false` for matching rows and RETURNs the rows that were updated. If another request already cleared `stale`, the UPDATE matches zero rows and returns empty — caller skips recomputation. This is a compare-and-swap on the `stale` flag.
  ```sql
  CREATE FUNCTION lock_stale_metrics(p_entity_type TEXT, p_entity_id UUID, p_metric_names TEXT[])
  RETURNS TABLE (id UUID, metric_name TEXT) AS $$
    UPDATE evolution_metrics
    SET stale = false, updated_at = now()
    WHERE entity_type = p_entity_type
      AND entity_id = p_entity_id
      AND metric_name = ANY(p_metric_names)
      AND stale = true
    RETURNING id, metric_name;
  $$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
  ```
  - **Caller change** in `recomputeMetrics.ts`: if RPC returns rows, proceed with recomputation. If returns empty, another request already claimed — skip. On recomputation failure, re-mark stale (`SET stale = true`) in the catch block so the next reader retries.
  - **Thundering herd protection**: The atomic `UPDATE ... AND stale = true` ensures only one concurrent reader "wins" the claim. Other readers see `stale = false` (already claimed) and return the current (possibly stale) values. The next read after recomputation completes will see fresh values.
  - **Error recovery change**: Update `recomputeMetrics.ts` finally block — on success, stale is already cleared (by the RPC). On error, re-mark stale so the next reader retries:
  ```typescript
  try {
    // recompute...
  } catch (err) {
    // Re-mark stale so next reader retries
    await db.from('evolution_metrics').update({ stale: true })
      .eq('entity_type', entityType).eq('entity_id', entityId)
      .in('metric_name', staleNames);
    throw err;
  }
  // No finally block needed — stale already cleared by RPC on success
  ```
  - `SECURITY DEFINER`, `SET search_path = public`, granted to `service_role` only
- [x] **Write cost metrics on every LLM call** — `evolution/src/lib/pipeline/infra/createLLMClient.ts`
  - **Approach**: Write in the LLM client wrapper (not a callback on cost tracker). Cost tracker stays pure (sync math, no I/O). The LLM client is already the integration boundary between LLM calls and cost tracking.
  - **Concurrency note**: `createV2LLMClient.complete()` is called sequentially per LLM call within an agent (generation runs strategies in parallel via `Promise.all` but each strategy makes one LLM call). Multiple concurrent calls could produce interleaved upserts, but since each writes `costTracker.getTotalSpent()` (cumulative), the last writer wins with the correct total. No race condition because cost tracker `reserve()` and `recordSpend()` are synchronous under Node's single-threaded event loop.
  - **Current flow**: `createV2LLMClient.complete()` → `costTracker.reserve()` → LLM call → `costTracker.recordSpend()` → return. Cost only in memory.
  - **New flow**: After `costTracker.recordSpend()` (line 75), add fire-and-forget DB writes:
    - `writeMetric(db, 'run', runId, 'cost', costTracker.getTotalSpent(), 'during_execution').catch(logger.warn)` — cumulative total
    - `writeMetric(db, 'run', runId, 'agentCost:${agentName}', phaseCosts[agentName], 'during_execution').catch(logger.warn)` — per-phase
  - **Error suppression**: Use `.catch(logger.warn)` to prevent unhandled promise rejections from fire-and-forget writes
  - **DB destination**: `evolution_metrics` table, upsert on `(entity_type='run', entity_id=runId, metric_name)`. Each call overwrites the previous value with the latest cumulative total.
  - **Params**: Add `db: SupabaseClient` and `runId: string` to `createV2LLMClient()` signature
  - Update `claimAndExecuteRun.ts` to pass `db` and `runId` to `createV2LLMClient()`
  - **Deployment**: Ship atomically with iteration-end cost write removal (next item) to avoid a window with no cost writes
- [x] **Remove redundant iteration-end cost write** — `evolution/src/lib/pipeline/loop/runIterationLoop.ts:208-229`
  - Remove the `duringExecution` metrics write block (now handled per-LLM-call)
  - Keep finalization safety net at `persistRunResults.ts:222-224` as final reconciliation (this path does NOT go through `validateTiming` for agent metrics — it writes `'cost'` which is in the static registry)
- [x] **Add sigma and CI to ALL run-level elo metrics** — `evolution/src/lib/metrics/computations/finalization.ts`
  - Change all 4 elo compute functions to return `MetricValue` (with sigma and CI) instead of `number`
  - `computeWinnerElo`: extract winner variant's sigma, convert to Elo scale (`eloSigma = sigma * ELO_SIGMA_SCALE`), return `{ value: elo, sigma: eloSigma, ci: [elo - 1.96*eloSigma, elo + 1.96*eloSigma], n: 1 }`
  - `computeMaxElo`: same as winner (highest elo variant's sigma)
  - `computeMedianElo`: extract sigma from the median variant (the variant at the 50th percentile position), convert to Elo scale
  - `computeP90Elo`: extract sigma from the P90 variant (the variant at the 90th percentile position), convert to Elo scale
  - **Type change strategy**: Add `isMetricValue(v): v is MetricValue` type guard to `types.ts`. Update `FinalizationMetricDef.compute` return type to `MetricValue | number | null`. Non-elo compute functions (cost, total_matches, decisive_rate, variant_count) continue returning `number | null` — no changes needed.
  - **Write loop change** in `persistRunResults.ts:227-232`:
    ```typescript
    const result = def.compute(finCtx);
    if (result == null) continue;
    if (isMetricValue(result)) {
      await writeMetric(db, 'run', runId, def.name, result.value, 'at_finalization', {
        sigma: result.sigma ?? undefined,
        ci_lower: result.ci?.[0],
        ci_upper: result.ci?.[1],
        n: result.n,
      });
    } else {
      await writeMetric(db, 'run', runId, def.name, result, 'at_finalization');
    }
    ```
  - **Existing test migration**: Update `finalization.test.ts` to assert on `.value` property for elo functions (e.g., `expect(computeWinnerElo(ctx).value).toBe(toEloScale(30))`)
  - **Update `recomputeMetrics.ts:75-80`**: The `recomputeRunEloMetrics` function also calls `def.compute(ctx)` and passes the result to `writeMetric`. Must add the same `isMetricValue()` type guard here to extract sigma/CI when recomputing stale elo metrics
- [x] **Add sigma and CI to ALL propagated elo metrics** — `evolution/src/lib/metrics/computations/propagation.ts`
  - `aggregateBootstrapMean` already produces CI from bootstrap resampling. Once run-level elo metrics carry sigma, `bootstrapMeanCI` will draw from `Normal(value, sigma)` per source row, producing uncertainty-aware CIs. Affected: `avg_final_elo`, `avg_median_elo`, `avg_p90_elo`, `avg_decisive_rate`
  - `aggregateMax` (`best_final_elo`, `best_max_elo`): change to track which row produced the max and propagate its sigma. Return `{ value: max, sigma: maxRow.sigma, ci: maxRow.sigma ? [max - 1.96*sigma, max + 1.96*sigma] : null, n }`
  - `aggregateMin` (`worst_final_elo`): same pattern — propagate sigma from the min source row
  - `aggregateAvg` (`avg_matches_per_run`, `avg_cost_per_run`, `avg_variant_count`): add CI via standard error (`se = stddev / sqrt(n)`, `ci = [mean - 1.96*se, mean + 1.96*se]`). Keep deterministic (no bootstrap) — these are non-elo metrics where exact mean is appropriate. **Do NOT change to aggregateBootstrapMean** to avoid breaking existing deterministic test assertions.
  - **Existing test migration**: Update `propagation.test.ts` — existing `aggregateAvg` test asserts `toBe(20)` on `.value`; add new assertions for `.ci` and `.n` fields
- [x] **Fix `writeMetrics` validation to include agent-contributed metrics** — `evolution/src/lib/metrics/writeMetrics.ts`
  - **Use Option B**: Add `format_rejection_rate` and `total_comparisons` directly to `METRIC_REGISTRY.invocation.atFinalization` in `registry.ts`
  - Reason: Option A (use `getEntity()` in `validateTiming()`) introduces runtime dependency on entity registry singleton, risking import cycle: `writeMetrics → entityRegistry → Entity → writeMetrics`. Option B keeps `writeMetrics.ts` import-free of entity registry, avoids lazy-init side effects in test environments, and is a 2-line addition to the static registry.
  - **Import source**: Import compute functions from standalone module (e.g., `computations/finalizationInvocation.ts` or a new `computations/agentMetrics.ts`), NOT from `GenerationAgent`/`RankingAgent` classes — importing Agent classes into `registry.ts` would create a new import cycle: `registry.ts → GenerationAgent → Agent → ... → registry.ts`
  - Extract `computeFormatRejectionRate` and `computeTotalComparisons` from their agent classes into a shared compute module if not already standalone
  - This is the **direct cause** of zero strategy/experiment metrics on staging
- [x] **Backfill propagated metrics for existing entities** — `evolution/scripts/backfill-propagated-metrics.ts`
  - Standalone script (NOT a migration — migrations run at deploy time and could timeout)
  - Query all strategies/experiments with completed runs but zero metrics rows in `evolution_metrics`
  - For each, call `propagateMetrics()` (the same function used by finalization)
  - Add dry-run mode (`--dry-run` flag) that lists entities to backfill without writing
  - Add idempotency: `propagateMetrics` uses upsert, so re-running is safe
  - Test: integration test verifying backfill script produces correct metrics for a strategy with known runs
  - Sequencing: must deploy Finding 11 fix first, then run backfill
- [x] Run lint, tsc, build
- [x] Run existing unit tests for affected files

### Phase 2: Stale Recomputation Fixes (Findings 2, 3)

- [x] **Add stale detection to `getBatchMetricsAction`** — `evolution/src/services/metricsActions.ts`
  - After fetching metrics, check for stale rows per entity
  - For each entity with stale rows, call `recomputeStaleMetrics()`
  - Re-read and return fresh metrics
- [x] **Expand stale trigger to include invocation metrics** — new migration
  - Add `best_variant_elo`, `avg_variant_elo` to the invocation-level stale marking in `mark_elo_metrics_stale()`
  - Query `evolution_agent_invocations` for the variant's `run_id` to find affected invocations
- [x] **Add invocation handler to `recomputeStaleMetrics()`** — `evolution/src/lib/metrics/recomputeMetrics.ts`
  - Add `entityType === 'invocation'` branch
  - Fetch invocation's `execution_detail` from DB
  - Reconstruct `FinalizationContext` with `invocationDetails` map
  - Recompute `best_variant_elo` and `avg_variant_elo` using current variant ratings
- [x] Run lint, tsc, build
- [x] Run existing unit tests for affected files

### Phase 3: UI Display Fixes (Findings 5, 6, 7)

- [x] **Fix strategy list metrics fetch** — `src/app/admin/evolution/strategies/page.tsx`
  - Add `getBatchMetricsAction('strategy', strategyIds, metricNames)` call (follow runs page pattern at lines 76-80)
  - Merge metrics into strategy items before rendering
- [x] **Fix RelatedRunsTab cost display** — `evolution/src/components/evolution/tabs/RelatedRunsTab.tsx`
  - Replace hardcoded `cost: 0` with actual cost from `getBatchMetricsAction` or `evolution_run_costs` view
- [x] **Delete dead code** — `evolution/src/lib/core/Entity.ts:178-229`
  - Remove `propagateMetricsToParents()` method (never called, has type bug)
- [x] Run lint, tsc, build
- [x] Run existing unit tests for affected files

### Phase 4: CI & Test Coverage (Finding 12, CI gap)

- [x] **Enable evolution E2E tests on PRs to `main`** — `.github/workflows/ci.yml`
  - Current: `e2e-evolution` job has `github.base_ref == 'production'` (line 395) — only runs on production PRs
  - All evolution PRs target `main`, so these tests never run during development
  - The last main→production PR (#841) had no CI checks at all (only Vercel deploy) — so even the production gate didn't catch it
  - Existing E2E tests (`strategy metrics were propagated`, `experiment auto-completed and metrics propagated`) DO assert `run_count`, `total_cost`, `avg_final_elo` exist — they would have caught Finding 11
  - Fix: Change condition to `github.base_ref == 'production' || github.base_ref == 'main'` (with evolution path detection still applied)
  - **Cost/staging impact**: Evolution E2E uses `gpt-4.1-nano` with `budget_cap_usd: 0.02` — cost per run ~$0.02. With evolution path detection, only PRs touching evolution code trigger these tests. `environment: staging` approval gate may apply — verify staging environment is configured for auto-approval on PRs to main.
  - Also apply same fix to `integration-evolution` job (line 266) which has the same `production`-only gate
  - Do NOT change `e2e-non-evolution` and `integration-non-evolution` — these run critical tests on all PRs already
- [x] **Strengthen E2E metric value assertions** — existing E2E specs currently only check element existence (`data-testid`), not actual values or CI display
  - `admin-evolution-run-pipeline.spec.ts`: After clicking metrics tab, assert metric values are numeric (not "—" or "No metrics"), verify CI range displayed for elo metrics
  - `admin-evolution-strategy-detail.spec.ts`: Assert strategy metrics tab shows propagated values with CI ranges (e.g., `avg_final_elo` has `±` or range display)
  - `admin-evolution-invocation-detail.spec.ts`: Assert invocation metrics tab shows `best_variant_elo`, `avg_variant_elo`, `variant_count` with actual values
- [x] **Add experiment detail metrics E2E test** — no existing test covers experiment metrics tab
  - New test in `admin-evolution-run-pipeline.spec.ts` or dedicated spec: navigate to experiment detail → click metrics tab → verify propagated metrics visible with values
- [x] **Add CI display E2E assertions** — verify confidence intervals render on detail pages
  - Run detail: verify elo metrics show CI range (e.g., `1200 ± 45` or `1155–1245`)
  - Strategy detail: verify bootstrap mean metrics show CI range
  - Arena leaderboard already has CI test — extend pattern to detail pages

## Rollback Plan

- **Phase 1 migration** (`lock_stale_metrics` RPC): Drop function in rollback migration. `recomputeMetrics.ts` already handles the case where the RPC returns no result (returns early).
- **Phase 1 code changes**: Revert commit. Cost tracker and finalization safety net continue working as before.
- **Phase 2 migration** (invocation stale trigger): `CREATE OR REPLACE` — rollback by re-deploying previous trigger function version.
- **Feature flag consideration**: Per-LLM-call cost writes can be gated by a check: `if (db && runId)` in the LLM client — if not passed, falls back to iteration-end writes.

## Testing

### Unit Tests
- [x] `evolution/src/lib/pipeline/infra/createLLMClient.test.ts` — verify cost metric written after each successful LLM call; verify `.catch()` suppresses write errors
- [x] `evolution/src/lib/metrics/recomputeMetrics.test.ts` — add invocation recomputation test; update lock check to use claim-and-clear return value; test error recovery re-marks stale=true on recomputation failure
- [x] `evolution/src/services/metricsActions.test.ts` — add batch stale detection test
- [x] `evolution/src/lib/metrics/writeMetrics.test.ts` — verify `format_rejection_rate` and `total_comparisons` pass validation (regression test for Finding 11); test exercises real `validateTiming` with metrics from `METRIC_REGISTRY` that now includes agent metrics
- [x] `evolution/src/lib/metrics/computations/finalization.test.ts`:
  - [x] `computeWinnerElo` returns `MetricValue` with sigma = variant's sigma * ELO_SIGMA_SCALE and 95% CI
  - [x] `computeMaxElo` returns `MetricValue` with sigma from highest-elo variant
  - [x] `computeMedianElo` returns `MetricValue` with sigma from median variant
  - [x] `computeP90Elo` returns `MetricValue` with sigma from P90 variant
  - [x] All elo functions return `null` for empty pool (existing tests updated to check `.value`)
  - [x] CI bounds are symmetric: `[elo - 1.96*eloSigma, elo + 1.96*eloSigma]`
  - [x] Sigma scales correctly: variant sigma=3.0 → eloSigma = 3.0 * 16 = 48
  - [x] Non-elo functions (cost, total_matches, decisive_rate, variant_count) continue returning `number`
- [x] `evolution/src/lib/metrics/computations/propagation.test.ts`:
  - [x] `aggregateBootstrapMean` produces CI when source rows have sigma (verify non-null ci_lower/ci_upper)
  - [x] `aggregateBootstrapMean` CI width decreases with more observations (n=2 vs n=10)
  - [x] `aggregateMax` propagates sigma from the max source row
  - [x] `aggregateMin` propagates sigma from the min source row
  - [x] `aggregateAvg` produces CI via standard error when n >= 2 (deterministic — exact mean preserved)

### Integration Tests
- [x] `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` — test `lock_stale_metrics` RPC exists and atomic claim-and-clear works (concurrent callers: first claims, second gets empty)
- [x] `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` — test stale trigger cascade: update variant mu/sigma → verify run/strategy/experiment metrics marked stale
- [x] `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` — test end-to-end recompute: write stale metric → detect → lock → recompute → verify fresh values
- [x] `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` — write run elo metric with sigma/CI → verify sigma and ci_lower/ci_upper stored correctly in DB
- [x] `src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts` — write multiple run elo metrics with sigma → propagate to strategy → verify propagated metrics have CI from bootstrap
- [x] `src/__tests__/integration/evolution-metrics-backfill.integration.test.ts` — test backfill script: seed strategy with completed run + metrics, run backfill, verify propagated metrics created; test idempotency (re-run produces same result)
- [x] Integration test exercising real Finding 11 path: call `persistRunResults` finalization metrics loop with real `validateTiming` and `getEntity('invocation')` — verify `format_rejection_rate` writes succeed

### E2E Tests
- [x] `admin-evolution-run-pipeline.spec.ts` — verify run detail metrics tab shows elo values with CI ranges (not bare numbers)
- [x] `admin-evolution-run-pipeline.spec.ts` — verify strategy metrics were propagated with CI: query DB for `avg_final_elo` and assert `ci_lower` and `ci_upper` are non-null
- [x] `admin-evolution-run-pipeline.spec.ts` — verify experiment metrics were propagated with CI: same assertion
- [x] `admin-evolution-run-pipeline.spec.ts` — verify `best_final_elo` has sigma from the best run's winner_elo sigma
- [x] `admin-evolution-strategy-detail.spec.ts` — verify strategy list shows metric values (not "—")
- [x] `admin-evolution-invocation-detail.spec.ts` — verify invocation metrics tab shows best_variant_elo, avg_variant_elo, variant_count values
- [x] Playwright manual verification of all evolution admin pages showing metrics with CI

### Manual Verification
- [x] Verify run detail page shows elo metrics with confidence intervals (e.g., `1402 ± 48` or range `1306–1498`)
- [x] Verify strategy detail metrics tab shows propagated elo metrics with bootstrap CI
- [x] Verify experiment detail metrics tab shows propagated elo metrics with bootstrap CI
- [x] Verify `best_final_elo` and `worst_final_elo` show CI from source run's sigma
- [x] Verify invocation detail metrics tab shows elo and variant count values
- [x] Verify strategy list page displays avg_final_elo, best_final_elo after fix
- [x] Verify experiment detail RelatedRunsTab shows non-zero cost

## Verification

### A) Playwright Verification
- [x] Run Playwright against all evolution admin pages to verify metrics display
- [x] Check run detail metrics tab: elo metrics have CI ranges
- [x] Check strategy list shows metric columns with values
- [x] Check strategy detail metrics tab: propagated metrics with bootstrap CI
- [x] Check experiment detail metrics tab: propagated metrics visible
- [x] Check experiment detail runs tab shows costs
- [x] Check invocation detail metrics tab: elo and count values

### B) Automated Tests
- [x] `npm run test:unit -- --testPathPattern="createLLMClient|recomputeMetrics|metricsActions|finalization|propagation|writeMetrics"`
- [x] `npm run test:integration -- --testPathPattern="evolution-metrics"`
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts`
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-detail.spec.ts`
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-invocation-detail.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/metrics.md` — update: add lock RPC (atomic claim-and-clear), invocation stale handling, per-LLM-call cost persistence, elo CI computation
- [x] `evolution/docs/arena.md` — no changes needed (arena sync flow verified correct)
- [x] `evolution/docs/data_model.md` — add `lock_stale_metrics` RPC to Key RPCs section (atomic claim-and-clear pattern)
- [x] `evolution/docs/architecture.md` — update LLM client section to note cost metric persistence on each call
- [x] `evolution/docs/rating_and_comparison.md` — document elo CI computation (sigma → elo scale → 95% CI)

## Review & Discussion

### Iteration 1 (2026-03-28)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | 3 gaps |
| Architecture & Integration | 3/5 | 2 gaps |
| Testing & CI/CD | 3/5 | 4 gaps |

**Critical gaps addressed:**

1. **Lock RPC transaction scope** (Security): Changed from `SELECT FOR UPDATE SKIP LOCKED` to `pg_try_advisory_xact_lock`. Advisory locks don't release when the RPC transaction ends — they persist for the session, allowing recomputation to happen in subsequent DB calls while the lock is held.

2. **MetricValue type guard** (Security + Architecture): Added explicit `isMetricValue()` type guard function and detailed write loop refactor showing exactly how `MetricValue` vs `number` returns are handled.

3. **Fire-and-forget concurrency** (Security): Documented that LLM calls are sequential per agent, cumulative total means last writer wins correctly, and `.catch(logger.warn)` suppresses unhandled rejections.

4. **Option A vs B for Finding 11** (Architecture): Switched to Option B (add agent metrics to static `METRIC_REGISTRY`). Avoids import cycle risk `writeMetrics → entityRegistry → Entity → writeMetrics` and lazy-init side effects in test environments.

5. **Import cycle risk** (Architecture): Resolved by choosing Option B — `writeMetrics.ts` continues importing only from `registry.ts`, no new dependency on entity registry singleton.

6. **CI gate cost/staging analysis** (Testing): Added cost analysis ($0.02 per run with gpt-4.1-nano), noted `environment: staging` approval gate consideration, scoped change to only `e2e-evolution` and `integration-evolution` jobs.

7. **Finding 11 regression test** (Testing): Added integration test exercising real `validateTiming` with `getEntity('invocation')` and agent-contributed metrics.

8. **Backfill test coverage** (Testing): Added backfill integration test with idempotency check, specified standalone script with `--dry-run` mode.

9. **aggregateAvg determinism** (Testing): Changed plan to keep `aggregateAvg` deterministic (standard error CI) instead of switching to bootstrap. Existing test assertions preserved.

10. **Rollback plan** (Testing): Added rollback section covering migration rollback, code revert, and feature flag for cost writes.

### Iteration 2 (2026-03-28)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 2/5 | 1 gap — advisory lock still transaction-scoped |
| Architecture & Integration | 4/5 | 0 gaps |
| Testing & CI/CD | 4/5 | 0 gaps |

**Critical gaps addressed:**

1. **Advisory lock scope** (all 3 reviewers flagged): Replaced advisory lock approach entirely with atomic claim-and-clear pattern. The `lock_stale_metrics` RPC now atomically UPDATEs `stale = false` and RETURNs claimed rows — this is a compare-and-swap that works within a single transaction. No cross-transaction locking needed. On recomputation failure, catch block re-marks `stale = true` for retry.

**Minor issues addressed:**

2. **Option B import source**: Clarified that compute functions should be imported from standalone modules, not from Agent classes, to avoid import cycles.
3. **recomputeMetrics.ts MetricValue callsite**: Added note that `recomputeRunEloMetrics` also needs the `isMetricValue()` type guard when calling `def.compute()`.
4. **Stale clear on error**: Changed from finally-block clear to catch-block re-mark-stale pattern. Success: stale already cleared by RPC. Error: re-mark stale for next reader to retry.

### Iteration 3 (2026-03-28)
| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 gaps |
| Architecture & Integration | 5/5 | 0 gaps |
| Testing & CI/CD | 5/5 | 0 gaps |

✅ **CONSENSUS REACHED — Plan is ready for execution.**
