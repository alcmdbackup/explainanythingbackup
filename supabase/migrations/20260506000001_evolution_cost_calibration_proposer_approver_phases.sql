-- Extends evolution_cost_calibration.phase CHECK to accept the three propose/approve criteria
-- per-LLM-call phase strings AND restores 'evaluate_and_suggest' which was missing from the
-- prior CHECK despite being referenced in costCalibrationLoader.ts:30 and used by
-- estimateCosts.ts:186 (the constraint was effectively broken for that phase since 20260501204142).
--
-- Same constraint name preserved across the rename for assertion stability
-- (assertCostCalibrationPhaseEnumsMatch in startupAssertions.ts queries by name).
--
-- Forward-only. Rollback post-code-deploy is flag-only via
-- EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED='false'. To rollback the schema,
-- restore the prior 8-phase CHECK constraint AFTER reverting code references.

ALTER TABLE evolution_cost_calibration
  DROP CONSTRAINT IF EXISTS evolution_cost_calibration_phase_allowed;

ALTER TABLE evolution_cost_calibration
  ADD CONSTRAINT evolution_cost_calibration_phase_allowed
  CHECK (phase IN (
    'generation',
    'ranking',
    'seed_title',
    'seed_article',
    'reflection',
    'evaluate_and_suggest',
    'iterative_edit_propose',
    'iterative_edit_review',
    'iterative_edit_drift_recovery',
    'criteria_proposer',
    'criteria_forward_approver',
    'criteria_mirror_approver'
  ));
