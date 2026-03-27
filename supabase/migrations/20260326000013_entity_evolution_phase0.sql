-- Phase 0: Rename evolution_prompts.title → name, remove arena_topic from metrics CHECK,
-- and add FK RESTRICT on evolution_runs.strategy_id.

-- 1. Rename column: evolution_prompts.title → name
ALTER TABLE evolution_prompts RENAME COLUMN title TO name;

-- 2. Remove arena_topic from evolution_metrics CHECK constraint.
--    Drop the old constraint and add a new one without arena_topic.
ALTER TABLE evolution_metrics DROP CONSTRAINT IF EXISTS evolution_metrics_entity_type_check;
ALTER TABLE evolution_metrics ADD CONSTRAINT evolution_metrics_entity_type_check
  CHECK (entity_type IN ('run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt'));

-- 3. Add FK RESTRICT on evolution_runs.strategy_id → evolution_strategies.id.
--    ON DELETE RESTRICT prevents deleting a strategy that has runs referencing it.
ALTER TABLE evolution_runs
  ADD CONSTRAINT fk_runs_strategy
  FOREIGN KEY (strategy_id) REFERENCES evolution_strategies(id) ON DELETE RESTRICT;
