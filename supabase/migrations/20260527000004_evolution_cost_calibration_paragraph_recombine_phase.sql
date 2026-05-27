-- Extends evolution_cost_calibration.phase CHECK to accept the paragraph_recombine
-- per-LLM-call phase string:
--   'paragraph_rewrite' — per-paragraph rewrite LLM call (M per slot per invocation)
--
-- Per Phase 2 of rank_individual_paragraphs_evolution_20260525. The per-slot ranking
-- phase intentionally REUSES the existing 'ranking' AgentName label (per D11 + plan-
-- review iter-1 finding) so v2MockLlm.ts pair-routing works without modification.
-- Per-purpose cost attribution still flows to paragraph_recombine_cost because the
-- ranking calls execute under the slot's AgentCostScope which records into the
-- umbrella metric via the scope intercept path.
--
-- Same constraint name preserved for Phase 1.7 (startupAssertions) stability.
-- Re-lists ALL existing phases so the new constraint is the union of everything
-- that came before plus 'paragraph_rewrite' — matches the additive pattern from
-- 20260501204142 + 20260506000001 + 20260508000003.

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
    'paragraph_rewrite'
  ));
