-- per_arm_cost_breakdown.sql
-- Per-arm total cost + per-agent split + cost-per-improver.
-- Consumed by /run_experiment_analysis Step 2 (Table A — Test-vs-Control Metrics).
--
-- DEFINITIONS:
--   improver = synced variant with elo_score > parent.elo_score
--              (positive Elo delta vs its direct parent via parent_variant_ids[0])
--   cost-per-improver = total_cost_usd / improver_count   (NULL when no improvers)

WITH parent_join AS (
  SELECT
    r.strategy_id,
    v.id AS variant_id,
    v.elo_score AS variant_elo,
    p.elo_score AS parent_elo,
    v.synced_to_arena
  FROM evolution_runs r
  JOIN evolution_variants v ON v.run_id = r.id
  LEFT JOIN evolution_variants p
    ON p.id = (v.parent_variant_ids[1])  -- Postgres arrays are 1-indexed
  WHERE r.experiment_id = $experiment_id::uuid
    AND r.status IN ('completed', 'failed')
),
improvers AS (
  SELECT
    strategy_id,
    COUNT(*) FILTER (
      WHERE synced_to_arena
        AND parent_elo IS NOT NULL
        AND variant_elo > parent_elo
    ) AS improver_count
  FROM parent_join
  GROUP BY strategy_id
),
costs AS (
  SELECT
    r.strategy_id,
    SUM(i.cost_usd) AS total_cost,
    SUM(i.cost_usd) FILTER (WHERE i.agent_name LIKE 'generate%') AS cost_generation,
    SUM(i.cost_usd) FILTER (WHERE i.agent_name = 'ranking') AS cost_ranking,
    SUM(i.cost_usd) FILTER (
      WHERE i.agent_name NOT LIKE 'generate%' AND i.agent_name != 'ranking'
    ) AS cost_other
  FROM evolution_runs r
  JOIN evolution_agent_invocations i ON i.run_id = r.id
  WHERE r.experiment_id = $experiment_id::uuid
    AND r.status IN ('completed', 'failed')
  GROUP BY r.strategy_id
)
SELECT
  s.id AS strategy_id,
  s.name AS arm,
  ROUND(c.total_cost::numeric, 4) AS total_cost_usd,
  ROUND(c.cost_generation::numeric, 4) AS cost_generation_usd,
  ROUND(c.cost_ranking::numeric, 4) AS cost_ranking_usd,
  ROUND(c.cost_other::numeric, 4) AS cost_other_usd,
  COALESCE(imp.improver_count, 0) AS improver_count,
  CASE
    WHEN COALESCE(imp.improver_count, 0) = 0 THEN NULL
    ELSE ROUND((c.total_cost / imp.improver_count)::numeric, 4)
  END AS cost_per_improver_usd
FROM evolution_strategies s
LEFT JOIN costs c ON c.strategy_id = s.id
LEFT JOIN improvers imp ON imp.strategy_id = s.id
WHERE s.id IN (SELECT strategy_id FROM costs)
ORDER BY s.name;
