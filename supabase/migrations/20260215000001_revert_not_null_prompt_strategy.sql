-- Reverts NOT NULL constraints on prompt_id and strategy_config_id added by
-- 20260207000008_enforce_not_null.sql. These columns must remain nullable because
-- explanation-only runs have no prompt_id and runs without a strategy have no
-- strategy_config_id.
--
-- Rollback:
-- ALTER TABLE content_evolution_runs ALTER COLUMN prompt_id SET NOT NULL;
-- ALTER TABLE content_evolution_runs ALTER COLUMN strategy_config_id SET NOT NULL;

ALTER TABLE content_evolution_runs
  ALTER COLUMN prompt_id DROP NOT NULL;

ALTER TABLE content_evolution_runs
  ALTER COLUMN strategy_config_id DROP NOT NULL;

COMMENT ON COLUMN content_evolution_runs.prompt_id IS 'Optional: links run to prompt (hall_of_fame_topics). NULL for explanation-based runs.';
COMMENT ON COLUMN content_evolution_runs.strategy_config_id IS 'Optional: links run to strategy (strategy_configs). NULL for runs without a strategy.';
