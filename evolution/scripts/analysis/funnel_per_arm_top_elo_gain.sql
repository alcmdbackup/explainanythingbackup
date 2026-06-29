-- funnel_per_arm_top_elo_gain.sql
-- Per-arm: top final elo_score minus seed elo_score (synced variants only).
-- Consumed by /run_experiment_analysis Step 2 (Table A — Test-vs-Control Metrics).
--
-- Definitions:
--   "top"   = max(elo_score) WHERE synced_to_arena = true
--   "seed"  = max(elo_score) WHERE generation = 0 AND synced_to_arena = true
--   gain    = top - seed (per run, then aggregated to median per arm)
--
-- Reports per-arm: median + min + max + n_runs to surface the spread, not just
-- a point estimate (per the Implicit Rubric Weights priming-study pattern).

WITH per_run_gain AS (
  SELECT
    r.strategy_id,
    r.id AS run_id,
    (SELECT MAX(elo_score) FROM evolution_variants v
       WHERE v.run_id = r.id AND v.synced_to_arena) AS top_elo,
    (SELECT MAX(elo_score) FROM evolution_variants v
       WHERE v.run_id = r.id AND v.synced_to_arena AND v.generation = 0) AS seed_elo
  FROM evolution_runs r
  WHERE r.experiment_id = $experiment_id::uuid
    AND r.status IN ('completed', 'failed')
)
SELECT
  s.id AS strategy_id,
  s.name AS arm,
  COUNT(top_elo) AS n_runs_with_variants,
  ROUND(MIN(top_elo - seed_elo)::numeric, 2) AS min_gain,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY top_elo - seed_elo)::numeric, 2) AS median_gain,
  ROUND(MAX(top_elo - seed_elo)::numeric, 2) AS max_gain
FROM per_run_gain
JOIN evolution_strategies s ON s.id = per_run_gain.strategy_id
WHERE top_elo IS NOT NULL AND seed_elo IS NOT NULL
GROUP BY s.id, s.name
ORDER BY s.name;
