-- Migration 6: Enforce NOT NULL on prompt_id and strategy_config_id.
-- Safety gate: aborts if backfill is incomplete or queue is not drained.
-- Apply ONLY after all existing runs are backfilled and no in-flight runs exist.

DO $$ BEGIN
  -- Check for completed/failed/paused runs with NULL FKs
  IF EXISTS (
    SELECT 1 FROM content_evolution_runs
    WHERE (prompt_id IS NULL OR strategy_config_id IS NULL)
      AND status IN ('completed', 'failed', 'paused')
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Backfill incomplete: NULL prompt_id or strategy_config_id rows still exist among completed runs.';
  END IF;

  -- Check for in-flight runs
  IF EXISTS (
    SELECT 1 FROM content_evolution_runs
    WHERE status IN ('pending', 'claimed', 'running')
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Queue not drained: in-flight runs exist. Wait for completion and backfill before applying.';
  END IF;
END $$;

ALTER TABLE content_evolution_runs
  ALTER COLUMN prompt_id SET NOT NULL;

ALTER TABLE content_evolution_runs
  ALTER COLUMN strategy_config_id SET NOT NULL;

COMMENT ON COLUMN content_evolution_runs.prompt_id IS 'Required: links run to prompt (article_bank_topics)';
COMMENT ON COLUMN content_evolution_runs.strategy_config_id IS 'Required: links run to strategy (strategy_configs)';

-- Rollback:
-- ALTER TABLE content_evolution_runs ALTER COLUMN prompt_id DROP NOT NULL;
-- ALTER TABLE content_evolution_runs ALTER COLUMN strategy_config_id DROP NOT NULL;
