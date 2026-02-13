-- Migration 3a: Add lifecycle columns to strategy_configs.
-- Distinguishes admin-curated strategies with status management.

ALTER TABLE strategy_configs
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT 'system';

ALTER TABLE strategy_configs
  ADD CONSTRAINT strategy_configs_status_check
  CHECK (status IN ('active', 'archived'));

ALTER TABLE strategy_configs
  ADD CONSTRAINT strategy_configs_created_by_check
  CHECK (created_by IN ('system', 'admin'));

COMMENT ON COLUMN strategy_configs.status IS 'active = available for runs, archived = hidden from run-queue';
COMMENT ON COLUMN strategy_configs.created_by IS 'system = auto-created from run, admin = created via UI';

-- Rollback:
-- ALTER TABLE strategy_configs DROP CONSTRAINT IF EXISTS strategy_configs_created_by_check;
-- ALTER TABLE strategy_configs DROP CONSTRAINT IF EXISTS strategy_configs_status_check;
-- ALTER TABLE strategy_configs DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS created_by;
