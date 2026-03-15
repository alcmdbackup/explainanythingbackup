-- Remove 'minimal' and 'batch' from pipeline_type CHECK constraints.
-- Migrate existing rows to 'full'.
-- Uses actual table names (post-20260221000002 rename); views are backward-compat only.
BEGIN;

UPDATE evolution_runs
  SET pipeline_type = 'full'
  WHERE pipeline_type IN ('minimal', 'batch');

UPDATE evolution_strategy_configs
  SET pipeline_type = 'full'
  WHERE pipeline_type IN ('minimal', 'batch');

ALTER TABLE evolution_runs
  DROP CONSTRAINT IF EXISTS evolution_runs_pipeline_type_check;

ALTER TABLE evolution_runs
  ADD CONSTRAINT evolution_runs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'single'));

ALTER TABLE evolution_strategy_configs
  DROP CONSTRAINT IF EXISTS strategy_configs_pipeline_type_check;

ALTER TABLE evolution_strategy_configs
  ADD CONSTRAINT strategy_configs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'single'));

COMMIT;
