-- Rewrite success rate above top-10 % and top-5 % parent cutoffs for federal_reserve_2,
-- with cost-per-invocation and cost-per-improved-variant added.
-- Run against staging Supabase (`readonly_local` role) via:
--   npm run query:staging -- --json "<query>"
--
-- Prompt: federal_reserve_2 (staging only)
--   id   = a546b7e9-f066-403d-9589-f5e0d2c9fa4f
--   name = 'Federal Reserve 2'
--
-- Cutoffs (from the companion analysis arena-elo-distribution-federal-reserve-2-20260617):
--   top 10 % parent Elo ≥ 1287 (p90)
--   top 5 %  parent Elo ≥ 1319 (ventile-20 floor)
--
-- Population per agent_name, per cutoff:
--   children = arena variants with a pipeline parent (generation > 0,
--     parent_variant_ids non-empty), synced_to_arena, not archived,
--     variant_kind='article', AND agent_invocation_id NOT NULL — same shape as the
--     decay-curve analysis with the additional join to evolution_agent_invocations
--     for cost_usd. Sample sizes are unchanged (227 / 133) because every qualifying
--     rewrite has an invocation row with positive cost_usd.
--   delta              = child.elo_score - parent.elo_score
--   improver           = delta > 0
--   success_pct        = 100 * improvers / attempts
--   cost_per_invocation = avg(i.cost_usd)               — column A
--   total_cost          = sum(i.cost_usd)
--   cost_per_improver   = sum(i.cost_usd) / NULLIF(n_improvers, 0)  — column B

-- =========================================================================
-- Q1 — Aggregate (all-agents pooled) at each cutoff, including cost.
-- =========================================================================
WITH children AS (
  SELECT v.elo_score AS child_elo, v.parent_variant_ids[1] AS parent_id, v.agent_invocation_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article' AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL AND cardinality(v.parent_variant_ids) > 0
    AND v.agent_invocation_id IS NOT NULL
),
pairs AS (
  SELECT c.child_elo - p.elo_score AS delta, p.elo_score AS parent_elo, i.cost_usd
  FROM children c
  JOIN evolution_variants p ON p.id = c.parent_id
  JOIN evolution_agent_invocations i ON i.id = c.agent_invocation_id
  WHERE i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT 'top 10% (parent Elo >= 1287)' AS tier,
       count(*) AS n_attempts,
       count(*) FILTER (WHERE delta > 0) AS n_improvers,
       round((100.0*count(*) FILTER (WHERE delta > 0)/count(*))::numeric,1) AS improver_pct,
       round(avg(delta)::numeric,1) AS avg_delta,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY delta))::numeric,1) AS median_delta,
       round(avg(delta) FILTER (WHERE delta > 0)::numeric,1) AS avg_delta_up,
       round(avg(delta) FILTER (WHERE delta < 0)::numeric,1) AS avg_delta_down,
       round(max(delta)::numeric,1) AS max_delta,
       round(avg(cost_usd)::numeric,5) AS cost_per_invocation,
       round(sum(cost_usd)::numeric,4) AS total_cost,
       round((sum(cost_usd)/NULLIF(count(*) FILTER (WHERE delta > 0),0))::numeric,4) AS cost_per_improver
FROM pairs WHERE parent_elo >= 1287
UNION ALL
SELECT 'top 5% (parent Elo >= 1319)',
       count(*), count(*) FILTER (WHERE delta > 0),
       round((100.0*count(*) FILTER (WHERE delta > 0)/NULLIF(count(*),0))::numeric,1),
       round(avg(delta)::numeric,1),
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY delta))::numeric,1),
       round(avg(delta) FILTER (WHERE delta > 0)::numeric,1),
       round(avg(delta) FILTER (WHERE delta < 0)::numeric,1),
       round(max(delta)::numeric,1),
       round(avg(cost_usd)::numeric,5),
       round(sum(cost_usd)::numeric,4),
       round((sum(cost_usd)/NULLIF(count(*) FILTER (WHERE delta > 0),0))::numeric,4)
FROM pairs WHERE parent_elo >= 1319;

-- =========================================================================
-- Q2 — Per-agent breakdown at parent Elo ≥ 1287 (top 10 %), with cost.
-- =========================================================================
WITH children AS (
  SELECT v.elo_score AS child_elo, v.parent_variant_ids[1] AS parent_id, v.agent_name, v.agent_invocation_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article' AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL AND cardinality(v.parent_variant_ids) > 0
    AND v.agent_invocation_id IS NOT NULL
),
pairs AS (
  SELECT c.agent_name, c.child_elo - p.elo_score AS delta, p.elo_score AS parent_elo, i.cost_usd
  FROM children c
  JOIN evolution_variants p ON p.id = c.parent_id
  JOIN evolution_agent_invocations i ON i.id = c.agent_invocation_id
  WHERE p.elo_score >= 1287 AND i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT agent_name,
       count(*) AS n,
       count(*) FILTER (WHERE delta > 0) AS n_imp,
       round((100.0*count(*) FILTER (WHERE delta > 0)/count(*))::numeric,1) AS pct,
       round(avg(delta)::numeric,1) AS avg_d,
       round(max(delta)::numeric,1) AS max_d,
       round(avg(cost_usd)::numeric,5) AS cost_per_inv,
       round(sum(cost_usd)::numeric,4) AS total_cost,
       round((sum(cost_usd)/NULLIF(count(*) FILTER (WHERE delta > 0),0))::numeric,4) AS cost_per_improver
FROM pairs GROUP BY agent_name ORDER BY pct DESC NULLS LAST, n_imp DESC;

-- =========================================================================
-- Q3 — Per-agent breakdown at parent Elo ≥ 1319 (top 5 %), with cost.
-- =========================================================================
WITH children AS (
  SELECT v.elo_score AS child_elo, v.parent_variant_ids[1] AS parent_id, v.agent_name, v.agent_invocation_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true AND v.archived_at IS NULL
    AND v.variant_kind='article' AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL AND cardinality(v.parent_variant_ids) > 0
    AND v.agent_invocation_id IS NOT NULL
),
pairs AS (
  SELECT c.agent_name, c.child_elo - p.elo_score AS delta, p.elo_score AS parent_elo, i.cost_usd
  FROM children c
  JOIN evolution_variants p ON p.id = c.parent_id
  JOIN evolution_agent_invocations i ON i.id = c.agent_invocation_id
  WHERE p.elo_score >= 1319 AND i.cost_usd IS NOT NULL AND i.cost_usd > 0
)
SELECT agent_name,
       count(*) AS n,
       count(*) FILTER (WHERE delta > 0) AS n_imp,
       round((100.0*count(*) FILTER (WHERE delta > 0)/count(*))::numeric,1) AS pct,
       round(avg(delta)::numeric,1) AS avg_d,
       round(max(delta)::numeric,1) AS max_d,
       round(avg(cost_usd)::numeric,5) AS cost_per_inv,
       round(sum(cost_usd)::numeric,4) AS total_cost,
       round((sum(cost_usd)/NULLIF(count(*) FILTER (WHERE delta > 0),0))::numeric,4) AS cost_per_improver
FROM pairs GROUP BY agent_name ORDER BY pct DESC NULLS LAST, n_imp DESC;
