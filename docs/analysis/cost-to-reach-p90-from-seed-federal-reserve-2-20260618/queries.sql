-- Cost to reach a p90 variant starting from the canonical seed of federal_reserve_2.
-- Run against staging Supabase (`readonly_local` role) via:
--   npm run query:staging -- --json "<query>"
--
-- Prompt: federal_reserve_2 (staging only)
--   id   = a546b7e9-f066-403d-9589-f5e0d2c9fa4f
--   name = 'Federal Reserve 2'
--
-- p90 cutoff (from arena-elo-distribution-federal-reserve-2-20260617):
--   Elo 1287 — the 90th percentile of the active arena leaderboard.
--
-- Seed identity (Q1) — the canonical baseline:
--   id = 26ab2327-6f14-488d-b68f-9e155a7ed278
--   agent_name = 'baseline', generation_method = 'seed', generation = 0
--   elo_score ≈ 1104.6, arena_match_count = 21
--
-- Geometric-cost model:
--   p = empirical fraction of rewrites whose child.elo_score > 1287
--   N_needed = ⌈ln(0.25) / ln(1 - p)⌉      (smallest N so 1 - (1-p)^N ≥ 0.75)
--   total_cost = N_needed × avg(cost_usd)
-- Agents with p = 0 yield N_needed = NULL (unreachable at any N).

-- =========================================================================
-- Q1 — Confirm canonical seed identity and Elo.
-- =========================================================================
SELECT id,
       agent_name,
       generation,
       generation_method,
       round(elo_score::numeric, 1)         AS elo_score,
       arena_match_count,
       length(variant_content)              AS content_chars,
       created_at
FROM evolution_variants
WHERE id = '26ab2327-6f14-488d-b68f-9e155a7ed278';

-- =========================================================================
-- Q2 — Aggregate (all-agents pooled) probability and geometric cost,
-- starting from the canonical seed.
-- =========================================================================
WITH children AS (
  SELECT v.elo_score AS child_elo, v.agent_name, i.cost_usd
  FROM evolution_variants v
  JOIN evolution_agent_invocations i ON i.id = v.agent_invocation_id
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article'
    AND v.parent_variant_ids[1] = '26ab2327-6f14-488d-b68f-9e155a7ed278'
    AND i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT 'ALL (from seed 26ab2327)' AS slice,
       count(*)                                                                          AS n,
       count(*) FILTER (WHERE child_elo > 1287)                                          AS n_p90,
       round((100.0*count(*) FILTER (WHERE child_elo > 1287)/count(*))::numeric, 2)      AS p90_rate_pct,
       round(avg(cost_usd)::numeric, 5)                                                  AS cost_per_invocation,
       CASE WHEN count(*) FILTER (WHERE child_elo > 1287) = 0
            THEN NULL
            ELSE ceil(ln(0.25)/ln(1 - count(*) FILTER (WHERE child_elo > 1287)::float/count(*)))
       END                                                                               AS n_needed_for_75pct,
       CASE WHEN count(*) FILTER (WHERE child_elo > 1287) = 0
            THEN NULL
            ELSE round((avg(cost_usd) * ceil(ln(0.25)/ln(1 - count(*) FILTER (WHERE child_elo > 1287)::float/count(*))))::numeric, 4)
       END                                                                               AS cost_for_75pct
FROM children;

-- =========================================================================
-- Q3 — Per-agent probability and geometric cost from the seed.
-- HAVING n ≥ 5 filters out single-sample agents.
-- =========================================================================
WITH children AS (
  SELECT v.elo_score AS child_elo, v.agent_name, i.cost_usd
  FROM evolution_variants v
  JOIN evolution_agent_invocations i ON i.id = v.agent_invocation_id
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article'
    AND v.parent_variant_ids[1] = '26ab2327-6f14-488d-b68f-9e155a7ed278'
    AND i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT agent_name,
       count(*)                                                                          AS n,
       count(*) FILTER (WHERE child_elo > 1287)                                          AS n_p90,
       round((100.0*count(*) FILTER (WHERE child_elo > 1287)/count(*))::numeric, 2)      AS p90_rate_pct,
       round(avg(cost_usd)::numeric, 5)                                                  AS cost_per_invocation,
       CASE WHEN count(*) FILTER (WHERE child_elo > 1287) = 0
            THEN NULL
            ELSE ceil(ln(0.25)/ln(1 - count(*) FILTER (WHERE child_elo > 1287)::float/count(*)))
       END                                                                               AS n_needed_for_75pct,
       CASE WHEN count(*) FILTER (WHERE child_elo > 1287) = 0
            THEN NULL
            ELSE round((avg(cost_usd) * ceil(ln(0.25)/ln(1 - count(*) FILTER (WHERE child_elo > 1287)::float/count(*))))::numeric, 4)
       END                                                                               AS cost_for_75pct
FROM children
GROUP BY agent_name
HAVING count(*) >= 5
ORDER BY p90_rate_pct DESC NULLS LAST;
