-- Extend evolution_metrics.entity_type CHECK constraint to include 'criteria'.
-- Required so criteria-level metrics (avg_score, frequency_as_weakest,
-- total_variants_focused, avg_elo_delta_when_focused, run_count) can be
-- written by computeCriteriaMetricsForRun.
--
-- Current values (after 20260417000001):
--   run, invocation, variant, strategy, experiment, prompt, tactic
-- Adding: criteria
--
-- Must run AFTER 20260502120000 (which created evolution_criteria) and
-- BEFORE any code path that writes entity_type='criteria' rows.

BEGIN;

SET LOCAL statement_timeout = '60s';

ALTER TABLE evolution_metrics DROP CONSTRAINT IF EXISTS evolution_metrics_entity_type_check;
ALTER TABLE evolution_metrics ADD CONSTRAINT evolution_metrics_entity_type_check
  CHECK (entity_type IN ('run','invocation','variant','strategy','experiment','prompt','tactic','criteria'))
  NOT VALID;
ALTER TABLE evolution_metrics VALIDATE CONSTRAINT evolution_metrics_entity_type_check;

COMMIT;
