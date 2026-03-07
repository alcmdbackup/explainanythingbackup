-- Extend created_by CHECK constraint to include 'experiment' and 'batch' sources.
-- Supports pre-registering strategy configs when experiment or batch runs are created.

ALTER TABLE evolution_strategy_configs
  DROP CONSTRAINT IF EXISTS strategy_configs_created_by_check;

ALTER TABLE evolution_strategy_configs
  ADD CONSTRAINT strategy_configs_created_by_check
  CHECK (created_by IN ('system', 'admin', 'experiment', 'batch'));

COMMENT ON COLUMN evolution_strategy_configs.created_by IS 'system = auto-created from run finalization, admin = created via UI, experiment = created by experiment runner, batch = created by batch CLI';
