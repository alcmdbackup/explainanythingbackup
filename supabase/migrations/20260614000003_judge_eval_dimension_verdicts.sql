-- Phase 3 (groups_of_judges_make_up_indecisiveness_evolution_20260611): per-dimension verdict
-- breakout for rubric-mode submatches. A rubric-mode judge_eval_calls row gets N rows here (one per
-- rubric dimension), making "which criterion picked the winner" a queryable table instead of a JSONB
-- blob. criteria_id is stored WITHOUT an FK (Judge Lab tolerates synthetic/test rubrics) + a
-- criteria_name snapshot, so a verdict survives a criterion rename/delete. Idempotent + additive.

CREATE TABLE IF NOT EXISTS judge_eval_dimension_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_eval_call_id UUID NOT NULL REFERENCES judge_eval_calls (id) ON DELETE CASCADE,
  criteria_id UUID,
  criteria_name TEXT NOT NULL,
  weight NUMERIC NOT NULL,
  forward_verdict TEXT,
  reverse_verdict TEXT,
  dimension_winner TEXT,
  -- TRUE/FALSE = did this dimension favor the consolidated MATCH winner; NULL when the dim is a TIE.
  favored_match_winner BOOLEAN,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jedv_call
  ON judge_eval_dimension_verdicts (judge_eval_call_id);
CREATE INDEX IF NOT EXISTS idx_jedv_criteria
  ON judge_eval_dimension_verdicts (criteria_id) WHERE criteria_id IS NOT NULL;

ALTER TABLE judge_eval_dimension_verdicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "judge_eval_dimension_verdicts_service_role_all" ON judge_eval_dimension_verdicts;
CREATE POLICY "judge_eval_dimension_verdicts_service_role_all" ON judge_eval_dimension_verdicts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON judge_eval_dimension_verdicts FROM PUBLIC;
REVOKE ALL ON judge_eval_dimension_verdicts FROM anon;
REVOKE ALL ON judge_eval_dimension_verdicts FROM authenticated;
GRANT ALL ON judge_eval_dimension_verdicts TO service_role;
