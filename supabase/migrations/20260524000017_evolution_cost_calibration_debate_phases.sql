-- Extends evolution_cost_calibration.phase CHECK to accept the two debate_and_generate
-- per-LLM-call phase strings (per bring_back_debate_agent_20260506 Phase 1.6a):
--   'debate_judge'     — combined analyze+judge LLM call (Option C, one per debate iteration)
--   'debate_synthesis' — synthesis LLM call delegated to inner GFPA via the I4 LLM-client
--                        proxy (one per debate iteration when judge verdict is non-tie)
--
-- Both phases flow into the single 'debate_cost' metric per Decision §6 + Phase 1.4;
-- the calibration-table layer keeps phase distinction so per-purpose tokens-per-call
-- coefficients can diverge.
--
-- Same constraint name preserved across the rename for Phase 1.7 assertion stability.
--
-- Forward-only. Once the debate code references these phase strings, this migration
-- cannot be reverted without bricking the service via the Phase 1.7 startup assertion.
-- Rollback post-code-deploy is flag-only (EVOLUTION_DEBATE_ENABLED).

-- Idempotency: use IF EXISTS so the DROP doesn't fail when the migration re-runs
-- after staging tracker desync. Pairs with the same change in earlier phase migrations
-- (20260501204141, 20260501204142).
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
    'iterative_edit_propose',
    'iterative_edit_review',
    'iterative_edit_drift_recovery',
    'debate_judge',
    'debate_synthesis'
  ));
