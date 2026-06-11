-- Extend evolution_metrics.entity_type CHECK constraint to include 'judge_rubric'.
--
-- The judge-rubric entity (20260610000001) is a thin entity that currently emits
-- NO metrics, but it is registered in CORE_ENTITY_TYPES / ENTITY_TYPES; adding it
-- to the CHECK keeps the metrics table forward-compatible if rubric-level metrics
-- are ever added, and keeps the DB enum in sync with the TS entity-type union
-- (mirrors 20260503033103 for 'criteria').
--
-- Current values (after 20260503033103):
--   run, invocation, variant, strategy, experiment, prompt, tactic, criteria
-- Adding: judge_rubric

BEGIN;

SET LOCAL statement_timeout = '60s';

ALTER TABLE evolution_metrics DROP CONSTRAINT IF EXISTS evolution_metrics_entity_type_check;
ALTER TABLE evolution_metrics ADD CONSTRAINT evolution_metrics_entity_type_check
  CHECK (entity_type IN ('run','invocation','variant','strategy','experiment','prompt','tactic','criteria','judge_rubric'))
  NOT VALID;
ALTER TABLE evolution_metrics VALIDATE CONSTRAINT evolution_metrics_entity_type_check;

COMMIT;
