-- Compare_critera_judge_vs_whole_article_paragraph_judge_evolution_20260619: Judge Lab "Agreement
-- Sweep" — runs a HOLISTIC (no-rubric) judge AND a RUBRIC (all-criteria, one 2-pass call) judge on the
-- SAME pair, and records how often the aggregated rubric verdict + each individual criterion agree with
-- the holistic winner, plus each judge's accuracy vs the Elo-gap ground truth (large-gap pairs).
--
-- Additive + idempotent. Separate from judge_eval_runs/_calls/_dimension_verdicts (those answer a
-- DIFFERENT question — criterion vs the rubric's OWN aggregate via favored_match_winner). This family
-- pairs holistic vs rubric for the same pair, which no existing column does. RLS: deny-all by default
-- (RLS on, no permissive policy) + service_role_all, mirroring judge_eval_dimension_verdicts.

-- ── Run: one row per agreement-sweep settings tuple (idempotent by settings_key). ──────────────────
CREATE TABLE IF NOT EXISTS judge_eval_agreement_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_set_id UUID NOT NULL REFERENCES judge_eval_test_sets (id) ON DELETE CASCADE,
  judge_model TEXT NOT NULL,
  temperature NUMERIC(4, 2) NOT NULL DEFAULT 0,
  reasoning_effort TEXT CHECK (reasoning_effort IN ('none', 'low', 'medium', 'high')),
  kind_filter TEXT NOT NULL DEFAULT 'both' CHECK (kind_filter IN ('article', 'paragraph', 'both')),
  -- The rubric the rubric-judge used. No FK (Judge Lab tolerates synthetic/test rubrics; same stance
  -- as judge_eval_dimension_verdicts.criteria_id).
  judge_rubric_id UUID NOT NULL,
  repeats INT NOT NULL DEFAULT 10,
  -- sha256('agreement|judge_model|temp|reasoning|rubric|kind_filter|repeats|test_set_id') — the
  -- 'agreement' prefix guarantees no collision with judge_eval_runs.settings_key.
  settings_key TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE judge_eval_agreement_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "judge_eval_agreement_runs_service_role_all" ON judge_eval_agreement_runs;
CREATE POLICY "judge_eval_agreement_runs_service_role_all" ON judge_eval_agreement_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON judge_eval_agreement_runs FROM PUBLIC;
REVOKE ALL ON judge_eval_agreement_runs FROM anon;
REVOKE ALL ON judge_eval_agreement_runs FROM authenticated;
GRANT ALL ON judge_eval_agreement_runs TO service_role;

-- ── Call: one row per (pair × repeat), pairing the holistic and rubric verdicts on the same pair. ──
CREATE TABLE IF NOT EXISTS judge_eval_agreement_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_run_id UUID NOT NULL REFERENCES judge_eval_agreement_runs (id) ON DELETE CASCADE,
  pair_label TEXT NOT NULL,
  pair_kind TEXT NOT NULL CHECK (pair_kind IN ('article', 'paragraph')),
  repeat_index INT NOT NULL,
  -- Holistic (no-rubric) judge verdict.
  holistic_winner TEXT NOT NULL CHECK (holistic_winner IN ('A', 'B', 'TIE')),
  holistic_confidence NUMERIC(2, 1) NOT NULL,
  holistic_decisive BOOLEAN GENERATED ALWAYS AS (holistic_confidence > 0.6) STORED,
  -- Rubric (all-criteria) judge aggregate verdict.
  rubric_winner TEXT NOT NULL CHECK (rubric_winner IN ('A', 'B', 'TIE')),
  rubric_confidence NUMERIC(2, 1) NOT NULL,
  rubric_decisive BOOLEAN GENERATED ALWAYS AS (rubric_confidence > 0.6) STORED,
  -- Raw label equality (holistic_winner = rubric_winner). NULL on errored rows.
  rubric_matches_holistic BOOLEAN,
  -- Cost / tokens: split + summed.
  holistic_cost_usd NUMERIC(12, 6),
  rubric_cost_usd NUMERIC(12, 6),
  cost_usd NUMERIC(12, 6),
  prompt_tokens INT,
  output_tokens INT,
  reasoning_tokens INT,
  wall_ms INT,
  -- Audit (verbatim per-pass raw output, nullable on error/legacy).
  holistic_forward_raw TEXT,
  holistic_reverse_raw TEXT,
  rubric_forward_raw TEXT,
  rubric_reverse_raw TEXT,
  error TEXT,
  -- Frozen ground-truth snapshot (durable vs pair-bank re-seeding), same as judge_eval_calls.
  mu_a NUMERIC,
  mu_b NUMERIC,
  sigma_a NUMERIC,
  sigma_b NUMERIC,
  baseline_confidence NUMERIC,
  gap_kind TEXT CHECK (gap_kind IN ('large', 'close')),
  expected_winner TEXT CHECK (expected_winner IN ('A', 'B')),
  variant_a_id UUID,
  variant_b_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jeac_run ON judge_eval_agreement_calls (agreement_run_id);

ALTER TABLE judge_eval_agreement_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "judge_eval_agreement_calls_service_role_all" ON judge_eval_agreement_calls;
CREATE POLICY "judge_eval_agreement_calls_service_role_all" ON judge_eval_agreement_calls
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON judge_eval_agreement_calls FROM PUBLIC;
REVOKE ALL ON judge_eval_agreement_calls FROM anon;
REVOKE ALL ON judge_eval_agreement_calls FROM authenticated;
GRANT ALL ON judge_eval_agreement_calls TO service_role;

-- ── Criterion verdict: one row per criterion per call (flat + SQL-queryable for /analysis). ────────
CREATE TABLE IF NOT EXISTS judge_eval_agreement_criterion_verdicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_call_id UUID NOT NULL REFERENCES judge_eval_agreement_calls (id) ON DELETE CASCADE,
  criteria_id UUID,
  criteria_name TEXT NOT NULL,
  weight NUMERIC NOT NULL,
  forward_verdict TEXT,
  reverse_verdict TEXT,
  dimension_winner TEXT,
  -- Did this criterion's winner agree with the HOLISTIC winner. NULL when the criterion is a TIE/abstain.
  agrees_with_holistic BOOLEAN,
  -- Did this criterion's winner match the Elo-gap ground truth. NULL unless a large-gap, decisive criterion.
  matches_ground_truth BOOLEAN,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jeacv_call
  ON judge_eval_agreement_criterion_verdicts (agreement_call_id);
CREATE INDEX IF NOT EXISTS idx_jeacv_criteria
  ON judge_eval_agreement_criterion_verdicts (criteria_id) WHERE criteria_id IS NOT NULL;

ALTER TABLE judge_eval_agreement_criterion_verdicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "judge_eval_agreement_criterion_verdicts_service_role_all" ON judge_eval_agreement_criterion_verdicts;
CREATE POLICY "judge_eval_agreement_criterion_verdicts_service_role_all" ON judge_eval_agreement_criterion_verdicts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON judge_eval_agreement_criterion_verdicts FROM PUBLIC;
REVOKE ALL ON judge_eval_agreement_criterion_verdicts FROM anon;
REVOKE ALL ON judge_eval_agreement_criterion_verdicts FROM authenticated;
GRANT ALL ON judge_eval_agreement_criterion_verdicts TO service_role;

-- ── Leaderboard view: one row per run × pair_kind. Headline aggregates only (run-detail uses the TS
--    reducer). FILTER + NULLIF guard against divide-by-zero / NULL-in-denominator on zero-large-gap runs.
CREATE OR REPLACE VIEW judge_eval_agreement_leaderboard AS
SELECT
  a.id AS agreement_run_id,
  a.test_set_id,
  a.judge_model,
  a.temperature,
  a.reasoning_effort,
  a.judge_rubric_id,
  a.kind_filter,
  a.repeats,
  c.pair_kind,
  count(*) AS n_calls,
  avg((c.rubric_matches_holistic)::int)::numeric AS strict_agree_rate,
  (count(*) FILTER (WHERE c.holistic_decisive AND c.rubric_decisive AND c.rubric_matches_holistic))::numeric
    / NULLIF(count(*) FILTER (WHERE c.holistic_decisive AND c.rubric_decisive), 0) AS both_decisive_agree_rate,
  avg((c.holistic_decisive <> c.rubric_decisive)::int)::numeric AS abstain_divergence_rate,
  (count(*) FILTER (WHERE c.gap_kind = 'large' AND c.holistic_decisive AND c.holistic_winner = c.expected_winner))::numeric
    / NULLIF(count(*) FILTER (WHERE c.gap_kind = 'large' AND c.holistic_decisive), 0) AS holistic_accuracy,
  (count(*) FILTER (WHERE c.gap_kind = 'large' AND c.rubric_decisive AND c.rubric_winner = c.expected_winner))::numeric
    / NULLIF(count(*) FILTER (WHERE c.gap_kind = 'large' AND c.rubric_decisive), 0) AS rubric_accuracy,
  sum(c.cost_usd) AS total_cost_usd
FROM judge_eval_agreement_runs a
JOIN judge_eval_agreement_calls c ON c.agreement_run_id = a.id
WHERE c.error IS NULL
GROUP BY a.id, a.test_set_id, a.judge_model, a.temperature, a.reasoning_effort,
         a.judge_rubric_id, a.kind_filter, a.repeats, c.pair_kind;

REVOKE ALL ON judge_eval_agreement_leaderboard FROM PUBLIC;
REVOKE ALL ON judge_eval_agreement_leaderboard FROM anon;
REVOKE ALL ON judge_eval_agreement_leaderboard FROM authenticated;
GRANT SELECT ON judge_eval_agreement_leaderboard TO service_role;
