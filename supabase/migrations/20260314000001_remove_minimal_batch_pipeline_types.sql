-- Remove 'minimal' and 'batch' from pipeline_type CHECK constraints.
-- Migrate existing rows to 'full'.
BEGIN;

UPDATE content_evolution_runs
  SET pipeline_type = 'full'
  WHERE pipeline_type IN ('minimal', 'batch');

UPDATE strategy_configs
  SET pipeline_type = 'full'
  WHERE pipeline_type IN ('minimal', 'batch');

ALTER TABLE content_evolution_runs
  DROP CONSTRAINT IF EXISTS evolution_runs_pipeline_type_check;

ALTER TABLE content_evolution_runs
  ADD CONSTRAINT evolution_runs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'single'));

ALTER TABLE strategy_configs
  DROP CONSTRAINT IF EXISTS strategy_configs_pipeline_type_check;

ALTER TABLE strategy_configs
  ADD CONSTRAINT strategy_configs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'single'));

COMMIT;
