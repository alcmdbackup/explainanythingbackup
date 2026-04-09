-- Add CHECK constraints on status enums and UNIQUE on config_hash for evolution tables.
-- These constraints enforce at the DB level what was previously only validated in TypeScript.
-- Idempotent: drops existing constraints before re-adding (safe for re-runs).

BEGIN;

-- Backfill: ensure no NULL statuses exist before adding CHECK constraints
UPDATE evolution_experiments SET status = 'draft' WHERE status IS NULL;
UPDATE evolution_runs SET status = 'pending' WHERE status IS NULL;
UPDATE evolution_prompts SET status = 'active' WHERE status IS NULL;
UPDATE evolution_strategies SET status = 'active' WHERE status IS NULL;

-- Drop existing constraints if present (idempotent)
ALTER TABLE evolution_runs DROP CONSTRAINT IF EXISTS check_runs_status;
ALTER TABLE evolution_experiments DROP CONSTRAINT IF EXISTS check_experiments_status;
ALTER TABLE evolution_prompts DROP CONSTRAINT IF EXISTS check_prompts_status;
ALTER TABLE evolution_strategies DROP CONSTRAINT IF EXISTS check_strategies_status;
ALTER TABLE evolution_strategies DROP CONSTRAINT IF EXISTS uq_strategies_config_hash;

-- Status enum CHECK constraints
ALTER TABLE evolution_runs
  ADD CONSTRAINT check_runs_status
  CHECK (status IN ('pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'));

ALTER TABLE evolution_experiments
  ADD CONSTRAINT check_experiments_status
  CHECK (status IN ('draft', 'running', 'completed', 'cancelled'));

ALTER TABLE evolution_prompts
  ADD CONSTRAINT check_prompts_status
  CHECK (status IN ('active', 'archived'));

ALTER TABLE evolution_strategies
  ADD CONSTRAINT check_strategies_status
  CHECK (status IN ('active', 'archived'));

-- Unique constraint on config_hash (prevents duplicate strategy configs)
ALTER TABLE evolution_strategies
  ADD CONSTRAINT uq_strategies_config_hash
  UNIQUE (config_hash);

COMMIT;
