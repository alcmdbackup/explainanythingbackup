-- Phase 4 (judge_escalation_prod_wiring): normalize multi-judge "submatch" rows for PRODUCTION arena
-- matches, mirroring the Judge Lab judge_eval_calls/judge_eval_dimension_verdicts breakout. A match in
-- evolution_arena_comparisons can consolidate several submatches (one per judge in the escalation
-- chain); rubric-mode submatches further break out into per-dimension verdict rows. All additive +
-- idempotent; the feature is gated default-OFF, so pre-Phase-4 rows are untouched and render as today
-- (a legacy single-judge match = a chain-of-1 with zero submatch rows, read from rubric_breakdown JSONB).

BEGIN;

SET LOCAL statement_timeout = '60s';

-- Parent summary columns (nullable, additive): the consolidated chain shape for fast list rendering
-- without joining the children. agreement = fraction of decisive submatches that picked the match winner.
ALTER TABLE evolution_arena_comparisons
  ADD COLUMN IF NOT EXISTS chain_depth INT;
ALTER TABLE evolution_arena_comparisons
  ADD COLUMN IF NOT EXISTS agreement NUMERIC;
ALTER TABLE evolution_arena_comparisons
  ADD COLUMN IF NOT EXISTS aggregation_rule TEXT;
ALTER TABLE evolution_arena_comparisons
  ADD COLUMN IF NOT EXISTS aggregation_rule_version INT;

-- One row per submatch (one judge's consolidated 2-pass result). chain_config_id is the composition
-- id; judge_rubric_id has NO FK (Judge-Lab convention: tolerate synthetic/test rubrics).
CREATE TABLE IF NOT EXISTS evolution_arena_submatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_comparison_id UUID NOT NULL REFERENCES evolution_arena_comparisons (id) ON DELETE CASCADE,
  judge_model TEXT NOT NULL,
  escalation_step INT NOT NULL DEFAULT 0,
  triggered_escalation BOOLEAN NOT NULL DEFAULT false,
  winner TEXT,
  confidence NUMERIC,
  chain_config_id TEXT,
  judge_rubric_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_submatches_comparison
  ON evolution_arena_submatches (arena_comparison_id);

-- One row per rubric dimension per submatch (only for rubric-mode submatches). favored_match_winner is
-- precomputed relative to the consolidated MATCH winner (NULL when the dimension is a TIE). No FK on
-- criteria_id (criteria_name is the durable snapshot).
CREATE TABLE IF NOT EXISTS evolution_submatch_dimension_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submatch_id UUID NOT NULL REFERENCES evolution_arena_submatches (id) ON DELETE CASCADE,
  criteria_id UUID,
  criteria_name TEXT NOT NULL,
  weight NUMERIC NOT NULL,
  forward_verdict TEXT,
  reverse_verdict TEXT,
  dimension_winner TEXT,
  favored_match_winner BOOLEAN,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arena_submatch_dims_submatch
  ON evolution_submatch_dimension_verdicts (submatch_id);
CREATE INDEX IF NOT EXISTS idx_arena_submatch_dims_criteria
  ON evolution_submatch_dimension_verdicts (criteria_id) WHERE criteria_id IS NOT NULL;

-- RLS: deny-all + service_role_all (evolution house style; mirrors evolution_arena_comparisons).
ALTER TABLE evolution_arena_submatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON evolution_arena_submatches;
CREATE POLICY deny_all ON evolution_arena_submatches FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_all ON evolution_arena_submatches;
CREATE POLICY service_role_all ON evolution_arena_submatches FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE evolution_submatch_dimension_verdicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON evolution_submatch_dimension_verdicts;
CREATE POLICY deny_all ON evolution_submatch_dimension_verdicts FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_all ON evolution_submatch_dimension_verdicts;
CREATE POLICY service_role_all ON evolution_submatch_dimension_verdicts FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
