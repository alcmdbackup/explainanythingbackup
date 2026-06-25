-- Phase 1 of evalute_implied_rubric_results_and_experimentally_validate_20260623: per-session
-- override for the holistic comparison prompt used by auto-mode weight-inference. Default NULL
-- keeps every existing session byte-identical to pre-migration behavior. The override replaces
-- the hardcoded checklist in buildComparisonPrompt; the verdict-instruction tail is preserved
-- by judgePairOnce passing strictVerdictTail=true (so parseWinner still resolves A/B/TIE).
-- Additive column; no data migration.

BEGIN;

SET LOCAL statement_timeout = '60s';

ALTER TABLE evolution_weight_inference_sessions
  ADD COLUMN IF NOT EXISTS holistic_prompt_override TEXT;

-- Length cap (DROP-then-ADD for idempotency-lint: PG has no ADD CONSTRAINT IF NOT EXISTS)
ALTER TABLE evolution_weight_inference_sessions
  DROP CONSTRAINT IF EXISTS evolution_wi_sessions_holistic_override_len;
ALTER TABLE evolution_weight_inference_sessions
  ADD CONSTRAINT evolution_wi_sessions_holistic_override_len
    CHECK (holistic_prompt_override IS NULL OR char_length(holistic_prompt_override) <= 8000);

COMMENT ON COLUMN evolution_weight_inference_sessions.holistic_prompt_override IS
  'Optional override for the holistic comparison prompt body (replaces the hardcoded checklist in buildComparisonPrompt). NULL = use default. Operator-supplied; Zod-validated at insert time to reject reserved markers (## Text A, ## Text B, Your answer:, <|, |>). Used to A/B-test how the holistic prompt drives implied-rubric weights — see docs/planning/evalute_implied_rubric_results_and_experimentally_validate_20260623/.';

COMMIT;
