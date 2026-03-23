-- Migration: make strategy_config_id the single source of truth for run config.
-- Drops the config JSONB column after backfilling budget_cap_usd and enforcing NOT NULL on strategy FK.

-- Step 0: Ensure budget_cap_usd column exists (V2 migration omitted it but production has it)
ALTER TABLE evolution_runs ADD COLUMN IF NOT EXISTS budget_cap_usd NUMERIC(10,4) DEFAULT 1.00;

-- Step 1: Backfill budget_cap_usd from config JSONB where missing
UPDATE evolution_runs
SET budget_cap_usd = COALESCE((config->>'budgetCapUsd')::NUMERIC, 1.00)
WHERE budget_cap_usd IS NULL AND config IS NOT NULL AND config != '{}'::jsonb;

-- Step 2: Safety check — abort if any runs still have NULL strategy_config_id
DO $$
DECLARE missing_count INT;
BEGIN
  SELECT count(*) INTO missing_count FROM evolution_runs WHERE strategy_config_id IS NULL;
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Cannot proceed: % runs have NULL strategy_config_id. Run backfill script first.', missing_count;
  END IF;
END $$;

-- Step 3: Make strategy_config_id NOT NULL
ALTER TABLE evolution_runs ALTER COLUMN strategy_config_id SET NOT NULL;

-- Step 4: Delete unused V1 strategy rows (no runs reference them)
-- Uses EXISTS subquery against actual FK, NOT the denormalized run_count counter
DELETE FROM evolution_strategy_configs s
WHERE (s.config ? 'enabledAgents' OR s.config ? 'singleArticle')
  AND NOT EXISTS (SELECT 1 FROM evolution_runs r WHERE r.strategy_config_id = s.id);

-- Step 5: Drop config JSONB column
ALTER TABLE evolution_runs DROP COLUMN IF EXISTS config;
