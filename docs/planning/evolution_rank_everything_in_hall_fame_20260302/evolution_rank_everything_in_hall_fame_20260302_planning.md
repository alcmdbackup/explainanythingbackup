# Unified Arena Rating System — Plan

## Principle

ONE pool. The Arena. Every variant ever created lives in the Arena. Every match is an Arena match. Every rating is an Arena rating. There is no "in-run" rating system. There is no "feed to Arena" step. The pipeline operates directly on the Arena.

## Key Insight

`state.pool` IS a working copy of the Arena for this topic. Load Arena entries at pipeline start. Agents compare all variants naturally. At finalization, persist everything back — all variants, all matches, all updated ratings. One pool, one record.

## Architecture

```
PIPELINE START
══════════════════════════════════════════════════════

  1. Resolve topic for this run
  2. Load ALL Arena entries for this topic into state.pool
     with their existing {mu, sigma}
  3. insertBaselineVariant — baseline is also an Arena entry


PIPELINE EXECUTION
══════════════════════════════════════════════════════

  CalibrationRanker → skips variants with low sigma (already calibrated)
                    → uses them as opponents for uncalibrated variants

  Tournament → Swiss pairing across full pool
             → maxComparisons cap (40) limits total work
             → sigmaWeight scoring deprioritizes stable entries

  All other agents → unchanged


FINALIZATION (syncToArena)
══════════════════════════════════════════════════════

  1. persistVariants() — skip entries loaded from Arena (already in DB)

  2. Write ALL matches from state.matchHistory to
     evolution_arena_comparisons. A match is a match.

  3. Upsert ALL new variants (including baseline) into
     evolution_arena_entries with generation_method='evolution',
     rank=NULL. Every variant joins the Arena.

  4. Upsert elo rows for all new entries with {mu, sigma}
     from state.ratings.

  5. UPDATE existing Arena entries' elo rows with their
     updated {mu, sigma} from participating in matches.
```

## What Changes

### Phase 1: Rename Hall of Fame → Arena

Mechanical find-replace across the codebase. Done first so all subsequent code changes use the new naming.

**DB migration** — rename 4 tables + all constraints + all indexes:
```sql
-- Tables
ALTER TABLE evolution_hall_of_fame_topics RENAME TO evolution_arena_topics;
ALTER TABLE evolution_hall_of_fame_entries RENAME TO evolution_arena_entries;
ALTER TABLE evolution_hall_of_fame_comparisons RENAME TO evolution_arena_comparisons;
ALTER TABLE evolution_hall_of_fame_elo RENAME TO evolution_arena_elo;

-- Indexes (7 live — idx_hall_of_fame_elo_leaderboard was dropped by migration 20260220000002)
ALTER INDEX idx_hall_of_fame_topics_prompt_unique RENAME TO idx_arena_topics_prompt_unique;
ALTER INDEX idx_hall_of_fame_entries_topic RENAME TO idx_arena_entries_topic;
ALTER INDEX idx_hall_of_fame_entries_run_rank RENAME TO idx_arena_entries_run_rank;
ALTER INDEX idx_hall_of_fame_comparisons_topic RENAME TO idx_arena_comparisons_topic;
ALTER INDEX idx_hall_of_fame_elo_topic_ordinal RENAME TO idx_arena_elo_topic_ordinal;
ALTER INDEX idx_hof_elo_topic_anchor_eligible RENAME TO idx_arena_elo_topic_anchor_eligible;
ALTER INDEX idx_hof_entries_topic_rank RENAME TO idx_arena_entries_topic_rank;

-- FK constraints (rename all to arena_* naming)
-- On entries: topic_id, evolution_run_id, evolution_variant_id
-- On comparisons: topic_id, entry_a_id, entry_b_id, winner_id
-- On elo: topic_id, entry_id
-- CHECK constraints: rank_check, generation_method_check

-- No RLS policies exist (admin-only via service client). No triggers.
```

**File renames** (~13 files):
- `hallOfFameActions.ts` → `arenaActions.ts`
- `hallOfFameIntegration.ts` → `arenaIntegration.ts`
- `hallOfFameUtils.ts` → `arenaUtils.ts`
- `add-to-hall-of-fame.ts` → `add-to-arena.ts`
- `run-hall-of-fame-comparison.ts` → `run-arena-comparison.ts`
- `hall-of-fame/` route dir → `arena/`
- All corresponding test files

**Content renames** (~50 files):
- `HallOfFame` → `Arena` (types, components, actions)
- `hallOfFame` → `arena` (functions, variables)
- `hall_of_fame` → `arena` (DB table refs, snake_case)
- `hall-of-fame` → `arena` (URLs, kebab-case)
- `Hall of Fame` → `Arena` (UI labels, comments)
- `HoF` / `hof` → `arena` (abbreviations)
- Test IDs: `add-to-hall-of-fame-btn` → `add-to-arena-btn`, etc.

### Phase 2: Load Arena entries at pipeline start

**File: `evolution/src/lib/core/arenaIntegration.ts`** (renamed from hallOfFameIntegration.ts)

New function `loadArenaEntries(runId, ctx, logger) → Promise<string | null>`:
- Resolve topic (reuse existing topic resolution logic)
- Query `evolution_arena_entries` JOIN `evolution_arena_elo` WHERE topic_id AND deleted_at IS NULL
- For each Arena entry, populate state **directly** (bypass `addToPool()` to avoid polluting `newEntrantsThisIteration`):
  - `state.ratings.set(id, {mu, sigma})` — pre-seed rating
  - `state.matchCounts.set(id, match_count)` — pre-seed match count from `evolution_arena_elo.match_count`
  - `state.pool.push({...entry, fromArena: true})` — add to pool directly
  - `state.poolIds.add(id)` — track in pool ID set
  - Do NOT call `state.addToPool()` — that would push to `newEntrantsThisIteration`, causing CalibrationRanker to iterate all Arena entries as "new entrants" (especially in `executeMinimalPipeline` where `startNewIteration()` is never called)
- After loading all entries, call `state.rebuildIdMap()` — required because direct pool manipulation bypasses `addToPool()` which normally populates `_idToVarMap`. Without this, `getTopByRating()` won't find Arena entries. Also call `state.invalidateCache()` to clear the sorted cache.
- Return topicId → stored on `ctx.arenaTopicId`

**File: `evolution/src/lib/core/pipeline.ts`**

Call `loadArenaEntries()` before `insertBaselineVariant()` in **both** pipeline functions:

In `executeFullPipeline()`:
```ts
if (!options.supervisorResume) {
  ctx.arenaTopicId = await loadArenaEntries(runId, ctx, logger);
}
insertBaselineVariant(ctx.state);
```

In `executeMinimalPipeline()` (no supervisorResume concept — always load):
```ts
ctx.arenaTopicId = await loadArenaEntries(runId, ctx, logger);
insertBaselineVariant(ctx.state);
```

### Phase 3: CalibrationRanker — skip already-calibrated entries

**File: `evolution/src/lib/agents/calibrationRanker.ts`**

Skip variants where `sigma < CALIBRATED_SIGMA_THRESHOLD` (e.g., 5.0) when selecting new entrants to calibrate. This is based on the rating itself, not the variant's origin. Already-calibrated entries still serve as opponents via `getCalibrationOpponents()`.

No `ARENA_ENTRY_STRATEGY` constant needed — the distinction is "needs calibration" (high sigma) vs "already calibrated" (low sigma).

### Phase 4: Simplify finalization — syncToArena

**File: `evolution/src/lib/core/arenaIntegration.ts`**

Refactor `feedHallOfFame()` → `syncToArena()`:

**Wrap steps 1-4 in a single Postgres function** called via `supabase.rpc('sync_to_arena', {...})` to ensure atomicity. A partial failure (e.g., crash after step 2) would leave entries without elo rows, corrupting Arena state. Supabase client doesn't support explicit `BEGIN/COMMIT` — RPC is the only reliable transaction path. Add a migration to create the `sync_to_arena` Postgres function.

1. **Write ALL matches** from `state.matchHistory` to `evolution_arena_comparisons`.
2. **Upsert ALL new variants** (everything not loaded from Arena, INCLUDING baseline) into `evolution_arena_entries` with `generation_method: 'evolution'` and `rank: NULL`.
3. **Upsert elo rows** for all new entries with `{mu, sigma}` from `state.ratings`.
4. **UPDATE existing Arena entries'** elo rows with updated `{mu, sigma}`.
5. **Remove** `upsertEloRatings()` — ratings come from state.ratings directly.
6. **Remove** `triggerAutoReRank()` — matches already happened during the pipeline.

**DB migration** — simplify `rank` and `generation_method` on `evolution_arena_entries`:
- `rank` column: make nullable, remove CHECK constraint. Legacy rows keep their values; new entries get NULL. Rank is a vestige of the curation model (top-N selection) — in the unified Arena, all entries are equal participants. Ordering comes from `evolution_arena_elo` ratings.
- **Drop unique index** `idx_hall_of_fame_entries_run_rank` (renamed to `idx_arena_entries_run_rank` in Phase 1). This index enforced one-entry-per-rank-per-run — incompatible with all-variants model. New entries have `rank: NULL` so the index is meaningless.
- **Drop index** `idx_arena_entries_topic_rank` (renamed from `idx_hof_entries_topic_rank` in Phase 1, originally created by migration `20260302000003`). This composite topic+rank index assumes rank-ordered leaderboards — ordering now comes from `evolution_arena_elo` ratings, not rank.
- `generation_method` CHECK: add `'evolution'` as the new canonical value for pipeline-generated entries. Keep legacy values (`evolution_winner`, `evolution_baseline`, `evolution_top3`, `evolution_ranked`, `oneshot`) for backward compat. New entries use `'evolution'` — no winner/baseline/ranked distinction needed since all variants enter the Arena equally.

**File: `src/lib/schemas/schemas.ts`** — update Zod schemas:
- `hallOfFameGenerationMethodSchema` (renamed to `arenaGenerationMethodSchema` in Phase 1): add `'evolution'` to the enum. Current schema only has `['oneshot', 'evolution_winner', 'evolution_baseline', 'evolution_top3']` — missing both `'evolution_ranked'` (from migration 20260302000001) and `'evolution'` (new canonical value).
- Update corresponding test in `schemas.test.ts`.

**File: `evolution/src/lib/core/pipeline.ts`**

In `finalizePipelineRun()`, replace `autoLinkPrompt + feedHallOfFame` with `syncToArena`.

**File: `evolution/src/lib/core/persistence.ts`**

In `persistVariants()`, filter out entries loaded from Arena (they're already in `evolution_variants`):
```ts
const variantsToSave = ctx.state.pool.filter(v => !v.fromArena);
```

**Also filter Arena entries from these functions** (same `!v.fromArena` pattern):
- `computeAndPersistAttribution()` — Arena entries have no parent attribution in the current execution; including them inflates agent rollups
- `persistAgentMetrics()` (`metricsWriter.ts`) — Arena entries inflate variant counts and skew `avg_elo`/`elo_gain`/`elo_per_dollar`
- `buildRunSummary()` (`pipeline.ts`) — Arena entries distort `strategyEffectiveness` and `topVariants` for the current execution
- `runFlowCritiques()` (`pipeline.ts`) — without filtering, this would attempt LLM critique of ALL Arena entries (potentially hundreds), causing unbounded cost. Filter: `state.pool.filter(v => !v.fromArena && !existingFlowIds.has(v.id))`
- `total_variants` on `evolution_runs` row (`pipeline.ts`) — both `executeFullPipeline` and `executeMinimalPipeline` set `total_variants: ctx.state.getPoolSize()`. After loading Arena entries, this inflates the count. Fix: use `ctx.state.pool.filter(v => !v.fromArena).length`

### Phase 5: Types and config

**`evolution/src/lib/types.ts`**:
- Add `arenaTopicId?: string` to `ExecutionContext`
- Add `fromArena?: boolean` to `TextVariation` interface explicitly (not just an ad-hoc property). This field survives JSON serialization in checkpoint snapshots (`serializeState` serializes `pool` as-is). On resume from checkpoint, `deserializeState` restores pool entries with `fromArena` intact, so the filtering in `persistVariants`/`persistAgentMetrics`/etc. works correctly after resume. Old checkpoints (pre-change) won't have `fromArena` — all entries treated as non-Arena, which is correct.
- No `ARENA_ENTRY_STRATEGY` constant — entries keep their original strategy

### Phase 6: Admin panel — unified Arena framing

**Remove the "Add to Hall of Fame" dialog** (`AddToHallOfFameDialog` in run detail page):
- Every variant automatically enters the Arena at finalization. No manual "add" needed.
- Keep the `addToArenaAction` server action for CLI/manual entry use cases (oneshot generation, etc.), but remove it from the run detail page UI.

**Run detail page** (`src/app/admin/quality/evolution/run/[runId]/page.tsx`):
- Remove `AddToHallOfFameDialog` component and its trigger button
- EloTab label "Rating" is fine — all ratings ARE Arena ratings now, no need to distinguish
- Run detail page shows a historical view of which variants were produced during a pipeline execution and their Arena-scale ratings at time of persistence. This is execution history, not a separate rating system.

**EloTab baseline reference line** (`evolution/src/components/evolution/tabs/EloTab.tsx`):
- Remove the hardcoded `<ReferenceLine y={1200} ... label="Baseline 1200" />` — this was a within-run calibration artifact. With Arena entries loaded (which may have ratings far from 1200), a fixed reference line at 1200 is misleading.
- No replacement needed — the chart shows trajectories relative to each other, which is the meaningful comparison.

**Sparklines and run-level leaderboards** (VariantsTab, EloTab, runs list page):
- These show Arena-scale ratings scoped to a pipeline execution. They are execution analytics ("what happened during this pipeline run"), not a separate rating system.
- No changes needed — the data is correct since all ratings are Arena-scale from the start.

**`is_winner` badge** (VariantsTab, runs list page):
- Keep as execution analytics: "this variant had the highest Arena-scale rating when this pipeline execution completed."
- `is_winner` is set during `persistVariants()` and is a snapshot fact about the execution, not a curation step.
- No changes needed — it does NOT imply a separate "in-run" system.

**Arena topic page** (`src/app/admin/quality/arena/[topicId]/page.tsx`, renamed from hall-of-fame):
- Labels renamed from "Hall of Fame" to "Arena" (covered by Phase 1 rename)
- No structural changes — leaderboard, scatter chart, match history all work as-is
- **`MethodBadge` + `isEvolution` check** — `METHOD_COLORS` only has keys `oneshot`, `evolution_winner`, `evolution_baseline`. New entries with `generation_method: 'evolution'` will fall through to the default grey badge. Fix: add `evolution: 'bg-[var(--status-success)]/20 text-[var(--status-success)]'` to `METHOD_COLORS` in both topic detail and topic list pages. Also update `isEvolution` check (`entry.generation_method.startsWith('evolution_')`) to also match exact `'evolution'`: use `method === 'evolution' || method.startsWith('evolution_')`. Without this, new Arena entries won't show the evolution badge color or the "View Run" link.
- Same `METHOD_COLORS` fix needed in `src/app/admin/quality/arena/page.tsx` (renamed from hall-of-fame list).

**Evolution dashboard stat card** (`evolution/src/services/evolutionVisualizationActions.ts`):
- `hallOfFameSize` property → rename to `arenaSize` (covered by Phase 1 mechanical rename)
- The query counts `evolution_hall_of_fame_entries` → becomes `evolution_arena_entries` (covered by table rename)
- Consumer: `src/app/admin/evolution-dashboard/page.tsx` — rename property reference

**`elo_score` on `evolution_variants`** — keep as-is:
- Snapshot of the Arena-scale rating at time of persistence
- Since all ratings are Arena-scale from the start, this is consistent
- The canonical rating for Arena entries is in `evolution_arena_elo` (updated across subsequent pipeline executions)
- `elo_score` on the variant row is a point-in-time snapshot (useful for execution history views)

**`match_count` on `evolution_variants`** — keep as-is:
- Snapshot of how many matches the variant participated in during the pipeline execution that created it
- The canonical match count for Arena entries is in `evolution_arena_elo.match_count` (grows across pipeline executions)
- Same snapshot-vs-canonical pattern as `elo_score`

**Agent metrics** (`evolution_run_agent_metrics`):
- `avg_elo`, `elo_gain`, `elo_per_dollar` — execution analytics rollups, NOT a separate rating system
- They compute "how well did agent X's variants perform in Arena-scale ratings during this pipeline execution"
- No changes needed — semantics are correct since all ratings are Arena-scale

## What Does NOT Change

- `state.ts` — addToPool, ratings Map
- `rating.ts` — all OpenSkill math
- `pool.ts` — stratified selection
- **Tournament** — existing caps and scoring handle efficiency
- **All other agents** — EvolutionAgent, TreeSearch, etc.
- **Agent metrics** — semantics unchanged (still Arena-scale rollups), but `persistAgentMetrics()` must filter `fromArena` entries to avoid inflating counts
- **eloAttribution.ts** — parent rating resolution unchanged, but `computeAndPersistAttribution()` must filter `fromArena` entries to avoid distorting per-agent attribution
- **Article detail page** — shows Arena data, just renamed
- **`is_winner` on `evolution_variants`** — execution analytics snapshot, not a curation step

## Edge Cases

| Case | Handling |
|------|----------|
| First run on new topic | Pool starts empty except baseline. Topic created at finalization. |
| Resumed from checkpoint | Arena entries in serialized state. Skip loadArenaEntries(). |
| Match count accumulation | Pre-seed `state.matchCounts.set(id, match_count)` during `loadArenaEntries()` (same as ratings pre-seeding). At sync: total = initial + new matches accumulated during pipeline. Must bypass `addToPool()` which would set matchCounts to 0. |
| Arena growth over time | Topics accumulate all variants across pipeline executions. CalibrationRanker's stratified selection naturally handles larger pools. Tournament's maxComparisons cap (40) limits cost. |
| Legacy `rank` / `generation_method` | Existing Arena entries keep their legacy values (`evolution_winner`, `evolution_top3`, etc.). New entries get `generation_method: 'evolution'` and `rank: NULL`. No migration of existing data needed. |
| Baseline already in Arena | `insertBaselineVariant()` always creates a fresh baseline variant. If the same baseline content was added in a prior execution, it enters as a new Arena entry with a new ID. This is correct — each execution snapshot gets its own entry. Deduplication (if desired later) is a separate concern. |
| eloAttribution parent lookup | `eloAttribution.ts` resolves parent ratings via `buildParentRatingResolver(state.ratings)`. Arena-loaded entries have no parent in the current execution — the resolver correctly falls back to `createRating()` for missing parents. This is fine: eloAttribution measures "rating gain relative to parent" and Arena entries have no parent attribution in the current execution. No changes needed. |
| Checkpoint snapshots (`--bank-checkpoints`) | `run-prompt-bank.ts` spawns `run-evolution-local.ts` with `--bank-checkpoints` which calls `snapshotCheckpointToHallOfFame()` to insert entries at iterations 3, 5, 10. After rename, this becomes `snapshotCheckpointToArena()`. These entries use `generation_method: 'evolution'` (updated from `'evolution_winner'`). No conflict with `syncToArena()` — checkpoint snapshots are a separate insertion path for prompt bank experiments, not the normal pipeline finalization. |
| Prompt bank labeling (`getEntryLabel()`) | `run-prompt-bank-comparisons.ts` builds labels from `generation_method` + model + iterations. With unified `generation_method: 'evolution'`, the label function needs updating to use metadata (model, iteration count) instead of relying on `generation_method` variants. Update as part of Phase 1 content renames. |
| `loadArenaEntries()` DB failure | Abort the pipeline with a clear error. Unlike `feedHallOfFame()` (which was non-fatal), loading Arena entries is a prerequisite — running without them produces disconnected ratings. Use existing error propagation pattern (throw, let pipeline-level catch handle). |
| Concurrent executions on same topic | Last `syncToArena()` call wins for elo updates. Acceptable: concurrent pipeline executions on the same topic are rare (one scheduled run per prompt per day). Matches from both executions are all recorded (append-only to `evolution_arena_comparisons`). For elo rows, both executions compute ratings from overlapping-but-divergent match histories — the last sync's values reflect its execution's matches. If needed later, add a topic-level advisory lock. |
| Pipeline retry (idempotency) | Variants are upserted by ID (safe). Matches are appended to `evolution_arena_comparisons` — a retry may duplicate matches. Mitigate: the `sync_to_arena` RPC function should check for existing matches by `(topic_id, entry_a_id, entry_b_id, created_at)` before inserting — application-level dedup inside the transaction. No new unique index needed (comparisons table has no `run_id` column and the same pair can legitimately match multiple times across iterations). |
| Soft-deleted Arena entry between load and sync | Loaded with `fromArena: true`, participates in matches normally. At sync: elo UPDATE targets the entry by ID. If it was soft-deleted mid-run, the UPDATE still succeeds (soft-delete sets `deleted_at`, doesn't remove the row). The entry's rating is updated but it remains deleted. Acceptable — deletion is an admin action; re-rating a deleted entry is harmless. |
| CALIBRATED_SIGMA_THRESHOLD value | Use `5.0` (not reusing `CONVERGENCE_SIGMA_THRESHOLD: 3.0`). Rationale: 3.0 is too strict — research finding #1 shows sigma needs ~40 matches to reach 3.0. At 5.0, an entry needs ~11 matches, which is achievable in 2-3 pipeline executions. Entries at sigma=5.0 are "roughly placed" — good enough to serve as calibration opponents but not so uncertain that they need full recalibration. Use strict `<` comparison: `sigma < 5.0` means "skip calibration for this entry." |

## File Change Summary

**Architecture changes (~12 files):**

| File | Change |
|------|--------|
| `evolution/src/lib/types.ts` | Add `arenaTopicId` on context, `fromArena` on pool entry |
| `evolution/src/lib/core/arenaIntegration.ts` | Add `loadArenaEntries()`, refactor to `syncToArena()`, remove `upsertEloRatings()` + `triggerAutoReRank()` |
| `evolution/src/lib/core/pipeline.ts` | Call `loadArenaEntries()` at start, `syncToArena()` at end, filter Arena entries in `buildRunSummary()` |
| `evolution/src/lib/agents/calibrationRanker.ts` | Skip calibrating entries with low sigma |
| `evolution/src/lib/core/persistence.ts` | Filter Arena-loaded entries from `persistVariants()` + `computeAndPersistAttribution()` |
| `evolution/src/lib/core/metricsWriter.ts` | Filter Arena-loaded entries from `persistAgentMetrics()` |
| `evolution/src/lib/index.ts` | Update exports |
| `src/app/admin/quality/evolution/run/[runId]/page.tsx` | Remove AddToHallOfFame dialog and button |
| `evolution/src/components/evolution/tabs/EloTab.tsx` | Remove hardcoded "Baseline 1200" reference line |
| `src/lib/schemas/schemas.ts` | Add `'evolution'` + `'evolution_ranked'` to generation method enum |
| `evolution/scripts/run-prompt-bank-comparisons.ts` | Update `getEntryLabel()` to use metadata instead of `generation_method` variants |
| `evolution/scripts/lib/arenaUtils.ts` | Update `ArenaInsertParams.generation_method` type to include `'evolution'` |
| `src/app/admin/quality/arena/[topicId]/page.tsx` | Add `'evolution'` to `METHOD_COLORS`, fix `isEvolution` check to match `'evolution'` (not just `'evolution_*'`) |
| `src/app/admin/quality/arena/page.tsx` | Add `'evolution'` to `METHOD_COLORS` |

**Rename (mechanical, ~50 files):**
- ~20 production source files (including `EvolutionSidebar.tsx` nav label)
- ~18 test files (including E2E `admin-hall-of-fame.spec.ts` and integration `hall-of-fame-actions.integration.test.ts`)
- 4 DB tables + 7 indexes + all FK/CHECK constraints (via migration)
- 1 URL route directory
- 13 file renames (including `bankUtils.ts` → consolidate into `arenaUtils.ts`)
- Sidebar labels, test IDs, CLI scripts

## Execution Order

1. DB migration: rename `evolution_hall_of_fame_*` → `evolution_arena_*`
2. DB migration: add `'evolution'` to `generation_method` CHECK, relax `rank` constraint, drop `idx_arena_entries_run_rank` and `idx_arena_entries_topic_rank` indexes, drop backward-compat views (`hall_of_fame_topics`, `hall_of_fame_entries`, etc. from migration 20260221000002), create `sync_to_arena` RPC function
3. Rename all files and content (mechanical find-replace)
4. Remove `AddToHallOfFameDialog` from run detail page
5. Remove "Baseline 1200" reference line from EloTab
6. Verify build passes with rename + UI changes only
7. Add `arenaTopicId` and `fromArena` to types
8. Implement `loadArenaEntries()` + tests
9. Wire into `executeFullPipeline()` / `executeMinimalPipeline()`
10. Skip calibrating low-sigma entries in CalibrationRanker
11. Filter Arena-loaded entries in `persistVariants()`
12. Implement `syncToArena()` — all matches, all variants, all ratings
13. Update `finalizePipelineRun()`
14. Update all tests
15. Lint, tsc, build, unit tests, integration tests
16. Phase 7: Documentation rewrite (can parallel with step 15)

## Testing

**Update existing (behavioral changes):**
- `arenaIntegration.test.ts` — update for syncToArena behavior (transactional, all variants, all matches)
- `arena.test.ts` — update for new finalization flow
- `pipeline.test.ts` — add test for loadArenaEntries at start, buildRunSummary filtering
- `calibrationRanker.test.ts` — test low-sigma entries skipped for calibration, used as opponents
- `arenaActions.test.ts` — update for renamed actions, generation_method enum
- `schemas.test.ts` — add `'evolution'` + `'evolution_ranked'` to generation method validation

**Update existing (mechanical rename — all files with `hall_of_fame` / `HallOfFame` references):**
- `hallOfFameIntegration.test.ts` → `arenaIntegration.test.ts`
- `hallOfFame.test.ts` → `arena.test.ts`
- `hallOfFameActions.test.ts` → `arenaActions.test.ts`
- `hallOfFameUtils.test.ts` → `arenaUtils.test.ts`
- `bankUtils.test.ts` → consolidate into `arenaUtils.test.ts`
- `hall-of-fame-actions.integration.test.ts` → `arena-actions.integration.test.ts` — update table names (68+ refs), remove/update Test 10 (upsert by rank) since `idx_arena_entries_run_rank` is dropped
- `admin-hall-of-fame.spec.ts` → `admin-arena.spec.ts` — update URLs, table names, test IDs; remove/update test for "Add to Hall of Fame" button (button is removed per Phase 6)
- Other test files with incidental `hall_of_fame` references: `experimentActions.test.ts`, `runTriggerContract.test.ts`, `evolution-actions.integration.test.ts`, `promptRegistryActions.test.ts`, `unifiedExplorerActions.test.ts`, `backfill-prompt-ids.test.ts`
- UI/sidebar test files with route/testId references: `AdminSidebar.test.tsx`, `EvolutionSidebar.test.tsx`, `SidebarSwitcher.test.tsx`, `evolution-dashboard/page.test.tsx` (also has `hallOfFameSize` property ref)

**New tests:**
- `loadArenaEntries()`: empty topic, topic with entries, pre-seeded ratings preserved, pre-seeded matchCounts preserved, `fromArena` tag set, entries NOT in `newEntrantsThisIteration`, **DB failure aborts pipeline** (throws, not swallowed)
- `syncToArena()`: all variants upserted (including baseline), all matches recorded, existing entries' ratings updated, match count accumulated, **transactional** (partial failure rolls back)
- `persistVariants()`: Arena-loaded entries filtered out
- `computeAndPersistAttribution()`: Arena-loaded entries excluded from attribution
- `persistAgentMetrics()`: Arena-loaded entries excluded from agent metrics

## Phase 7: Documentation Rewrite

After code changes are complete, update all docs that reference "two rating systems" or "within-run" vs "cross-run":

- `evolution/docs/evolution/hall_of_fame.md` → rename to `arena.md`, rewrite for unified pool model. Remove "cross-run" framing (line 5).
- `evolution/docs/evolution/rating_and_comparison.md` — rewrite: one rating system, no "within-run" vs "Arena" distinction. Remove "within-run" note (line 5).
- `evolution/docs/evolution/README.md` — delete "Two Rating Systems" section (lines 50-57), replace with one unified Arena description.
- `evolution/docs/evolution/reference.md` — update key functions, table names.
- `docs/docs_overall/architecture.md` — update Hall of Fame references.
- `evolution/docs/evolution/data_model.md` — "within-run lineage" (line 48) is fine as-is; it describes variant parentage relationships (an architectural fact), not a separate rating system.
