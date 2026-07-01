-- Per-arm median + mean Elo delta per invocation (variant Elo - seed_anchor Elo).
-- Consumed by /run_experiment_analysis Step 2 (Table A — Test-vs-Control Metrics summary).
--
-- DEFINITIONS:
--   ranked variants = article variants (variant_kind='article') with arena_match_count >= 1.
--     Paragraph slot variants excluded; unranked (0-match) variants excluded.
--   Δ/inv = variant_elo - seed_anchor_elo (per ranked variant).
--   med Δ/inv = median of Δ/inv across an arm's ranked variants (throughput-unbiased per-variant quality density).
--   mean Δ/inv = arithmetic mean for cross-check; median-vs-mean divergence reveals distribution SKEW.
--     - median ≈ mean → tight/near-normal distribution (e.g. reflect_and_generate: consistent per-variant quality).
--     - median > mean → LEFT-skewed distribution (few low-Elo outliers drag the mean down; typical variant is good).
--     - median < mean → RIGHT-skewed distribution (few high-Elo outliers pull the mean up; typical variant is modest).
--   These patterns explain WHY the max-lift ceiling can rank arms differently from per-variant density.
--
-- The `seed_anchor` variant is the pinned pipeline-anchor row in the arena for the experiment's prompt
-- (generation_method='pipeline', run_id IS NULL, synced_to_arena=true). Its Elo is captured once at query
-- time so we don't join to every variant row.
--
-- Parameter: $experiment_id (UUID, validated by Step 1 pre-flight gate).
WITH seed_anchor AS (
  SELECT MAX(v.elo_score) AS seed_elo
  FROM evolution_variants v
  JOIN evolution_runs r ON r.experiment_id = $experiment_id::uuid
  JOIN evolution_prompts p ON p.id = r.prompt_id
  WHERE v.prompt_id = p.id
    AND v.generation_method = 'pipeline'
    AND v.run_id IS NULL
    AND v.synced_to_arena = true
),
ranked_variants AS (
  SELECT
    s.id AS strategy_id,
    s.name AS arm,
    v.elo_score - (SELECT seed_elo FROM seed_anchor) AS delta
  FROM evolution_runs r
  JOIN evolution_strategies s ON s.id = r.strategy_id
  JOIN evolution_variants v ON v.run_id = r.id
  WHERE r.experiment_id = $experiment_id::uuid
    AND r.status IN ('completed', 'failed')
    AND v.variant_kind = 'article'
    AND v.arena_match_count >= 1
    AND v.synced_to_arena = true
)
SELECT
  strategy_id,
  arm,
  COUNT(*) AS n_ranked_variants,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delta)::numeric, 1) AS med_delta_per_inv,
  ROUND(AVG(delta)::numeric, 1) AS mean_delta_per_inv,
  ROUND((AVG(delta) - PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY delta))::numeric, 1) AS mean_minus_median
FROM ranked_variants
GROUP BY strategy_id, arm
ORDER BY med_delta_per_inv DESC;
