# Eliminate Mu Replace Elo Evolution Progress

## Phase 1-3: Core refactor (atomic commit)
### Work Done
- Refactored `computeRatings.ts`: Rating type is now `{elo, uncertainty}`. OpenSkill remains internal (adapter functions convert Elo↔mu at the osRate boundary).
- New exports: `DEFAULT_ELO=1200`, `DEFAULT_UNCERTAINTY=400/3`, `DEFAULT_CONVERGENCE_UNCERTAINTY=72`, `dbToRating()`, `ratingToDb()`, `toDisplayElo()`, `_INTERNAL_*` helpers for DB boundary code.
- Updated `selectWinner.ts`: returns `{winnerId, elo, uncertainty}`.
- Updated all pipeline files (`rankSingleVariant`, `swissPairing`, `rankNewVariant`, `runIterationLoop`, `buildRunContext`, `persistRunResults`): Bradley-Terry in Elo space, eligibility using Elo, eloHistory (was muHistory).
- Updated agents (`MergeRatingsAgent`, `generateFromSeedArticle`, `createSeedArticle`): Rating fields, discardReason.localElo.
- Updated metrics (`finalization`, `propagation`, `experimentMetrics`, `writeMetrics`, `recomputeMetrics`): MetricValue.uncertainty, bootstrap sampling in Elo space.
- Updated detailViewConfigs: labels μ→Elo, σ→Uncertainty, ΔElo/ΔUncertainty.
- Updated Zod schemas in `schemas.ts`: ratingSchema, execution detail schemas, iterationSnapshotSchema.
- Updated `formatters.ts`: param names elo95CI(uncertainty), formatEloCIRange, formatEloWithUncertainty.
- Updated barrel exports (`index.ts`, `pipeline/index.ts`).

### Issues Encountered
- Initial TypeScript errors (274) across 25 files after core change — resolved by systematic updates using parallel agents.
- 6 test failures after source updates — mock functions still set `.mu` on ratings; fixed by updating mock code to use `.elo`.
- DETAIL_VIEW_CONFIGS had 2 copies (central config + per-agent) — needed both to stay in sync.

### User Clarifications
None needed; plan was explicit.

### Result
All 1020 evolution unit tests pass. Zero TypeScript errors.

## Phases 5-6: Server actions + UI
### Work Done
- `arenaActions.ts`: ArenaEntry now has `uncertainty` (Elo-scale), `toArenaEntry()` helper converts DB rows.
- `evolutionActions.ts`: IterationSnapshotRow uses `{elo, uncertainty}`, `normalizeSnapshotRow()` transforms legacy JSONB.
- `evolutionVisualizationActions.ts`: EloHistoryPoint uses `elo/elos` fields, handles legacy mu-scale data.
- `EloTab`: chart renders Elo on Y-axis.
- `MetricsTab`: "Elo"/"Avg Elo" headers.
- `SnapshotsTab`: Elo/Uncertainty columns, "Local Elo" for discarded.
- `TimelineTab`: "Elo: N" winner card.
- Arena leaderboard (`arena/[topicId]/page.tsx`): 'uncertainty' sort key, "Elo ± Uncertainty" header.
- `arenaCutoff.ts`: accepts `{elo_score, uncertainty}` directly.
- `VariantDetailContent.tsx`: "local Elo below the top-15% cutoff".

### Result
All 1960 evolution + admin tests pass. Zero TypeScript errors.

## Phase 4: DB Migration
### Work Done
- Created migration `20260413000001_rename_mu_sigma_to_elo_uncertainty.sql`:
  - `evolution_arena_comparisons`: 8 diagnostic columns renamed (entry_a_mu_before → entry_a_elo_before, etc.)
  - `evolution_metrics.sigma` → `uncertainty`
  - `evolution_variants.mu/sigma/elo_score` intentionally unchanged (stale trigger, sync_to_arena RPC, indexes depend on them)
- Created rollback migration `20260413000002_rollback_rename_mu_sigma.sql` (inert placeholder).
- Updated `MergeRatingsAgent` to write to new column names.
- Updated `database.types.ts` for evolution_metrics.
- Updated test fixtures and assertions.

### Result
All 1960 tests pass. Migration ready to deploy atomically with code.

## Phase 8: Documentation
### Work Done
- Updated 13 evolution docs to use Elo/uncertainty terminology
- Updated main `docs/docs_overall/architecture.md`
- Rewrote `rating_and_comparison.md` with new API surface
- Kept OpenSkill as implementation note (not public concept)
- Preserved historical context for schema auto-migration

## Final Verification
- TypeScript: 0 errors
- Tests: 1960/1960 pass
- UI: zero μ/σ characters visible to users (confirmed via grep)
- DB boundary: application-layer conversion preserves unchanged DB schema for evolution_variants

## Commits
1. `78e3cb63` — Phase 1-3: atomic refactor of Rating type and pipeline
2. `8e505174` — Phases 5-6: server actions and UI components
3. `aea6f20f` — Phase 4: DB migration + metric column renames
4. `5fd1164e` — Phase 8: documentation updates
