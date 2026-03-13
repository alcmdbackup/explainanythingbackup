# Remove Ordinals Replace With Mu Evolution Research

## Problem Statement
Remove ordinal (mu - 3*sigma) as the ranking/display metric throughout the evolution pipeline. Replace all ordinal usage with pure mu for sorting, Elo scale conversion, and persistence. The ordinal function penalizes uncertainty, which is already communicated via sigma/CI — baking it into the point estimate double-counts uncertainty.

## Requirements (from GH Issue #694)
Completely get rid of concept of ordinals from codebase. Replace with mu everywhere for evolution ranking.

## High Level Summary

The codebase is **already mostly migrated to pure mu**. All UI components, visualization actions, persistence, state tracking, supervisor, metrics, and most agents already use `mu` directly. The remaining ordinal references are:

1. **Database column** `ordinal` in `evolution_arena_elo` — still written for backward compat
2. **Deprecated alias** `ordinalToEloScale` in rating.ts (points to `toEloScale`)
3. **Arena actions** compute and persist `ordinal: mu - 3*sigma` in 3 locations
4. **Arena integration** reads/writes ordinal for DB compat
5. **V2 legacy schema** transforms old ordinal data to mu (keep for backward compat)
6. **Scripts** (4 files) write ordinal field incorrectly as `mu` instead of `mu - 3*sigma` (bug, but moot since we're removing it)
7. **Test fixtures** (12+ files) include ordinal fields
8. **DB indexes** use ordinal for sorting
9. **sync_to_arena RPC** accepts ordinal in JSONB payload
10. **openskill mock** exports unused `ordinal()` function

### Key Insight: Elo Scale Baseline
- `toEloScale(mu)` = `1200 + mu * 16`, clamped [0, 3000]
- Fresh rating (mu=25) → **Elo 1600** (not 1200)
- mu=0 → Elo 1200 (the formula's zero point)
- `computeEloPerDollar` subtracts 1200 correctly
- The system already displays 1600 for fresh variants — no behavioral change from this project

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/rating_and_comparison.md — already documents mu-based ranking
- evolution/docs/evolution/arena.md — notes ordinal column is legacy
- evolution/docs/evolution/visualization.md — UI uses ordinal-to-Elo mapping (needs doc update)
- evolution/docs/evolution/data_model.md — references ordinalToEloScale
- evolution/docs/evolution/reference.md — config and schema
- evolution/docs/evolution/experimental_framework.md — already documents mu-based metrics

## Code Files Read

### Core Rating & Types
- `evolution/src/lib/core/rating.ts` — `ordinalToEloScale` deprecated alias (line 79), `toEloScale(mu)` is canonical
- `evolution/src/lib/types.ts` — V2 schema with ordinalHistory/ordinal fields, auto-transforms to V3 mu (lines 695-781)
- `evolution/src/lib/index.ts` — exports `ordinalToEloScale` (line 56)
- `src/testing/mocks/openskill.ts` — exports unused `ordinal()` function (lines 43-45)

### Persistence & State (already mu-based)
- `evolution/src/lib/core/persistence.ts` — uses `toEloScale(rating.mu)` (line 77) ✅
- `evolution/src/lib/core/metricsWriter.ts` — uses `toEloScale(rating.mu)` (line 14, 193) ✅
- `evolution/src/lib/core/state.ts` — sorts by `mu` directly (line 81) ✅
- `evolution/src/lib/core/supervisor.ts` — tracks `muHistory` (line 103) ✅

### Arena (needs ordinal removal)
- `evolution/src/lib/core/arenaIntegration.ts` — SELECTs ordinal (line 36), writes `ordinal: mu - 3*sigma` (line 259)
- `evolution/src/services/arenaActions.ts` — interface has `ordinal` field (line 71), `buildInitialEloRow` computes ordinal (line 140), leaderboard selects ordinal (line 310), comparison upsert writes ordinal (line 543)

### Services (mostly mu-based)
- `evolution/src/services/evolutionVisualizationActions.ts` — all `toEloScale(rating.mu)` ✅
- `evolution/src/services/variantDetailActions.ts` — `buildEloLookup()` uses mu ✅
- `evolution/src/services/experimentHelpers.ts` — V2 ordinal fallback (line 12), keep for backward compat
- `evolution/src/experiments/evolution/experimentMetrics.ts` — uses mu throughout ✅

### Agents (already mu-based)
- `evolution/src/lib/agents/tournament.ts` — eligibility uses `mu >= 3*sigma` (lines 86-89, 389), already correct
- `evolution/src/lib/agents/calibrationRanker.ts` — no ordinal ✅
- `evolution/src/lib/agents/evolvePool.ts` — no ordinal ✅
- `evolution/src/lib/agents/debateAgent.ts` — no ordinal ✅
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — no ordinal ✅
- `evolution/src/lib/agents/metaReviewAgent.ts` — no ordinal ✅
- `evolution/src/lib/agents/treeSearchAgent.ts` — no ordinal ✅
- `evolution/src/lib/core/eloAttribution.ts` — no ordinal ✅
- `evolution/src/lib/core/pipeline.ts` — no ordinal ✅
- `evolution/src/lib/core/pool.ts` — no ordinal ✅

### Scripts (write ordinal field)
- `evolution/scripts/lib/arenaUtils.ts` — writes `ordinal: initRating.mu` (line 86) — BUG (moot)
- `evolution/scripts/run-arena-comparison.ts` — writes `ordinal: state.rating.mu` (line 232) — BUG (moot)
- `evolution/scripts/run-bank-comparison.ts` — writes `ordinal: state.rating.mu` (line 232) — BUG (moot)
- `evolution/scripts/run-prompt-bank-comparisons.ts` — writes `ordinal: state.rating.mu` (line 269) — BUG (moot)

### Database Migrations
- `20260220000002_hall_of_fame_openskill.sql` — adds ordinal column, creates `idx_arena_elo_topic_ordinal`
- `20260303000003_hof_elo_anchor_index.sql` — creates `idx_hof_elo_topic_anchor_eligible` (ordinal DESC)
- `20260303000005_arena_rename_and_schema.sql` — renames index, `sync_to_arena` RPC accepts ordinal

### Test Files (ordinal in fixtures/assertions)
- `evolution/src/lib/core/rating.test.ts` — backward compat alias test (lines 206-212)
- `evolution/src/lib/agents/tournament.test.ts` — ordinal comments only (lines 210-260)
- `evolution/src/services/arenaActions.test.ts` — ordinal in fixtures and assertions (lines 153, 267-291, 306-569)
- `evolution/src/services/experimentActions.test.ts` — V2 ordinal path tests (lines 314-327)
- `evolution/src/services/evolutionVisualizationActions.test.ts` — ordinal comment (line 606)
- `evolution/src/lib/core/arenaIntegration.test.ts` — ordinal in fixtures (lines 378, 383, 423)
- `evolution/src/lib/core/persistence.continuation.test.ts` — mocks getOrdinal (line 47)
- `src/app/admin/evolution/arena/arenaBudgetFilter.test.ts` — ordinal in fixture (line 11)
- `evolution/src/experiments/evolution/experimentMetrics.test.ts` — ordinal comments (lines 196, 346-348)
- `src/__tests__/integration/arena-actions.integration.test.ts` — ordinal assertions (lines 620-652)
- `src/__tests__/integration/evolution-visualization.integration.test.ts` — ordinal comments (lines 186-188)
- `evolution/src/lib/core/pipeline.test.ts` — V2→V3 migration test (lines 364-377)
- `src/app/api/cron/experiment-driver/route.test.ts` — ordinal in fixtures (lines 285-557)

## Key Findings

1. **All UI components already display mu-based Elo** — no ordinal is shown to users
2. **All ranking/sorting uses mu directly** — leaderboard orders by `mu DESC`, tournament filters by `mu >= 3*sigma`
3. **Ordinal column is write-only legacy** — computed and stored but never read for display or ranking
4. **V2→V3 schema migration must be preserved** — old checkpoint data needs ordinal→mu conversion
5. **DB migration needed** — drop ordinal column, replace indexes with mu-based ones, update `sync_to_arena` RPC
6. **Fresh rating Elo is 1600** — `toEloScale(25) = 1600`, already correct, no baseline shift
7. **Stale comment in rating.ts** — line 71 says "Fresh rating mu (25) maps to Elo 1200" but code produces 1600
8. **Scripts have ordinal bugs** — write `mu` to ordinal field instead of `mu - 3*sigma` (moot since we're removing)
9. **Tournament eligibility gate** (`mu >= 3*sigma`) is conceptually separate from ordinal — it's a confidence check, not an ordinal computation. Keep as-is.
10. **`computeEloPerDollar`** already uses mu correctly

## Open Questions

1. Should we drop the ordinal DB column entirely or make it nullable/deprecated? Dropping is cleaner but requires migration.
2. Should we keep the `ordinalToEloScale` alias during a deprecation period or remove immediately? All internal code can use `toEloScale`.
3. The eligibility gate `mu >= 3*sigma` in tournament.ts — is this still desired behavior, or should it change too? It's conceptually sound (confidence check) but uses the same math as ordinal.
