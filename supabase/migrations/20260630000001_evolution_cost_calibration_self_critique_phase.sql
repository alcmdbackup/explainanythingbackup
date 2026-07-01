-- Extends evolution_cost_calibration.phase CHECK to accept the self_critique
-- per-LLM-call phase string:
--   'self_critique' — the reflection LLM call made by SelfCritiqueReviseAgent
--   (brainstorm_new_agents_with_reflection_20260630).
--
-- Wrapping agent's inner GFPA still issues 'generation' + 'ranking' calls;
-- only the reflection call carries this label. Routes to self_critique_cost
-- umbrella metric via COST_METRIC_BY_AGENT.
--
-- Same constraint name preserved for startupAssertions.ts stability.
-- Re-lists ALL existing phases so the new constraint is the union of everything
-- that came before plus 'self_critique' — matches the additive pattern from
-- 20260501204142 + 20260506000001 + 20260508000003 + 20260527000004.
--
-- Idempotent via DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT
-- (required by lint-migrations-idempotent CI job).

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
    'criteria_mirror_approver',
    'debate_judge',
    'debate_synthesis',
    'paragraph_rewrite',
    'self_critique'
  ));
