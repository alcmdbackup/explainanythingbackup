-- Judge Evaluation tool tables (create_tool_systematic_judge_evaluation_evolution_20260606).
-- Persists systematic judge-evaluation sweeps: a pair-bank (all comparison pairs pulled
-- from an arena topic), reusable frozen Test Sets (a sampled subset so consecutive runs
-- compare on identical pairs), eval runs (one per judge-settings tuple), and per-pair
-- per-repeat 2-pass calls. Separate from evolution_arena_comparisons (the in-run match log,
-- which drops judge settings + raw passes). Deny-all RLS + service_role bypass, mirrors
-- the evolution-table convention (20260524000003). Additive only; no existing table touched.

-- 1. Pair-bank: the full universe of candidate pairs from an arena topic.
CREATE TABLE IF NOT EXISTS judge_eval_pair_banks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  source_topic_id UUID,
  -- pairs: [{label, pair_kind, variant_a_id, variant_b_id, text_a, text_b, mu_a, mu_b,
  --          sigma_a, sigma_b, expected_winner, gap_kind, baseline_confidence}]
  pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Test set: a named, frozen sample of a pair-bank (the comparability anchor).
CREATE TABLE IF NOT EXISTS judge_eval_test_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_bank_id UUID NOT NULL REFERENCES judge_eval_pair_banks(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  strategy TEXT NOT NULL CHECK (strategy IN ('random', 'stratified_confidence', 'stratified_gap', 'manual')),
  seed BIGINT NOT NULL DEFAULT 1,
  size_article INT NOT NULL DEFAULT 0,
  size_paragraph INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Frozen membership: written once at create, never mutated.
CREATE TABLE IF NOT EXISTS judge_eval_test_set_members (
  test_set_id UUID NOT NULL REFERENCES judge_eval_test_sets(id) ON DELETE CASCADE,
  pair_label TEXT NOT NULL,
  pair_kind TEXT NOT NULL CHECK (pair_kind IN ('article', 'paragraph')),
  PRIMARY KEY (test_set_id, pair_label)
);

-- 4. Eval run: one row per judge-settings tuple against a test set.
CREATE TABLE IF NOT EXISTS judge_eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_set_id UUID NOT NULL REFERENCES judge_eval_test_sets(id) ON DELETE CASCADE,
  judge_model TEXT NOT NULL,
  temperature NUMERIC(4,2) NOT NULL DEFAULT 0,
  reasoning_effort TEXT CHECK (reasoning_effort IN ('none', 'low', 'medium', 'high')),
  kind_filter TEXT NOT NULL DEFAULT 'both' CHECK (kind_filter IN ('article', 'paragraph', 'both')),
  prompt_variant TEXT,
  prompt_variant_hash TEXT NOT NULL,
  repeats INT NOT NULL DEFAULT 10,
  -- settings_key = sha256(judge_model|temperature|reasoning_effort|prompt_variant_hash|kind_filter|test_set_id)
  settings_key TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_judge_eval_runs_test_set ON judge_eval_runs (test_set_id);

-- 5. Per-pair per-repeat 2-pass result. pair_kind + comparison_mode denormalized so the
--    leaderboard slices by kind without joining the bank JSONB.
CREATE TABLE IF NOT EXISTS judge_eval_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_run_id UUID NOT NULL REFERENCES judge_eval_runs(id) ON DELETE CASCADE,
  pair_label TEXT NOT NULL,
  pair_kind TEXT NOT NULL CHECK (pair_kind IN ('article', 'paragraph')),
  comparison_mode TEXT NOT NULL CHECK (comparison_mode IN ('article', 'paragraph')),
  repeat_index INT NOT NULL,
  forward_winner TEXT CHECK (forward_winner IN ('A', 'B', 'TIE')),
  reverse_winner TEXT CHECK (reverse_winner IN ('A', 'B', 'TIE')),
  winner TEXT NOT NULL CHECK (winner IN ('A', 'B', 'TIE')),
  confidence NUMERIC(2,1) NOT NULL,
  decisive BOOLEAN GENERATED ALWAYS AS (confidence > 0.6) STORED,
  wall_ms INT,
  fwd_ms INT,
  rev_ms INT,
  prompt_tokens INT,
  output_tokens INT,
  reasoning_tokens INT,
  cost_usd NUMERIC(12,6),
  forward_raw TEXT,
  reverse_raw TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (eval_run_id, pair_label, repeat_index)
);

CREATE INDEX IF NOT EXISTS idx_judge_eval_calls_run ON judge_eval_calls (eval_run_id);
CREATE INDEX IF NOT EXISTS idx_judge_eval_calls_run_kind_decisive ON judge_eval_calls (eval_run_id, pair_kind, decisive);

-- RLS: deny-all default + service_role bypass on all 5 tables.
ALTER TABLE judge_eval_pair_banks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON judge_eval_pair_banks;
CREATE POLICY deny_all ON judge_eval_pair_banks FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_all ON judge_eval_pair_banks;
CREATE POLICY service_role_all ON judge_eval_pair_banks FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE judge_eval_test_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON judge_eval_test_sets;
CREATE POLICY deny_all ON judge_eval_test_sets FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_all ON judge_eval_test_sets;
CREATE POLICY service_role_all ON judge_eval_test_sets FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE judge_eval_test_set_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON judge_eval_test_set_members;
CREATE POLICY deny_all ON judge_eval_test_set_members FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_all ON judge_eval_test_set_members;
CREATE POLICY service_role_all ON judge_eval_test_set_members FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE judge_eval_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON judge_eval_runs;
CREATE POLICY deny_all ON judge_eval_runs FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_all ON judge_eval_runs;
CREATE POLICY service_role_all ON judge_eval_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE judge_eval_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON judge_eval_calls;
CREATE POLICY deny_all ON judge_eval_calls FOR ALL USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS service_role_all ON judge_eval_calls;
CREATE POLICY service_role_all ON judge_eval_calls FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Leaderboard: best judge settings by decisive rate, scoped to a test set, split by kind.
-- Cross-run comparability: every run against the same test_set_id is directly comparable.
CREATE OR REPLACE VIEW judge_eval_settings_leaderboard AS
SELECT
  r.test_set_id,
  r.id AS eval_run_id,
  r.judge_model,
  r.temperature,
  r.reasoning_effort,
  r.kind_filter,
  r.prompt_variant_hash,
  r.repeats,
  c.pair_kind,
  count(*) AS n_calls,
  avg((c.decisive)::int)::numeric AS decisive_rate,
  avg(c.confidence)::numeric AS avg_confidence,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY c.wall_ms) AS med_wall_ms,
  avg(c.output_tokens)::numeric AS avg_output_tokens,
  avg(c.reasoning_tokens)::numeric AS avg_reasoning_tokens,
  sum(c.cost_usd) AS total_cost_usd,
  CASE WHEN sum((c.decisive)::int) > 0
       THEN sum(c.cost_usd) / sum((c.decisive)::int)
       ELSE NULL END AS cost_per_decisive_usd
FROM judge_eval_runs r
JOIN judge_eval_calls c ON c.eval_run_id = r.id
WHERE c.error IS NULL
GROUP BY r.test_set_id, r.id, r.judge_model, r.temperature, r.reasoning_effort,
         r.kind_filter, r.prompt_variant_hash, r.repeats, c.pair_kind;

-- VIEW RLS lockdown: views bypass underlying-table RLS, so restrict to service_role only
-- (mirrors evolution_run_costs). Exposes variant texts/costs/settings.
REVOKE ALL ON judge_eval_settings_leaderboard FROM PUBLIC, anon, authenticated;
GRANT SELECT ON judge_eval_settings_leaderboard TO service_role;

COMMENT ON TABLE judge_eval_pair_banks IS 'Full set of candidate comparison pairs pulled from an arena topic, for systematic judge evaluation. See docs/planning/create_tool_systematic_judge_evaluation_evolutioN_20260606.';
COMMENT ON TABLE judge_eval_test_sets IS 'Named, frozen sample of a pair-bank. Runs against the same test set are directly comparable.';
COMMENT ON TABLE judge_eval_runs IS 'One eval run per judge-settings tuple against a test set. settings_key (incl. test_set_id) enforces idempotent re-run.';
COMMENT ON TABLE judge_eval_calls IS 'Per-pair per-repeat 2-pass judge verdict + raw passes + cost/latency/tokens. decisive = confidence > 0.6 (live-metric parity).';
