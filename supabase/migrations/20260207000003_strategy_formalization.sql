-- Migration 1c: Add is_predefined and pipeline_type to strategy_configs.
-- Distinguishes admin-curated strategies from auto-created ones.

ALTER TABLE strategy_configs
  ADD COLUMN IF NOT EXISTS is_predefined BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS pipeline_type TEXT;

-- Constraint: pipeline_type values
ALTER TABLE strategy_configs
  ADD CONSTRAINT strategy_configs_pipeline_type_check
  CHECK (pipeline_type IS NULL OR pipeline_type IN ('full', 'minimal', 'batch'));

COMMENT ON COLUMN strategy_configs.is_predefined IS 'true = admin-curated, false = auto-created from run config';
COMMENT ON COLUMN strategy_configs.pipeline_type IS 'Default pipeline for this strategy (full/minimal/batch). Run-level column is authoritative.';

-- Rollback:
-- ALTER TABLE strategy_configs DROP CONSTRAINT IF EXISTS strategy_configs_pipeline_type_check;
-- ALTER TABLE strategy_configs DROP COLUMN IF EXISTS is_predefined, DROP COLUMN IF EXISTS pipeline_type;
