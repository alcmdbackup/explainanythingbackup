-- Extends evolution_cost_calibration.phase CHECK to accept the three iterative_editing
-- per-LLM-call phase strings:
--   'iterative_edit_propose'        — Proposer LLM call (one per cycle)
--   'iterative_edit_review'         — Approver LLM call (one per cycle)
--   'iterative_edit_drift_recovery' — Drift recovery LLM call (zero or one per cycle)
--
-- Same constraint name preserved across the rename for assertion stability.
--
-- Forward-only. Independent rollback path from the reflection-phase migration
-- (Decisions §18). Once the editing code references these phase strings, this
-- migration cannot be reverted without bricking the service via the Phase 1.6
-- startup assertion. Rollback post-code-deploy is flag-only (EDITING_AGENTS_ENABLED).

ALTER TABLE evolution_cost_calibration
  DROP CONSTRAINT evolution_cost_calibration_phase_allowed;

ALTER TABLE evolution_cost_calibration
  ADD CONSTRAINT evolution_cost_calibration_phase_allowed
  CHECK (phase IN (
    'generation',
    'ranking',
    'seed_title',
    'seed_article',
    'reflection',
    'iterative_edit_propose',
    'iterative_edit_review',
    'iterative_edit_drift_recovery'
  ));
