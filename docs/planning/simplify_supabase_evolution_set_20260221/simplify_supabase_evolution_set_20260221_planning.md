# Simplify Supabase Evolution Set Plan

## Background
The evolution pipeline's Supabase schema has grown bloated with redundancies. Agent information is duplicated across `evolution_checkpoints` and `evolution_agent_invocations` tables. This project will audit the full evolution database schema, identify redundancies and duplication, and simplify/deduplicate where possible to reduce storage overhead and maintenance burden.

## Requirements (from GH Issue #504)
- Investigate duplication between `evolution_checkpoints` and `evolution_agent_invocations` tables
- Audit the full evolution schema for other redundancies (e.g., data stored in both JSONB blobs and normalized columns)
- Propose and implement simplifications that reduce schema bloat without breaking pipeline functionality
- Ensure checkpoint/resume, visualization, and admin UI features continue working after deduplication

## Problem

The evolution schema has 8 tables + 4 JSONB columns with significant data duplication:

1. **Checkpoint storage bloat** — ~305 MB per run (~195 checkpoint rows), no cleanup mechanism, growing unboundedly. At 100 runs this is ~30 GB. Only the latest checkpoint is needed for resume.
2. **Dead and redundant columns** on `content_evolution_runs` — `runner_agents_completed` is never read, `total_variants` ≡ `variants_generated`.

## Scope

This project addresses priorities 1-3 only (dead columns, redundant columns, checkpoint pruning). The `evolution_run_agent_metrics` table, run-level cached columns, and variants table are left as-is.

---

## Priority 1: Drop Dead Column `runner_agents_completed`

**Impact:** LOW storage, HIGH code cleanliness
**Risk:** MINIMAL — column is never read by any application code
**Blast radius:** 1 RPC (`checkpoint_and_continue`), 2 write paths (`persistCheckpoint` in persistence.ts + `persistCheckpointWithSupervisor` in pipeline.ts)

| What | Detail |
|------|--------|
| Problem | Written after every checkpoint but has zero read consumers. Name is misleading (stores pool size, not agent count). |
| Action | Migration to drop column. Update `checkpoint_and_continue` RPC to remove the parameter. Remove writes in BOTH `persistCheckpoint()` (persistence.ts:47) AND `persistCheckpointWithSupervisor()` (pipeline.ts:650). |
| Data loss | None — column was never consumed. |
| Files changed | `persistence.ts`, `pipeline.ts` (persistCheckpointWithSupervisor), `checkpoint_and_continue` RPC migration |

### Deployment Order (Priority 1)

1. **Migration first:** Replace `checkpoint_and_continue` RPC — make `p_pool_length` a no-op (accept but ignore) or give it `DEFAULT 0`. Drop `runner_agents_completed` column in same migration.
2. **Code deploy second:** Remove `runner_agents_completed` writes from `persistCheckpoint()` and `persistCheckpointWithSupervisor()`. Stop passing `p_pool_length` to RPC.
3. **Safe because:** The RPC already has `p_pool_length INT DEFAULT 0`, so old code sending the parameter won't break. The column drop happens atomically with the RPC replacement.

### Rollback (Priority 1)

```sql
-- Rollback: re-add runner_agents_completed column
ALTER TABLE content_evolution_runs ADD COLUMN runner_agents_completed INT DEFAULT 0;
-- Rollback: restore checkpoint_and_continue with p_pool_length write
-- (full RPC body from migration 20260220000001)
```

## Priority 2: Merge `variants_generated` into `total_variants`

**Impact:** LOW storage, MEDIUM code cleanliness
**Risk:** MINIMAL — both columns always hold identical values
**Blast radius:** 6+ consumers read `variants_generated` across server actions, UI components, and tests

| What | Detail |
|------|--------|
| Problem | Both set to `ctx.state.getPoolSize()` at finalization. Backfill migration confirms they're always equal. |
| Action | Pick `total_variants` as the survivor (more descriptive). Migration to drop `variants_generated`. Update ALL code reading `variants_generated` to read `total_variants`. |
| Data loss | None — values are always identical. |
| Files changed | See exhaustive consumer list below. |

### Exhaustive `variants_generated` Consumer List

**TypeScript interface:**
- `evolution/src/services/evolutionActions.ts` — `EvolutionRun` interface: remove `variants_generated` field

**Server actions (READ via SELECT *):**
- `evolution/src/services/evolutionActions.ts` — `getEvolutionRunsAction` (uses `select('*')`)

**Pipeline WRITE paths (finalization):**
- `evolution/src/lib/core/pipeline.ts` — `executeMinimalPipeline()` finalization (~line 245): writes `variants_generated: ctx.state.getPoolSize()`
- `evolution/src/lib/core/pipeline.ts` — `executeFullPipeline()` finalization (~line 497): writes `variants_generated: ctx.state.getPoolSize()`
- These MUST be removed or the column drop migration will cause runtime errors when the pipeline finalizes.

**UI components:**
- `src/app/admin/quality/evolution/page.tsx` — lines ~467, ~605 referencing `run.variants_generated`
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — line ~64 referencing `selectedRun.variants_generated`
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` — lines ~391, ~491

**Tests:**
- `runTriggerContract.test.ts` — line ~83

**OUT OF SCOPE (different table `evolution_run_agent_metrics` — do NOT modify):**
- `evolution_run_agent_metrics.variants_generated` — per-agent metric, not per-run
- `evolution/src/services/unifiedExplorerActions.ts` — `AgentMetricRow` interface + task/matrix/trend reads from `evolution_run_agent_metrics`
- `evolution/src/lib/core/metricsWriter.ts` (~line 197) — writes `variants_generated` to `evolution_run_agent_metrics`
- `src/app/admin/quality/evolution/explorer/page.tsx` (~line 1096) — renders from `evolution_run_agent_metrics` via explorer actions
- `evolution/src/lib/core/pipeline.test.ts` (~line 962) — tests agent metrics upsert assertions
- `evolution/src/services/unifiedExplorerActions.test.ts` (~line 177) — fixture data for agent metrics
- `evolution-cost-attribution.integration.test.ts` (~line 193) — agent metrics fixture

### Deployment Order (Priority 2)

1. **Code deploy first:** Update `EvolutionRun` TS interface to remove `variants_generated`, update all UI consumers to use `total_variants`, update test fixtures.
2. **Migration second:** Drop `variants_generated` column from `content_evolution_runs`.
3. **Safe because:** After code deploy, no code reads `variants_generated` anymore. The column just sits unused until the migration drops it.

### Rollback (Priority 2)

```sql
-- Rollback: re-add variants_generated column and backfill from total_variants
ALTER TABLE content_evolution_runs ADD COLUMN variants_generated INT;
UPDATE content_evolution_runs SET variants_generated = total_variants;
```

## Priority 3: Checkpoint Pruning (Extract-Then-Prune)

**Impact:** HIGH — ~13x storage reduction (~305 MB → ~23 MB per run)
**Risk:** MEDIUM — requires careful data extraction before deletion
**Blast radius:** Timeline tab data source changes; all other viz features unaffected

### Strategy

Keep **one checkpoint per iteration** (the `iteration_complete` or last agent checkpoint) for completed runs. Before deleting mid-iteration checkpoints, **extract diff metrics** into `evolution_agent_invocations` so no data is permanently lost.

### What's At Risk Without Extraction

The Timeline tab computes 8 per-agent metrics by diffing sequential checkpoints (`AgentDiffMetrics` in `evolutionVisualizationActions.ts:304-313`):

| Metric | Computed From | In `agent_invocations` Already? |
|--------|--------------|-------------------------------|
| `variantsAdded` | Pool diff between checkpoints | NO |
| `newVariantIds` | Pool diff | NO |
| `matchesPlayed` | matchHistory length diff | NO |
| `eloChanges` | Rating diff per variant | NO |
| `critiquesAdded` | allCritiques length diff | NO |
| `debatesAdded` | debateTranscripts length diff | NO |
| `diversityScoreAfter` | From snapshot directly | NO |
| `metaFeedbackPopulated` | null→non-null transition | NO |

### Preservation Approach

**Step A: Enrich at write time.** After each agent execution, the pipeline already has both the before and after state in memory. Add diff metrics to `execution_detail` JSONB when calling `persistAgentInvocation()`.

**CRITICAL: Truncation safety.** `truncateDetail()` in `pipelineUtilities.ts` has a Phase 2 fallback that strips `execution_detail` to `{ detailType, totalCost, _truncated }` when it exceeds MAX_DETAIL_BYTES (100KB). This would silently DESTROY `_diffMetrics`. Solution: **`_diffMetrics` must be merged AFTER truncation**, not before. The flow is:

```
1. truncatedDetail = truncateDetail(result.executionDetail)  // may strip to base fields
2. finalDetail = { ...truncatedDetail, _diffMetrics: diffMetrics }  // always preserved
```

This ensures `_diffMetrics` (~1-2 KB) survives truncation regardless of how large the agent's own execution detail is. The `_diffMetrics` object is small and fixed-size (no arrays of variant text, just IDs, counts, and numeric deltas).

**Diff computation timing.** The current pipeline execution order per agent is:
```
1. beforeState = snapshot of PipelineState (pool, ratings, matchHistory, etc.)
2. agent.execute(ctx)  → mutates ctx.state in-memory
3. persistAgentInvocation(runId, iteration, agent.name, order, result, logger)
4. persistCheckpoint(ctx)  → writes full state to DB
```

The diff is computed between steps 2 and 3:
```
diffMetrics = computeDiffMetrics(beforeState, ctx.state)
persistAgentInvocation(runId, iteration, agent.name, order, result, logger, diffMetrics)
```

The `beforeState` snapshot must be taken BEFORE `agent.execute()` — capture `pool.length`, `matchHistory.length`, `allCritiques.length`, `ratings` map, etc. as simple scalars/copies. This is cheap (~100 bytes of primitives + a shallow copy of the ratings map).

**Step B: Backfill existing runs.** One-time idempotent script computes diffs from existing checkpoint pairs and writes them into corresponding `agent_invocations` rows.

**Backfill requirements:**
- **Idempotent:** Uses upsert semantics — re-running on already-backfilled rows is a no-op (merges `_diffMetrics` into existing `execution_detail` JSONB via `jsonb_set` or equivalent).
- **Batched:** Processes runs in batches of 10, with progress logging after each batch.
- **Resumable:** Tracks last-processed run_id so it can resume from interruption.
- **Dry-run mode:** `--dry-run` flag computes diffs and logs them without writing to DB.
- **Validation query:** After completion, run `SELECT COUNT(*) FROM evolution_agent_invocations WHERE run_id IN (SELECT id FROM content_evolution_runs WHERE status IN ('completed','failed')) AND execution_detail->>'_diffMetrics' IS NULL` — should return 0.
- **Unit tests:** Test the diff computation function in isolation with known before/after state fixtures. Test idempotency by running backfill twice on same data.

**Step C: Update Timeline reader.** Read diffs from `agent_invocations.execution_detail._diffMetrics` instead of checkpoint diffing. Fallback to checkpoint diff when `_diffMetrics` absent (backward compat for runs not yet backfilled).

**NOTE:** The checkpoint-diff fallback is ONLY valid before Phase 3 pruning. After pruning, mid-iteration checkpoints are gone so the fallback produces incorrect results. The backfill script (Step B) MUST complete for all runs BEFORE pruning (Step D) begins. After Phase 3, the fallback code path should log a warning if triggered (indicates a missed backfill).

**Step D: Prune.** Delete mid-iteration per-agent checkpoints for completed/failed runs. The pruning keeps exactly **one checkpoint per (run_id, iteration)** — the latest by `created_at`, which is typically `iteration_complete`.

**Important:** For completed/failed runs, `continuation_yield` checkpoints are no longer needed for resume (the run is already terminal). The `loadCheckpointForResume()` function only applies to non-terminal runs (`running`, `claimed`, `continuation_pending`), which are explicitly excluded from pruning. So keeping one checkpoint per iteration is safe.

**Pruning only targets completed/failed runs.** Running/claimed/continuation_pending runs are never touched, preserving all their checkpoints including `continuation_yield`.

Precise SQL:
```sql
DELETE FROM evolution_checkpoints
WHERE run_id IN (SELECT id FROM content_evolution_runs WHERE status IN ('completed', 'failed'))
AND id NOT IN (
  SELECT DISTINCT ON (run_id, iteration) id
  FROM evolution_checkpoints
  WHERE run_id IN (SELECT id FROM content_evolution_runs WHERE status IN ('completed', 'failed'))
  ORDER BY run_id, iteration, created_at DESC
);
```

**Step E: Automate.** Add pruning to `finalizePipelineRun()` post-completion, scoped to **only the current run_id** (not all completed runs). This prevents lock contention when multiple runs finalize concurrently. The pruning DELETE must be **non-fatal** — wrap in try/catch with error logging. A pruning failure should never block run finalization.

### Pruning Scope

| Run Status | Behavior |
|------------|---------|
| `completed` / `failed` | Keep one checkpoint per iteration (latest). Delete all others. |
| `running` / `claimed` / `continuation_pending` | No pruning — needed for mid-iteration resume. |
| `pending` / `paused` | No pruning. |

### What Survives Pruning

| Feature | Works? | Notes |
|---------|--------|-------|
| Pipeline resume | YES | Only needs latest checkpoint |
| Timeline tab (per-agent) | YES | Reads `_diffMetrics` from invocations |
| Elo history chart | YES | Queries latest checkpoint per iteration |
| Lineage DAG | YES | Uses latest checkpoint only |
| Comparison view | YES | Uses latest checkpoint only |
| Step scores | YES | Per-iteration checkpoint retained |
| Tree search viz | YES | Uses latest checkpoint only |
| Budget burn chart | YES | Uses `agent_invocations` for cost |

### Storage Impact

| Metric | Before | After |
|--------|--------|-------|
| Checkpoints per run | ~195 | ~15 |
| Storage per run | ~305 MB | ~23 MB |
| 100 runs | ~30 GB | ~2.3 GB |
| `agent_invocations` growth | — | ~1-2 KB per row (small JSONB addition) |

---

## Phased Execution Plan

### Phase 1: Safe Cleanup (Priority 1 + 2)
**Estimated effort:** Small — 2 migrations, 5-6 file changes
**Can be done independently, no ordering dependency between Priority 1 and 2**

**Priority 1 — Drop `runner_agents_completed`:**
1. Write migration: replace `checkpoint_and_continue` RPC (make `p_pool_length` a no-op/remove `runner_agents_completed` write) AND drop column — single atomic migration
2. Remove `runner_agents_completed` writes from `persistCheckpoint()` (persistence.ts:47)
3. Remove `runner_agents_completed` writes from `persistCheckpointWithSupervisor()` (pipeline.ts:650)
4. Stop passing `p_pool_length` to `checkpoint_and_continue` RPC call

**Priority 2 — Drop `variants_generated`:** (code-first deploy)
5. Remove `variants_generated` WRITES from `pipeline.ts` finalization: `executeMinimalPipeline()` (~line 245) and `executeFullPipeline()` (~line 497)
6. Update `EvolutionRun` TS interface in `evolutionActions.ts` to remove `variants_generated`
7. Update all 6+ UI consumers to use `total_variants` (see exhaustive list above)
8. Update `runTriggerContract.test.ts` fixture
9. Write migration dropping `variants_generated` column from `content_evolution_runs`
10. Run lint/tsc/build, unit tests, integration tests

**Pre-deploy check:** Verify no `evolution-batch.yml` batch is running before deploying Phase 1 migrations.

### Phase 2: Checkpoint Enrichment (Priority 3, Steps A-C)
**Estimated effort:** Medium — new write logic, reader update, backfill script
**Must complete before Phase 3**

1. Add `DiffMetrics` type to `types.ts` — reconcile with existing `AgentDiffMetrics` in `evolutionVisualizationActions.ts:304-313`. Export a single canonical type that both the writer (pipelineUtilities.ts) and reader (evolutionVisualizationActions.ts) share. **Important:** The `eloChanges` field must use Elo-scale numbers (via `ordinalToEloScale(getOrdinal(...))`), not raw mu/sigma values. The backfill script must use `buildEloLookup()` from the viz actions to handle both legacy (`eloRatings`) and new (`ratings` with mu/sigma) checkpoint formats.
2. Add `computeDiffMetrics(beforeState, afterState)` utility function — captures before-state snapshot before `agent.execute()`, computes diff after. Uses `ordinalToEloScale()` for rating conversion.
3. Update `persistAgentInvocation()` in `pipelineUtilities.ts` to accept optional `diffMetrics` param — merge AFTER `truncateDetail()` to survive truncation
4. Update BOTH pipeline execution loops: `executeMinimalPipeline()` (~line 211) AND `runAgent()` in `executeFullPipeline()` (~line 563). Both need: capture before-state → `agent.execute()` → compute diff → `persistAgentInvocation(..., diffMetrics)` → `persistCheckpoint()`
5. Update Timeline builder in `evolutionVisualizationActions.ts` to read from `_diffMetrics` with checkpoint-diff fallback (fallback only valid pre-Phase-3)
6. Write backfill script with: idempotent upserts, batch size 10, resumable, `--dry-run` mode, validation query
7. Unit test `computeDiffMetrics()` with known before/after state fixtures
8. Unit test that `_diffMetrics` survives `truncateDetail()` Phase 2 fallback
9. Run backfill on staging, verify Timeline tab renders identically
10. Run lint/tsc/build, unit tests, integration tests

### Phase 3: Checkpoint Pruning (Priority 3, Steps D-E)
**Estimated effort:** Small — DELETE query + finalization hook
**Depends on Phase 2 completion AND successful backfill of all existing runs**

**Pre-requisite gate:** Run validation query confirming 0 unbackfilled agent invocations (see Step B validation query). DO NOT proceed with pruning until this passes.

1. Write pruning function using `DISTINCT ON (run_id, iteration)` window query (see Step D SQL above). Keeps one checkpoint per (run_id, iteration) for completed/failed runs only.
2. Unit test: pruning SQL with fixture containing multiple checkpoint types per iteration — verify exactly one survives per (run_id, iteration) and all running/continuation_pending run checkpoints are untouched
3. Run pruning on staging, verify all viz tabs still work
4. Add pruning step to `finalizePipelineRun()` post-completion — wrap in try/catch, non-fatal on failure
5. Integration test: verify running/continuation_pending run checkpoints are completely untouched by pruning
6. Run lint/tsc/build, unit tests, integration tests

### Rollback (Phase 3)

Checkpoint deletion is **irreversible** — pruned data cannot be recovered. However, because Phase 2 backfilled `_diffMetrics` into `agent_invocations`, the Timeline tab still works without the pruned checkpoints. If pruning causes unexpected issues, the automated pruning in `finalizePipelineRun()` can be disabled by removing/commenting the call while preserving all other finalization steps.

---

## Testing

### Phase 1 Tests
- **Unit:** `persistCheckpoint()` no longer writes `runner_agents_completed`
- **Unit:** `persistCheckpointWithSupervisor()` no longer writes `runner_agents_completed`
- **Unit:** `checkpoint_and_continue` RPC works without pool_length parameter
- **Unit:** All code reading variant counts uses `total_variants` (no references to `variants_generated` on `content_evolution_runs`)
- **Unit:** `EvolutionRun` TS interface no longer has `variants_generated` field
- **Unit:** Pipeline finalization no longer writes `variants_generated` (`executeMinimalPipeline` and `executeFullPipeline`)
- **Grep check:** `grep -r 'variants_generated' evolution/src/ src/app/` returns only `evolution_run_agent_metrics` references (metricsWriter.ts, unifiedExplorerActions.ts/test, pipeline.test.ts, explorer page, cost-attribution test — all different table, out of scope). Zero references to `content_evolution_runs.variants_generated` should remain.
- **Integration:** Full pipeline run completes without errors
- **Integration:** Dashboard and explorer display correct variant counts

### Phase 2 Tests
- **Unit:** `computeDiffMetrics()` with known before/after state fixtures produces correct diffs
- **Unit:** `persistAgentInvocation()` includes `_diffMetrics` when provided
- **Unit:** `_diffMetrics` survives `truncateDetail()` Phase 2 fallback (detail > 100KB → `_diffMetrics` still present)
- **Unit:** Timeline builder reads from `_diffMetrics` on invocations
- **Unit:** Timeline builder falls back to checkpoint diffing when `_diffMetrics` absent
- **Unit:** Backfill script diff computation matches known checkpoint pair → expected diff metrics
- **Unit:** Backfill script is idempotent (running twice produces same result)
- **Integration:** Full pipeline run → verify `_diffMetrics` populated on all invocation rows
- **Integration:** Timeline tab renders identically to pre-change behavior

### Phase 3 Tests
- **Unit:** Pruning SQL with fixture: multiple checkpoint types per iteration → exactly one survives per (run_id, iteration)
- **Unit:** Pruning SQL does NOT touch running/claimed/continuation_pending run checkpoints
- **Integration:** Prune mid-iteration checkpoints for completed runs → verify Timeline, Elo history, Lineage, Comparison views all render
- **Integration:** Running/continuation_pending run checkpoints are completely untouched after pruning (all checkpoints including `continuation_yield` survive)
- **Integration:** Pruning failure in `finalizePipelineRun()` is non-fatal (mock DB error → finalization still completes)
- **Manual (staging):** Run a full evolution → check all viz tabs → prune → re-check all tabs

### Regression Tests (All Phases)
- Budget tab cumulative burn chart unaffected
- Hall of Fame linking still works
- Cost analytics actions still read correctly
- `apply_evolution_winner` RPC unaffected

---

## RPC Updates Required

| RPC | Phase | Change |
|-----|-------|--------|
| `checkpoint_and_continue` | Phase 1 | Remove `p_pool_length` parameter (or stop passing `runner_agents_completed`) |
| `apply_evolution_winner` | None | No changes needed |
| `claim_evolution_run` | None | No changes needed |
| `update_strategy_aggregates` | None | No changes needed |

---

## Summary

| Change | Phase | Storage Savings | Columns Removed | Consumer Rewrites |
|--------|-------|----------------|----------------|-------------------|
| Drop `runner_agents_completed` | 1 | Negligible | 1 column | 0 readers, 3 writers (persistence.ts, pipeline.ts, RPC) |
| Merge `variants_generated` | 1 | Negligible | 1 column | 6+ readers + 2 writers (TS type, 3 page files, 1 action, 1 test, 2 pipeline finalization writes) |
| Checkpoint pruning | 2-3 | **~27.7 GB per 100 runs** | ~180 rows/run deleted | 1 reader (Timeline) |
| **Total** | 1-3 | **~27.7 GB per 100 runs** | 2 columns, ~180 rows/run | ~3 consumer updates |

## Documentation Updates
The following docs need updates after implementation:
- `evolution/docs/evolution/data_model.md` — checkpoint storage model changes
- `evolution/docs/evolution/architecture.md` — data flow diagram (pruning step added to finalization)
- `evolution/docs/evolution/visualization.md` — Timeline data source changes (invocations instead of checkpoint diffs)
- `evolution/docs/evolution/reference.md` — column removal
