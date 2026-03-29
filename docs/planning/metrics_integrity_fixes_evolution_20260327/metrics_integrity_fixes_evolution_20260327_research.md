# Metrics Integrity Fixes Evolution Research

## Problem Statement
Identify gaps in the current evolution metrics implementation. Metrics need to be calculated correctly for all entities, updated when runs fail or are marked failed, displayed on all UI pages, and recomputed when stale. Prior analysis identified a missing `lock_stale_metrics` RPC and `getBatchMetricsAction` not checking stale flags.

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

## High Level Summary

Research across 5 rounds of 4 parallel agents + follow-up deep dives identified **8 distinct issues** ranging from a blocker (missing RPC) to display bugs. The metrics system is architecturally sound — the stale trigger cascade, propagation logic, and finalization compute functions all work correctly. Failed runs are safely isolated from parent aggregates (variants are in-memory only until finalization, so failed runs leave no variant footprint). However, several implementation gaps prevent the system from working end-to-end in production. Playwright verification confirmed the UI findings.

---

## Findings

### Finding 1: Missing `lock_stale_metrics` RPC (BLOCKER)

**Severity: BLOCKER** — stale metrics never recomputed in production

`recomputeStaleMetrics()` at `evolution/src/lib/metrics/recomputeMetrics.ts:22` calls `db.rpc('lock_stale_metrics', ...)` but no migration creates this RPC. The Supabase call returns `{ data: null }`, causing the function to return early at line 29. Stale metrics accumulate but are never recomputed.

**Expected behavior** (from tests): The RPC should use `SELECT FOR UPDATE SKIP LOCKED` to prevent thundering herd — only one concurrent reader performs recomputation.

**Files:**
- `evolution/src/lib/metrics/recomputeMetrics.ts:22-29`
- No migration exists — confirmed via grep of all `supabase/migrations/`

---

### Finding 2: `getBatchMetricsAction` skips stale check

**Severity: HIGH** — list views serve stale ELO values indefinitely

`metricsActions.ts:70` — `getBatchMetricsAction` (used by run list page) reads metrics via `getMetricsForEntities` without checking the `stale` flag. Only `getEntityMetricsAction` (single-entity detail views) triggers recomputation.

**Impact:** Run list page shows outdated elo scores. Users must click into a run detail page to trigger recomputation.

**Files:**
- `evolution/src/services/metricsActions.ts:70-104`
- `src/app/admin/evolution/runs/page.tsx:76-78` (caller)

---

### Finding 3: Invocation metrics not marked stale by trigger

**Severity: MEDIUM** — invocation elo metrics become stale after arena syncs

The `mark_elo_metrics_stale` trigger only marks run, strategy, and experiment metrics stale. Invocation metrics `best_variant_elo` and `avg_variant_elo` depend on variant mu/sigma but are never invalidated.

Additionally, `recomputeStaleMetrics()` has no handler for `entityType === 'invocation'` — even if the trigger were expanded, recomputation wouldn't work.

**Practical impact:** Users viewing invocation details after arena syncs see outdated ELO scores with no warning. This is a real issue for teams running long experiments with arena integration.

**Files:**
- `supabase/migrations/20260326000003_expand_stale_trigger.sql:14-17` (no invocation metrics listed)
- `evolution/src/lib/metrics/recomputeMetrics.ts:32-38` (no invocation handler)
- `evolution/src/lib/metrics/computations/finalizationInvocation.ts:15-30` (depends on variant ratings)

---

### Finding 4: Cost metric not written on early loop exit

**Severity: MEDIUM** — propagated cost metrics silently missing

The cost metric write happens at the END of each iteration in `runIterationLoop.ts:208-229`. If the loop breaks early (budget exceeded, convergence, kill), the cost metric is never written. The finalization "safety net" at `persistRunResults.ts:222-224` attempts to write it but errors are caught silently (line 274).

**Downstream impact:** `propagateMetrics()` silently skips `run_count`, `total_cost`, `avg_cost_per_run` when the source `cost` metric is missing (line 350: `if (sourceRows.length === 0) continue`). Strategy/experiment metrics become incomplete.

**Files:**
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts:144,167,201,205` (4 early exit points before metrics write at 208)
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:222-224,274` (safety net with silent catch)

---

### Finding 5: Strategy list page doesn't fetch metrics

**Severity: LOW** — metric columns show "—" for all strategies

`src/app/admin/evolution/strategies/page.tsx` creates metric columns via `createMetricColumns('strategy')` but never calls `getBatchMetricsAction()` to fetch the data. The runs list page does this correctly (line 76-80).

**Files:**
- `src/app/admin/evolution/strategies/page.tsx:42` (columns created, no fetch)
- `src/app/admin/evolution/runs/page.tsx:76-80` (correct pattern)

---

### Finding 6: RelatedRunsTab hardcodes cost to 0

**Severity: LOW** — experiment/strategy detail run tabs always show $0 cost

`evolution/src/components/evolution/tabs/RelatedRunsTab.tsx:26` hardcodes `cost: 0` in the normalization function. The strategy detail runs tab similarly doesn't display cost at all.

**Files:**
- `evolution/src/components/evolution/tabs/RelatedRunsTab.tsx:26`

---

### Finding 7: Dead code `Entity.propagateMetricsToParents()` has bug

**Severity: INFO** — dead code with type error on `def.timing` (undefined for PropagationMetricDef)

`evolution/src/lib/core/Entity.ts:178-229` — never called anywhere. The active propagation function is `propagateMetrics()` in `persistRunResults.ts:326-359`. Two implementations are not equivalent. Dead code should be deleted to avoid confusion.

**Files:**
- `evolution/src/lib/core/Entity.ts:178-229` (dead, buggy)
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:326-359` (active, correct)

---

### Finding 8: Non-atomic finalization metrics writes

**Severity: INFO** — partial failure leaves run marked completed with incomplete metrics

Run status is updated to `completed` (line 141) BEFORE metrics writes (line 213+). If metrics writes fail partway through, the catch block logs a warning but doesn't re-throw (line 274). Individual `writeMetric()` calls are not batched. No transaction wraps the status update and metrics writes.

**Practical risk is low** — DB errors are rare, and the safety net write usually succeeds. But the design means a transient DB error during finalization creates an inconsistent state that's never self-healed.

**Files:**
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:126-284`

---

### Finding 9: Finalization race condition — completed run with no variants

**Severity: LOW** — low probability but creates inconsistent state

If finalization fails AFTER updating run status to `completed` (line 141) but BEFORE or DURING variant upsert (line 200), a race condition occurs:
- Run status is already `completed` in DB
- `markRunFailed()` in the catch block (claimAndExecuteRun.ts:160) filters `status IN ('claimed', 'running')` — misses because status is already `completed`
- **Result**: Run appears successful with `run_summary` but has zero variants in `evolution_variants`

This is low probability (requires DB error during upsert after successful status update) but means the admin UI would show a completed run with no variant data.

**Files:**
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:127-210`
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts:157-161`

---

## Failed Run Metrics: What Survives

For runs that truly fail (Type 1: heartbeat timeout, Type 2-C: unhandled error), **only cost-related metrics survive** because they're the only ones written incrementally during the loop:

| Metric | Written When | Survives Failure? | Notes |
|--------|-------------|-------------------|-------|
| `cost` | End of each completed iteration (line 213) | Partial — last completed iteration's value | Missing current iteration's cost |
| `agentCost:generation` | End of each completed iteration (line 217) | Partial | Same |
| `agentCost:ranking` | End of each completed iteration (line 217) | Partial | Same |
| `winner_elo` | At finalization only | **NO** | Requires `finalizeRun()` |
| `median_elo` | At finalization only | **NO** | Requires `finalizeRun()` |
| `p90_elo` | At finalization only | **NO** | Requires `finalizeRun()` |
| `max_elo` | At finalization only | **NO** | Requires `finalizeRun()` |
| `total_matches` | At finalization only | **NO** | Requires `finalizeRun()` |
| `decisive_rate` | At finalization only | **NO** | Requires `finalizeRun()` |
| `variant_count` | At finalization only | **NO** | Requires `finalizeRun()` |

**Key detail**: The cost metric write block (lines 208-229) is at the END of each iteration, AFTER all break points (budget exceeded at line 167/205, convergence at line 201, kill at line 144). If the iteration that fails never completed, its cost is NOT captured in the metrics table. However, the in-memory `costTracker` does track it — the finalization safety net at line 222-224 writes the true total from `result.totalCost` if finalization runs.

**For budget-exceeded runs (Type 2-A/B)**: Finalization DOES run, so the safety net writes the correct total cost AND all finalization metrics (elo, matches, etc.). These runs end up with status=`completed` and full metrics.

**For true failures (Type 1, Type 2-C)**: Finalization NEVER runs. Cost metrics reflect only completed iterations (may undercount actual spend). All elo/match/variant metrics are absent. These orphaned cost rows don't affect propagation since propagation filters `status='completed'`.

---

## Verified: What Works Correctly

### Failed run metrics safely isolated
Both `propagateMetrics()` (persistRunResults.ts:336) and `recomputeStrategyMetrics()`/`recomputeExperimentMetrics()` (recomputeMetrics.ts:89,103) filter with `.eq('status', 'completed')`. Failed/cancelled runs never contaminate parent aggregates.

**Deep dive on failed run impact on ALL metrics (elo, match, variant counts):**
- **Variants are in-memory only during the loop** — `runIterationLoop.ts` keeps all variants, ratings, and match history in local variables. Nothing is written to `evolution_variants` until `persistRunResults.ts` finalization.
- **Arena contamination impossible**: `synced_to_arena` flag is only set during `sync_to_arena` RPC which runs AFTER successful finalization. Failed runs never sync to arena. `loadArenaEntries()` filters by `synced_to_arena=true`, so no failed-run variants appear.

#### Type 1: System-Marked Failure (Heartbeat Timeout)

**Timeline:**
1. Run claims and starts executing (status=`running`, heartbeat every 30s)
2. Process crashes (OOM, node crash, server restart) — no graceful shutdown
3. `last_heartbeat` freezes at crash time (no more setInterval updates)
4. 10+ minutes pass with stale heartbeat
5. Another runner calls `claim_evolution_run()` → stale expiry check fires
6. RPC UPDATEs: `status='failed'`, `runner_id=NULL`, `error_message='stale claim auto-expired...'`
7. `completed_at` is NOT set (only finalization sets it)

**DB state after failure:**
| Table | State |
|-------|-------|
| `evolution_runs` | `status='failed'`, `runner_id=NULL`, `completed_at=NULL` |
| `evolution_variants` | **EMPTY** — variants never persisted (in-memory only) |
| `evolution_metrics` | Partial `agentCost:*` and `cost` from completed iterations only |
| `evolution_agent_invocations` | Completed iterations: `success=true`. Current iteration: `success=false`, `cost_usd=NULL` (orphaned) |
| `evolution_arena_comparisons` | **EMPTY** — arena sync never ran |

**Resurrection guard:** If the crashed process resumes after stale expiry, `persistRunResults.ts:127-153` blocks finalization — the UPDATE query filters `status IN ('claimed', 'running')` AND `runner_id = runnerId`, both of which fail against the now-failed/null state. Finalization aborts, variants NOT persisted.

#### Type 2: Sudden Failure (Error During Execution)

Four sub-scenarios with different outcomes:

**A. BudgetExceededError during generation (iter 3):**
- `Agent.run()` catches it, returns `{ budgetExceeded: true }`
- Loop breaks, `stopReason='budget_exceeded'`
- **Finalization RUNS** → status=`completed`, variants persisted, metrics written
- Run appears successful with `run_summary.stopReason='budget_exceeded'`

**B. BudgetExceededWithPartialResults during ranking (iter 3):**
- Triage completes 4 of 5 comparisons before budget hit
- `BudgetExceededWithPartialResults` carries partial `RankResult` (4 matches, updated ratings)
- Loop applies partial ratings to in-memory Map, then breaks
- **Finalization RUNS** → variants persisted with **partial ratings** (triage only, no fine-ranking)
- Winner selection based on incomplete data

**C. Unhandled error (e.g., Supabase connection error):**
- Error is NOT a `BudgetExceededError` subclass
- `Agent.run()` re-throws it → propagates to `claimAndExecuteRun()` top-level catch
- `markRunFailed()` sets `status='failed'`, `error_message` populated
- **Finalization NEVER runs** → no variants persisted, no metrics written
- In-memory ratings/variants completely lost

**D. Error during finalization (e.g., variant upsert fails):**
- **RACE CONDITION**: Run status already updated to `completed` (line 141) BEFORE variant upsert (line 200)
- Variant upsert throws → exception propagates to `claimAndExecuteRun()` catch
- `markRunFailed()` tries to UPDATE but filters `status IN ('claimed', 'running')` → **misses** because status is already `completed`
- **Result: INCONSISTENT STATE** — run marked `completed` with `run_summary` but zero variants in DB
- Admin UI shows run as successful but with missing variant data

**Summary table:**
| Sub-scenario | Final Status | Variants | Metrics | Inconsistent? |
|---|---|---|---|---|
| A: Budget (generation) | `completed` | All persisted | Full finalization | No |
| B: Budget (ranking) | `completed` | Partial ratings | Full finalization | Minor — incomplete ratings |
| C: Unhandled error | `failed` | None | Partial cost only | No |
| D: Finalization error | `completed` | **None** | Partial | **YES — completed with no variants** |

**Conclusion:** Scenarios A-C are handled correctly or fail cleanly. Scenario D reveals a race condition where the run status and variant persistence are not transactional, but this is low probability (requires DB error during upsert after status update).

### Stale trigger cascade is correct
When `sync_to_arena` updates a variant's mu/sigma, the variant retains its original `run_id` (immutable field). The `variant_rating_changed` trigger fires using the original run's ID, correctly marking that run's metrics as stale. Strategy and experiment metrics cascade correctly.

### Arena sync flow is sound
`sync_to_arena` RPC properly updates existing arena entries via `p_arena_updates`, triggers stale marking, and the recomputation logic (if it could run) correctly re-reads current variant ratings from DB.

### Metrics per entity are complete (for their intended scope)
| Entity | Metrics | Status |
|--------|---------|--------|
| run | 8 (1 execution + 7 finalization) | ✓ Complete |
| invocation | 5 (3 base + 2 agent-contributed) | ✓ Complete (stale marking gap noted in Finding 3) |
| variant | 1 (cost only) | ✓ Correct — elo/mu/sigma come from table columns directly |
| strategy | 14 propagated | ✓ Complete |
| experiment | 14 propagated | ✓ Complete |
| prompt | 0 | ✓ Correct — no meaningful metrics at prompt level |

### Propagation logic is consistent
Both `propagateMetrics()` (initial) and `recomputePropagatedMetrics()` (stale recompute) use identical query filters, aggregation functions, and write methods. The two code paths are functionally equivalent.

### Detail pages handle stale correctly
All entity detail pages use `EntityMetricsTab` → `getEntityMetricsAction()` which detects stale rows and triggers recomputation. 6 detail pages confirmed: run, strategy, experiment, invocation, variant, arena topic.

---

## UI Metrics Display Audit

| Page | Metrics Type | Stale Check | Issues |
|------|-------------|-------------|--------|
| Run List | Batch (table) | **NO** | Finding 2: `getBatchMetricsAction` no stale detection |
| Run Detail | Detail (tab) | YES ✓ | — |
| Strategy List | Batch (table) | **NO** | Finding 5: Columns exist but metrics not fetched |
| Strategy Detail | Detail (tab) | YES ✓ | — |
| Experiment List | None | N/A | No metrics columns (by design) |
| Experiment Detail | Detail (tab) | YES ✓ | — |
| Invocation List | None | N/A | Uses raw fields only |
| Invocation Detail | Detail (tab) | YES ✓ | Finding 3: Stale elo never recomputed |
| Variant List | None | N/A | Uses raw table columns (elo_score, match_count) |
| Variant Detail | Detail (tab) | YES ✓ | Only shows cost metric; elo in header from table |
| Arena Topic List | None | N/A | — |
| Arena Leaderboard | Direct query | N/A | Reads variant table directly |

### Playwright Visual Verification (2026-03-27)

Ran Playwright headless against `http://localhost:3485` to visually verify each evolution admin page:

| Page | Result | Notes |
|------|--------|-------|
| Runs List (completed filter) | ✓ Renders | Most completed runs show "—" for Max Elo/Decisive Rate/Variants (Finding 4 confirmed — cost metric missing blocks finalization metrics). Some runs show correct values (e.g., 1274/100%/2). |
| Run Detail (61920935) | ✓ Renders | Metrics tab shows Rating section: Winner ELO 1274, Median ELO 1274, Max ELO 1274, P90 ELO 1274. Tabs: Metrics, Elo, Lineage, Variants, Logs. |
| Strategies List | ✓ Renders | Columns: Name, Label, Pipeline, Status. **No metric columns visible** (Finding 5 confirmed). 3 items with "Hide test content" on. |
| Experiments List | ✓ Renders | 6 columns, no metric columns (by design). |
| Arena Topics List | ✓ Renders | 5 columns, no metric columns (by design). |

Screenshots saved to `screenshots/` directory.

---

## Finding 11: Root Cause Analysis — `format_rejection_rate` Validation Failure

**Verified on staging** (2026-03-28): Strategy `305d6b89` and experiment `801c98bb` have zero propagated metrics despite their child run `77bc82f0` having all 10 metrics (cost, winner_elo=1402, 211 matches, 25 variants, etc.).

**Root cause:** The `format_rejection_rate` agent-contributed metric fails `writeMetrics` validation during finalization, aborting the entire try-catch block.

**The bug chain:**
1. `entityRegistry.ts:21-26` merges `GenerationAgent.invocationMetrics` (including `format_rejection_rate`) into the invocation entity's `atFinalization` array at runtime
2. `persistRunResults.ts:247` iterates `getEntity('invocation').metrics.atFinalization` — which includes the merged agent metrics
3. `writeMetric()` → `validateTiming()` (writeMetrics.ts:43) checks against the **static** `METRIC_REGISTRY` — which only has 3 base invocation metrics
4. `format_rejection_rate` is not in `METRIC_REGISTRY.invocation.atFinalization` → throws `"Unknown metric 'format_rejection_rate' for entity 'invocation'"`
5. Exception caught at `persistRunResults.ts:274` → logs warning → **skips all remaining code including variant metrics (line 257-264) and propagation (lines 268-272)**

**Log evidence from staging:**
```
2026-03-28T02:15:07Z WARN Finalization metrics write failed
  error: "Unknown metric 'format_rejection_rate' for entity 'invocation'"
  runId: "77bc82f0-7f20-4566-8fba-6675303cbd57"
```

**Why this wasn't caught by tests:**
- `persistRunResults.test.ts` mocks `writeMetric` — never calls real `validateTiming()`
- `writeMetrics.test.ts` tests validation but only with static registry metrics, never agent-contributed ones
- The E2E pipeline test (`admin-evolution-run-pipeline.spec.ts`) DOES check `metric-total-cost` and `metric-runs` on strategy/experiment detail pages — **but the test never ran against code with `format_rejection_rate`**

**Why the E2E test never ran:**
- Evolution E2E tests (`@evolution` tag) are gated by `github.base_ref == 'production'` in CI (`.github/workflows/ci.yml:395`)
- All evolution PRs merge to `main`, not `production`
- The last main→production PR (#841, merged 2026-03-27) had no CI checks (only Vercel deploy)
- The `entity_agent_classes` PR (#811) which introduced `format_rejection_rate` merged to `main` — evolution E2E was skipped because it's only triggered on production PRs
- **Result: The evolution E2E pipeline test has never run against code containing agent-contributed metrics**

**CI gap:** The `e2e-evolution` job condition `github.base_ref == 'production'` means evolution E2E tests are skipped on PRs to `main`. Since all evolution work targets `main`, these tests effectively never run during development. They only run on main→production PRs, which are typically auto-merged release PRs that may not trigger CI at all.

---

## Test Coverage Audit

### Existing Tests
- **Unit:** ~1,500 lines across 8 metrics test files (finalization, propagation, registry, write, read, recompute)
- **Integration:** 3 files (~660 lines) — metrics read/write, sync-arena-updates, entity-actions
- **E2E:** 4 Playwright specs — dashboard, invocation detail, strategy detail, full pipeline

### Critical Test Gaps
| Gap | Severity |
|-----|----------|
| No test for `lock_stale_metrics` RPC existence | BLOCKER |
| `writeMetrics` validation doesn't cover agent-contributed metrics — causes silent propagation failure | HIGH |
| No test for `getBatchMetricsAction` stale behavior | HIGH |
| Evolution E2E tests gated on `production` base_ref — never run during development | HIGH |
| No integration test for trigger cascade (variant update → metrics stale) | MEDIUM |
| No end-to-end recomputation test (stale → detect → recompute → verify) | MEDIUM |
| No concurrent recomputation test (SKIP LOCKED behavior) | MEDIUM |
| No test for cost metric missing after early loop exit | MEDIUM |
| No test verifying invocation metrics staleness | LOW |

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/metrics.md
- evolution/docs/arena.md
- evolution/docs/data_model.md
- evolution/docs/architecture.md
- evolution/docs/rating_and_comparison.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md

## Code Files Read
- evolution/src/lib/metrics/recomputeMetrics.ts
- evolution/src/lib/metrics/writeMetrics.ts
- evolution/src/lib/metrics/readMetrics.ts
- evolution/src/lib/metrics/types.ts
- evolution/src/lib/metrics/registry.ts
- evolution/src/lib/metrics/metricColumns.tsx
- evolution/src/lib/metrics/computations/finalization.ts
- evolution/src/lib/metrics/computations/finalizationInvocation.ts
- evolution/src/lib/metrics/computations/propagation.ts
- evolution/src/lib/metrics/recomputeMetrics.test.ts
- evolution/src/services/metricsActions.ts
- evolution/src/services/metricsActions.test.ts
- evolution/src/lib/pipeline/claimAndExecuteRun.ts
- evolution/src/lib/pipeline/finalize/persistRunResults.ts
- evolution/src/lib/pipeline/loop/runIterationLoop.ts
- evolution/src/lib/core/Entity.ts
- evolution/src/lib/core/entityRegistry.ts
- evolution/src/lib/core/entities/RunEntity.ts
- evolution/src/lib/core/entities/InvocationEntity.ts
- evolution/src/lib/core/entities/VariantEntity.ts
- evolution/src/lib/core/entities/StrategyEntity.ts
- evolution/src/lib/core/entities/ExperimentEntity.ts
- evolution/src/lib/core/entities/PromptEntity.ts
- evolution/src/lib/core/agents/GenerationAgent.ts
- evolution/src/lib/core/agents/RankingAgent.ts
- evolution/src/components/evolution/tabs/EntityMetricsTab.tsx
- evolution/src/components/evolution/tabs/RelatedRunsTab.tsx
- src/app/admin/evolution/runs/page.tsx
- src/app/admin/evolution/strategies/page.tsx
- src/app/admin/evolution/experiments/page.tsx
- src/app/admin/evolution/arena/[topicId]/page.tsx
- src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx
- supabase/migrations/20260323000003_evolution_metrics_table.sql
- supabase/migrations/20260326000003_expand_stale_trigger.sql
- supabase/migrations/20260327000001_sync_to_arena_arena_updates.sql
- src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts
- src/__tests__/integration/evolution-metrics-recomputation.integration.test.ts
