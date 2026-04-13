-- Rename mu/sigma columns to elo/uncertainty terminology on diagnostic/metric tables.
--
-- Scope (only safe renames — no trigger/index/RPC dependencies):
--   * evolution_arena_comparisons: 8 diagnostic before/after columns
--   * evolution_metrics: sigma → uncertainty
--
-- NOT renamed (application-layer conversion instead):
--   * evolution_variants.mu/sigma — needed by stale trigger (AFTER UPDATE OF mu, sigma),
--     sync_to_arena RPC (entry->>'mu'), and idx_variants_arena_prompt index.
--     The application layer (buildRunContext.ts, persistRunResults.ts) converts between
--     DB mu/sigma and Rating {elo, uncertainty} at the query boundary via dbToRating/
--     ratingToDb helpers in computeRatings.ts.
--
-- Deployment note: this migration and the corresponding TypeScript code changes
-- (MergeRatingsAgent arena_comparison column writes, metrics uncertainty field) must
-- deploy atomically. Both column renames are on write-path columns.
--
-- Rollback: see 20260413000002_rollback_rename_mu_sigma.sql (companion file).

-- ─── evolution_arena_comparisons: rename 8 diagnostic columns ──────────────

ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_a_mu_before TO entry_a_elo_before;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_a_sigma_before TO entry_a_uncertainty_before;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_b_mu_before TO entry_b_elo_before;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_b_sigma_before TO entry_b_uncertainty_before;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_a_mu_after TO entry_a_elo_after;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_a_sigma_after TO entry_a_uncertainty_after;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_b_mu_after TO entry_b_elo_after;
ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_b_sigma_after TO entry_b_uncertainty_after;

-- ─── evolution_metrics: rename sigma column ────────────────────────────────

ALTER TABLE evolution_metrics RENAME COLUMN sigma TO uncertainty;
