-- Drop the legacy duplicate FK constraint on evolution_runs.strategy_id.
-- Two FKs exist pointing to evolution_strategies(id):
--   1. evolution_runs_strategy_config_id_fkey (legacy, pre-migration-history)
--   2. fk_runs_strategy (added in 20260324000001)
-- The duplicate causes PostgREST PGRST201 (HTTP 300) when using !inner joins
-- because PostgREST cannot disambiguate between the two relationships.

ALTER TABLE evolution_runs
  DROP CONSTRAINT IF EXISTS evolution_runs_strategy_config_id_fkey;
