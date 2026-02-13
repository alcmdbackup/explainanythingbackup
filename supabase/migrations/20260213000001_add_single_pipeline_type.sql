-- Add 'single' to pipeline_type CHECK constraints on content_evolution_runs and strategy_configs.
-- Supports the new single-article pipeline mode (sequential improvement without population search).

ALTER TABLE content_evolution_runs
  DROP CONSTRAINT IF EXISTS evolution_runs_pipeline_type_check;
ALTER TABLE content_evolution_runs
  ADD CONSTRAINT evolution_runs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch', 'single'));

ALTER TABLE strategy_configs
  DROP CONSTRAINT IF EXISTS strategy_configs_pipeline_type_check;
ALTER TABLE strategy_configs
  ADD CONSTRAINT strategy_configs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch', 'single'));
