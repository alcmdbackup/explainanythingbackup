-- Rewrite efficacy decay curve for federal_reserve_2
-- Run against staging Supabase (`readonly_local` role) via:
--   npm run query:staging -- --json "<query>"
--
-- Prompt: federal_reserve_2 (staging only)
--   id   = a546b7e9-f066-403d-9589-f5e0d2c9fa4f
--   name = 'Federal Reserve 2'
--   prompt_kind = 'article'

-- =========================================================================
-- Q1 — Sanity check: confirm the prompt exists and is the right row.
-- =========================================================================
SELECT id, name, prompt_kind, status, archived_at, created_at
FROM evolution_prompts
WHERE name ILIKE '%federal%reserve%2%';

-- =========================================================================
-- Q2 — Population size: arena variants for this prompt.
-- =========================================================================
SELECT count(*) AS total,
       count(*) FILTER (WHERE archived_at IS NULL) AS active,
       count(*) FILTER (WHERE variant_kind='paragraph') AS paragraph,
       count(*) FILTER (WHERE variant_kind='article') AS article
FROM evolution_variants
WHERE prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
  AND synced_to_arena=true;

-- =========================================================================
-- Q3 — Main decay-curve table (Δ-Elo only; original 2026-06-17 query).
-- Pool: every article variant with a pipeline parent (generation > 0 AND
-- parent_variant_ids non-empty), synced to arena and not archived. Joined to
-- the parent's row to get parent_elo. Bucketed at 50-Elo intervals on
-- parent_elo. Δ = child_elo - parent_elo. Median computed with
-- percentile_cont(0.5).
-- =========================================================================
WITH children AS (
  SELECT v.elo_score          AS child_elo,
         v.parent_variant_ids[1] AS parent_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true
    AND v.archived_at IS NULL
    AND v.variant_kind='article'
    AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL
    AND cardinality(v.parent_variant_ids) > 0
),
pairs AS (
  SELECT c.child_elo,
         p.elo_score                AS parent_elo,
         c.child_elo - p.elo_score  AS delta,
         (floor(p.elo_score/50.0)*50)::int AS bucket
  FROM children c
  JOIN evolution_variants p ON p.id = c.parent_id
)
SELECT bucket                                                                                          AS parent_elo_bucket,
       count(*)                                                                                        AS n_attempts,
       count(*) FILTER (WHERE delta > 0)                                                               AS n_improvers,
       round((100.0 * count(*) FILTER (WHERE delta > 0) / count(*))::numeric, 1)                       AS improver_pct,
       round(avg(delta)::numeric, 1)                                                                   AS avg_delta,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY delta))::numeric, 1)                         AS median_delta,
       round(avg(delta) FILTER (WHERE delta > 0)::numeric, 1)                                          AS avg_delta_when_up,
       round(avg(delta) FILTER (WHERE delta < 0)::numeric, 1)                                          AS avg_delta_when_down,
       round(min(delta)::numeric, 1)                                                                   AS min_delta,
       round(max(delta)::numeric, 1)                                                                   AS max_delta
FROM pairs
GROUP BY bucket
ORDER BY bucket;

-- =========================================================================
-- Q4 — Cost-augmented decay-curve table (added 2026-06-18).
-- Same population as Q3, with a LEFT JOIN to evolution_agent_invocations
-- for cost_usd. The join is LEFT because not every variant has an
-- invocation_id populated (older rows pre-date the FK addition), so n_with_cost
-- can be < n_attempts. Cost aggregates ignore NULL/0 cost rows.
-- =========================================================================
WITH children AS (
  SELECT v.elo_score AS child_elo,
         v.parent_variant_ids[1] AS parent_id,
         v.agent_invocation_id
  FROM evolution_variants v
  WHERE v.prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND v.synced_to_arena=true
    AND v.archived_at IS NULL
    AND v.variant_kind='article'
    AND v.generation > 0
    AND v.parent_variant_ids IS NOT NULL
    AND cardinality(v.parent_variant_ids) > 0
),
pairs AS (
  SELECT c.child_elo,
         p.elo_score                AS parent_elo,
         c.child_elo - p.elo_score  AS delta,
         i.cost_usd                 AS cost,
         (floor(p.elo_score/50.0)*50)::int AS bucket
  FROM children c
  JOIN evolution_variants p ON p.id = c.parent_id
  LEFT JOIN evolution_agent_invocations i ON i.id = c.agent_invocation_id
)
SELECT bucket                                                                                          AS parent_elo_bucket,
       count(*)                                                                                        AS n_attempts,
       count(*) FILTER (WHERE delta > 0)                                                               AS n_improvers,
       round((100.0 * count(*) FILTER (WHERE delta > 0) / count(*))::numeric, 1)                       AS improver_pct,
       round(avg(delta)::numeric, 1)                                                                   AS avg_delta,
       round((percentile_cont(0.5) WITHIN GROUP (ORDER BY delta))::numeric, 1)                         AS median_delta,
       count(*) FILTER (WHERE cost IS NOT NULL AND cost > 0)                                           AS n_with_cost,
       round(avg(cost)::numeric, 5)                                                                    AS cost_per_invocation,
       round(sum(cost)::numeric, 4)                                                                    AS total_cost,
       round((sum(cost)/NULLIF(count(*) FILTER (WHERE delta > 0 AND cost IS NOT NULL AND cost > 0),0))::numeric, 4)
                                                                                                       AS cost_per_improver
FROM pairs
GROUP BY bucket
ORDER BY bucket;
