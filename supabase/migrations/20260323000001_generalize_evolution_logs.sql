-- Generalize evolution_run_logs into evolution_logs with multi-entity support.
-- Adds entity_type, entity_id, experiment_id, strategy_id for hierarchical log aggregation.

-- Step 1: Rename table
ALTER TABLE evolution_run_logs RENAME TO evolution_logs;

-- Step 2: Backwards-compat VIEW so old code still works during deploy window
CREATE OR REPLACE VIEW evolution_run_logs AS SELECT * FROM evolution_logs;

-- Step 3: Relax run_id NOT NULL — experiment/strategy logs have no run_id
ALTER TABLE evolution_logs ALTER COLUMN run_id DROP NOT NULL;

-- Step 4: Add entity identification columns
ALTER TABLE evolution_logs ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'run';
ALTER TABLE evolution_logs ADD COLUMN IF NOT EXISTS entity_id UUID;

-- Step 5: Add denormalized ancestor columns
ALTER TABLE evolution_logs ADD COLUMN IF NOT EXISTS experiment_id UUID;
ALTER TABLE evolution_logs ADD COLUMN IF NOT EXISTS strategy_id UUID;

-- Step 6: Backfill entity_id from run_id for existing rows
UPDATE evolution_logs SET entity_id = run_id WHERE entity_type = 'run' AND entity_id IS NULL;

-- Step 7: Enforce entity_id NOT NULL after backfill
ALTER TABLE evolution_logs ALTER COLUMN entity_id SET NOT NULL;

-- Step 8: Backfill experiment_id and strategy_id from evolution_runs
UPDATE evolution_logs el
SET experiment_id = er.experiment_id, strategy_id = er.strategy_id
FROM evolution_runs er
WHERE el.run_id = er.id AND el.strategy_id IS NULL;

-- Step 9: New indexes for aggregation queries
CREATE INDEX IF NOT EXISTS idx_logs_experiment_created
  ON evolution_logs (experiment_id, created_at DESC) WHERE experiment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_strategy_created
  ON evolution_logs (strategy_id, created_at DESC) WHERE strategy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_entity
  ON evolution_logs (entity_type, entity_id, created_at DESC);

-- Step 10: Recreate RLS policies for renamed table
ALTER TABLE evolution_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON evolution_logs;
CREATE POLICY deny_all ON evolution_logs FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_all ON evolution_logs;
CREATE POLICY service_role_all ON evolution_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    EXECUTE 'DROP POLICY IF EXISTS readonly_select ON evolution_logs';
    EXECUTE 'CREATE POLICY readonly_select ON evolution_logs FOR SELECT TO readonly_local USING (true)';
  END IF;
END $$;
