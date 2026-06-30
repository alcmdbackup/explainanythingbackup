-- Analysis: elo-agent-comparison-federal-reserve-2-20260628
-- Experiment: bc10c2e0-a51c-41a8-a2c3-34577a1fa489  Arena prompt: 6f5c85e5-0d6f-42f3-ba91-cbf2377f2317
-- Run via: npm run query:staging -- --json "<query>"   (staging, read-only)
-- Primary metrics (median lift, %impr, P(best), Δ-vs-generate) come from the recompute script, NOT raw SQL:
--   npx tsx evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts \
--     --experiment-id bc10c2e0-a51c-41a8-a2c3-34577a1fa489 \
--     --prompt-id 6f5c85e5-0d6f-42f3-ba91-cbf2377f2317 --baseline generate --threshold 40
-- (in-memory OpenSkill replay of evolution_arena_comparisons -> recompute anchor 1175.9)

-- Q1: per-arm runs + article/ranked variant throughput
SELECT s.config->'iterationConfigs'->0->>'agentType' AS arm,
  count(DISTINCT r.id) AS runs_total,
  count(DISTINCT r.id) FILTER (WHERE r.status='completed') AS runs_done,
  count(DISTINCT r.id) FILTER (WHERE r.status='failed') AS runs_failed,
  count(v.id) FILTER (WHERE v.variant_kind='article' AND v.generation_method<>'seed') AS article_variants,
  count(v.id) FILTER (WHERE v.variant_kind='article' AND v.generation_method<>'seed' AND v.synced_to_arena AND v.arena_match_count>0) AS ranked_variants
FROM evolution_runs r JOIN evolution_strategies s ON s.id=r.strategy_id
LEFT JOIN evolution_variants v ON v.run_id=r.id
WHERE r.experiment_id='bc10c2e0-a51c-41a8-a2c3-34577a1fa489' GROUP BY arm ORDER BY arm;

-- Q2: % of ranked article variants better than the seed (anchor ~1191 DB Elo) — quality density
SELECT s.config->'iterationConfigs'->0->>'agentType' AS arm,
  count(*) AS ranked_variants,
  count(*) FILTER (WHERE v.elo_score > 1191) AS better_than_seed,
  round(100.0*count(*) FILTER (WHERE v.elo_score > 1191)/count(*),0) AS pct_better
FROM evolution_variants v JOIN evolution_runs r ON r.id=v.run_id JOIN evolution_strategies s ON s.id=r.strategy_id
WHERE r.experiment_id='bc10c2e0-a51c-41a8-a2c3-34577a1fa489'
  AND v.variant_kind='article' AND v.generation_method<>'seed' AND v.synced_to_arena AND v.arena_match_count>0
GROUP BY arm ORDER BY pct_better DESC;

-- Q3: per-arm judge decisiveness (winner<>'draw' AND confidence>=0.6)
-- (evolution/scripts/analysis/funnel_per_arm_decisive_matches.sql, substituted on experiment_id)

-- Q4: per-arm % of ranked variants BELOW the seed (genuine-weakness proxy)
SELECT s.config->'iterationConfigs'->0->>'agentType' AS arm,
  count(*) AS variants,
  round(100.0*count(*) FILTER (WHERE v.elo_score < 1191)/count(*),0) AS pct_below
FROM evolution_variants v JOIN evolution_runs r ON r.id=v.run_id JOIN evolution_strategies s ON s.id=r.strategy_id
WHERE r.experiment_id='bc10c2e0-a51c-41a8-a2c3-34577a1fa489' AND v.synced_to_arena AND v.arena_match_count>0
GROUP BY arm ORDER BY pct_below DESC;

-- Q5: per-arm budget utilization (equal $0.10/run; total budget = budget/run x queued runs)
SELECT s.config->'iterationConfigs'->0->>'agentType' AS arm,
  (s.config->>'budgetUsd')::numeric AS budget_per_run,
  count(DISTINCT r.id) AS runs_queued,
  round((s.config->>'budgetUsd')::numeric * count(DISTINCT r.id),2) AS total_budget,
  round(sum(i.cost_usd)::numeric,3) AS total_spent
FROM evolution_runs r JOIN evolution_strategies s ON s.id=r.strategy_id
LEFT JOIN evolution_agent_invocations i ON i.run_id=r.id
WHERE r.experiment_id='bc10c2e0-a51c-41a8-a2c3-34577a1fa489' GROUP BY arm, s.config->>'budgetUsd' ORDER BY arm;

-- Q6: design verification — rounds + sourceMode (all arms) and seed-lineage of variants
SELECT DISTINCT jsonb_array_length(s.config->'iterationConfigs') AS rounds,
  s.config->'iterationConfigs'->0->>'sourceMode' AS source_mode, count(DISTINCT s.id) AS strategies
FROM evolution_strategies s
WHERE s.id IN (SELECT DISTINCT strategy_id FROM evolution_runs WHERE experiment_id='bc10c2e0-a51c-41a8-a2c3-34577a1fa489')
GROUP BY 1,2;
-- All 2,120 article variants have parent_variant_ids[1] = a run_id-NULL seed row (parent_is_seed).

-- Q7: arena match topology (same-run vs cross-run vs vs-anchor) across all 4,518 comparisons
SELECT CASE
    WHEN va.run_id IS NULL OR vb.run_id IS NULL THEN 'involves_seed_anchor'
    WHEN va.run_id = vb.run_id THEN 'same_run'
    WHEN ra.experiment_id='bc10c2e0-a51c-41a8-a2c3-34577a1fa489' AND rb.experiment_id='bc10c2e0-a51c-41a8-a2c3-34577a1fa489' THEN 'cross_run'
    ELSE 'outside_experiment' END AS match_kind,
  count(*) AS matches
FROM evolution_arena_comparisons c
JOIN evolution_variants va ON va.id=c.entry_a JOIN evolution_variants vb ON vb.id=c.entry_b
LEFT JOIN evolution_runs ra ON ra.id=va.run_id LEFT JOIN evolution_runs rb ON rb.id=vb.run_id
WHERE c.prompt_id='6f5c85e5-0d6f-42f3-ba91-cbf2377f2317' GROUP BY 1 ORDER BY matches DESC;

-- Q8: per-arm median Elo change PER INVOCATION (every ranked variant's Elo - seed ~1191),
-- vs the run-level max-lift. The "typical edit" rather than the per-run best.
SELECT s.config->'iterationConfigs'->0->>'agentType' AS arm,
  count(*) AS ranked_variants,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (v.elo_score - 1191))::numeric,1) AS median_delta_per_inv,
  round(avg(v.elo_score - 1191)::numeric,1) AS mean_delta_per_inv,
  round(min(v.elo_score)::numeric,0) AS worst_elo, round(max(v.elo_score)::numeric,0) AS best_elo
FROM evolution_variants v JOIN evolution_runs r ON r.id=v.run_id JOIN evolution_strategies s ON s.id=r.strategy_id
WHERE r.experiment_id='bc10c2e0-a51c-41a8-a2c3-34577a1fa489'
  AND v.variant_kind='article' AND v.generation_method<>'seed' AND v.synced_to_arena AND v.arena_match_count>0
GROUP BY arm ORDER BY median_delta_per_inv DESC;

-- Q9: historical (pre-initiative) per-invocation child-vs-parent Elo by agent group (apples-to-apples
-- comparison; parent = the variant the agent edited, NOT the seed).
SELECT CASE WHEN v.agent_name IN ('iterative_editing','iterative_editing_rewrite','paragraph_recombine','paragraph_recombine_with_coherence_pass') THEN v.agent_name
    WHEN v.agent_name LIKE '%reflect%' THEN 'reflect_and_generate' WHEN v.agent_name LIKE '%criteria%' THEN 'criteria_family'
    WHEN v.agent_name LIKE '%debate%' THEN 'debate' ELSE 'generate_family (tactics)' END AS agent_group,
  count(*) AS variants, round(avg(p.elo_score)::numeric,0) AS avg_parent_elo,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (v.elo_score - p.elo_score))::numeric,1) AS median_delta,
  round(100.0*count(*) FILTER (WHERE v.elo_score>p.elo_score)/count(*),0) AS pct_beats_parent
FROM evolution_variants v JOIN evolution_variants p ON p.id = v.parent_variant_ids[1]
WHERE v.created_at::date < '2026-06-26' AND v.elo_score IS NOT NULL AND v.arena_match_count>0
  AND p.elo_score IS NOT NULL AND p.arena_match_count>0 GROUP BY 1 ORDER BY median_delta DESC;
