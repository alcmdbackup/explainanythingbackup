-- Phase 6 of calculate_implifed_rubric_weights_evolution_20260619: let a weight-inference
-- session source its pairs from a Judge Lab test set (frozen pairs) in addition to sampling
-- an arena topic, and support a paragraph pair_kind (not just article). Additive columns on
-- evolution_weight_inference_sessions; no data migration.

BEGIN;

SET LOCAL statement_timeout = '60s';

ALTER TABLE evolution_weight_inference_sessions
  ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'topic';
ALTER TABLE evolution_weight_inference_sessions
  ADD COLUMN IF NOT EXISTS judge_eval_test_set_id UUID;
ALTER TABLE evolution_weight_inference_sessions
  ADD COLUMN IF NOT EXISTS pair_kind TEXT NOT NULL DEFAULT 'article';

-- CHECK constraints (DROP-then-ADD for idempotency-lint: PG has no ADD CONSTRAINT IF NOT EXISTS)
ALTER TABLE evolution_weight_inference_sessions
  DROP CONSTRAINT IF EXISTS evolution_wi_sessions_source_kind_chk;
ALTER TABLE evolution_weight_inference_sessions
  ADD CONSTRAINT evolution_wi_sessions_source_kind_chk CHECK (source_kind IN ('topic', 'test_set'));

ALTER TABLE evolution_weight_inference_sessions
  DROP CONSTRAINT IF EXISTS evolution_wi_sessions_pair_kind_chk;
ALTER TABLE evolution_weight_inference_sessions
  ADD CONSTRAINT evolution_wi_sessions_pair_kind_chk CHECK (pair_kind IN ('article', 'paragraph'));

COMMENT ON COLUMN evolution_weight_inference_sessions.source_kind IS 'topic = sample an arena topic''s variants; test_set = use a Judge Lab test set''s frozen pairs.';
COMMENT ON COLUMN evolution_weight_inference_sessions.pair_kind IS 'article | paragraph — selects the comparison mode + rubric framing. Paragraph pairs come from a test set.';

COMMIT;
