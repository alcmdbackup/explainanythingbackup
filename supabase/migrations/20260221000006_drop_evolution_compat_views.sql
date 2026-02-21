-- Drop backward-compatible views created in 20260221000002_evolution_table_rename.sql.
-- Safe to drop now that all code uses the new evolution_* table names (PR 2 merged and deployed).

DROP VIEW IF EXISTS content_evolution_runs;
DROP VIEW IF EXISTS content_evolution_variants;
DROP VIEW IF EXISTS hall_of_fame_topics;
DROP VIEW IF EXISTS hall_of_fame_entries;
DROP VIEW IF EXISTS hall_of_fame_comparisons;
DROP VIEW IF EXISTS hall_of_fame_elo;
DROP VIEW IF EXISTS strategy_configs;
DROP VIEW IF EXISTS batch_runs;
DROP VIEW IF EXISTS agent_cost_baselines;

NOTIFY pgrst, 'reload schema';
