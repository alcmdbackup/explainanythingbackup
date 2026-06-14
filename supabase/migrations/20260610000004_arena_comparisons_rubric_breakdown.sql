-- Add rubric-judging columns to evolution_arena_comparisons.
--
--   * rubric_breakdown JSONB  — per-match snapshot of the rubric verdict:
--       { rubricId, dimensions:[{criteriaId,name,weight,forwardVerdict,reverseVerdict}],
--         forwardPass:{scoreA,scoreB,winner}, reversePass:{scoreA,scoreB,winner},
--         overall:{winner,confidence} }
--     Authoritative for Match Viewer rendering. NULL for holistic matches.
--   * judge_rubric_id UUID    — the rubric that judged this match, for indexed
--     filtering ("show matches judged by rubric X"). FK ON DELETE SET NULL — the
--     JSONB snapshot preserves the rubricId regardless, so this going NULL after
--     a later rubric hard-delete is purely cosmetic.
--
-- Both nullable + additive: pre-rubric rows are untouched and render as today.

BEGIN;

SET LOCAL statement_timeout = '60s';

ALTER TABLE evolution_arena_comparisons
  ADD COLUMN IF NOT EXISTS rubric_breakdown JSONB;

ALTER TABLE evolution_arena_comparisons
  ADD COLUMN IF NOT EXISTS judge_rubric_id UUID
  REFERENCES evolution_judge_rubrics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_evolution_arena_comparisons_judge_rubric
  ON evolution_arena_comparisons(judge_rubric_id) WHERE judge_rubric_id IS NOT NULL;

COMMIT;
