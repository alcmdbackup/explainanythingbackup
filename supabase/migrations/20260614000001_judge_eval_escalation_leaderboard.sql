-- Phase 2 (groups_of_judges_make_up_indecisiveness_evolution_20260611): extend the Judge Lab
-- leaderboard to cover escalation runs. Single-judge rows (submatch_group_key IS NULL) keep their
-- exact existing semantics (per-call decisive rate). Escalation rows are aggregated at the MATCH
-- level: submatches are grouped by submatch_group_key, the consolidated verdict is the final
-- (highest escalation_step) submatch, and cost is summed across the chain's submatches. Idempotent
-- (CREATE OR REPLACE VIEW). Column list is byte-identical so existing consumers are unaffected.

CREATE OR REPLACE VIEW judge_eval_settings_leaderboard AS
-- Single-judge runs: per-call decisive rate (unchanged).
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
WHERE c.error IS NULL AND c.submatch_group_key IS NULL
GROUP BY r.test_set_id, r.id, r.judge_model, r.temperature, r.reasoning_effort,
         r.kind_filter, r.prompt_variant_hash, r.repeats, c.pair_kind

UNION ALL

-- Escalation runs: aggregate per MATCH. A match is one submatch_group_key; its consolidated verdict
-- is the final (max escalation_step) submatch; cost/tokens/wall are summed across the chain.
SELECT
  r.test_set_id,
  r.id AS eval_run_id,
  r.judge_model,
  r.temperature,
  r.reasoning_effort,
  r.kind_filter,
  r.prompt_variant_hash,
  r.repeats,
  m.pair_kind,
  count(*) AS n_calls,
  avg((m.decisive)::int)::numeric AS decisive_rate,
  avg(m.confidence)::numeric AS avg_confidence,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY m.wall_ms) AS med_wall_ms,
  avg(m.output_tokens)::numeric AS avg_output_tokens,
  avg(m.reasoning_tokens)::numeric AS avg_reasoning_tokens,
  sum(m.total_cost) AS total_cost_usd,
  CASE WHEN sum((m.decisive)::int) > 0
       THEN sum(m.total_cost) / sum((m.decisive)::int)
       ELSE NULL END AS cost_per_decisive_usd
FROM judge_eval_runs r
JOIN (
  SELECT
    eval_run_id,
    submatch_group_key,
    (array_agg(pair_kind ORDER BY escalation_step DESC))[1] AS pair_kind,
    (array_agg(decisive ORDER BY escalation_step DESC))[1] AS decisive,
    (array_agg(confidence ORDER BY escalation_step DESC))[1] AS confidence,
    sum(cost_usd) AS total_cost,
    sum(wall_ms) AS wall_ms,
    sum(output_tokens) AS output_tokens,
    sum(reasoning_tokens) AS reasoning_tokens
  FROM judge_eval_calls
  WHERE error IS NULL AND submatch_group_key IS NOT NULL
  GROUP BY eval_run_id, submatch_group_key
) m ON m.eval_run_id = r.id
GROUP BY r.test_set_id, r.id, r.judge_model, r.temperature, r.reasoning_effort,
         r.kind_filter, r.prompt_variant_hash, r.repeats, m.pair_kind;

-- Re-assert the view's RLS lockdown (CREATE OR REPLACE preserves grants, but be explicit).
REVOKE ALL ON judge_eval_settings_leaderboard FROM PUBLIC;
REVOKE ALL ON judge_eval_settings_leaderboard FROM anon;
REVOKE ALL ON judge_eval_settings_leaderboard FROM authenticated;
GRANT SELECT ON judge_eval_settings_leaderboard TO service_role;
