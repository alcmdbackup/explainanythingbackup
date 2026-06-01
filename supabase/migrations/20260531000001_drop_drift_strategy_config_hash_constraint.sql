-- Drop the redundant/drift UNIQUE constraint on evolution_strategies.config_hash.
-- Project: further_investigate_paragraph_recombine_performance_20260531 (GH #1154), Task A / D5.
--
-- WHY: the live staging DB carries TWO unique constraints on config_hash:
--   1. uq_strategies_config_hash  — the canonical one, defined in
--      20260329000001_add_evolution_constraints.sql; this is the ON CONFLICT (config_hash)
--      target used by upsertStrategy(). KEEP IT.
--   2. uq_strategy_config_hash    — an undocumented DRIFT constraint that appears in NO
--      migration (confirmed via pg_constraint on staging). Redundant with #1. DROP IT.
--
-- SAFETY: dropping the drift constraint is safe because uq_strategies_config_hash remains and
-- continues to back the column's uniqueness + the onConflict upsert target. No FK references
-- config_hash (FKs target evolution_strategies.id). DROP CONSTRAINT IF EXISTS is idempotent
-- and a no-op on any DB that never acquired the drift constraint (e.g. the ephemeral DB used
-- by `npm run migration:verify`, which builds from migrations only). The real effect lands on
-- staging/prod where the drift exists; confirm post-merge via pg_constraint.

ALTER TABLE evolution_strategies DROP CONSTRAINT IF EXISTS uq_strategy_config_hash;
