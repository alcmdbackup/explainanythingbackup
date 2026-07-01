-- All queries used for the Self-Critique Agent Performance analysis.
-- Run against: staging DB (project ref ifubinffdbyewoezcidz) via `npm run query:staging`.
-- All queries are read-only (SELECT). The DB-enforced `readonly_local` role rejects writes.
-- Experiment ID: bc10c2e0-a51c-41a8-a2c3-34577a1fa489
-- Arena prompt ID: 6f5c85e5-0d6f-42f3-ba91-cbf2377f2317
-- Seed anchor variant: 92987346-b211-449b-9b2b-127feec89b7c (recompute Elo 1175.9; live-DB Elo ~1191)

-- =====================================================================
-- PRIMARY DV RECOMPUTE + SIGNIFICANCE (analyzeEloAgentComparison_20260626.ts)
-- =====================================================================
-- Not a SQL query — the analyzer replays evolution_arena_comparisons
-- deterministically through OpenSkill to produce per-arm P(best), Δ vs generate,
-- Holm-corrected p-values, and the max-Elo-lift-per-run primary DV.
--
-- Invocation:
--   npx tsx evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts \
--     --experiment-id bc10c2e0-a51c-41a8-a2c3-34577a1fa489 \
--     --prompt-id 6f5c85e5-0d6f-42f3-ba91-cbf2377f2317 \
--     --baseline generate \
--     --threshold 40
--
-- Bootstrap protocol (from evolution/src/lib/metrics/abComparison.ts):
--   - 10,000 resamples per contrast
--   - Resample unit: per-run max-Elo-lift (10 values per arm)
--   - Seed: createSeededRng(experiment_id)
--   - CI: 95% two-sided percentile [2.5%, 97.5%]
--   - Significance p-value: one-sided (alternative: arm > baseline)

-- =====================================================================
-- 1. FUNNEL: per-arm variant counts by iteration (evolution/scripts/analysis/funnel_per_arm_variants.sql)
-- =====================================================================
SELECT
  r.strategy_id,
  s.name AS arm,
  COALESCE(v.generation, -1) AS iteration,
  COUNT(v.id) AS variants_produced,
  COUNT(v.id) FILTER (WHERE v.synced_to_arena) AS variants_synced
FROM evolution_runs r
JOIN evolution_strategies s ON s.id = r.strategy_id
LEFT JOIN evolution_variants v ON v.run_id = r.id
WHERE r.experiment_id = 'bc10c2e0-a51c-41a8-a2c3-34577a1fa489'::uuid
  AND r.status IN ('completed', 'failed')
GROUP BY r.strategy_id, s.name, COALESCE(v.generation, -1)
ORDER BY s.name, iteration;

-- =====================================================================
-- 2. FUNNEL: per-arm invocation outcomes (evolution/scripts/analysis/funnel_per_arm_invocations.sql)
-- =====================================================================
SELECT
  r.strategy_id,
  s.name AS arm,
  i.agent_name,
  i.iteration,
  COUNT(*) AS invocations_total,
  COUNT(*) FILTER (WHERE i.success) AS invocations_success,
  COUNT(*) FILTER (WHERE NOT i.success AND i.error_message IS NOT NULL) AS invocations_failed,
  COUNT(*) FILTER (WHERE i.skipped) AS invocations_skipped
FROM evolution_runs r
JOIN evolution_strategies s ON s.id = r.strategy_id
LEFT JOIN evolution_agent_invocations i ON i.run_id = r.id
WHERE r.experiment_id = 'bc10c2e0-a51c-41a8-a2c3-34577a1fa489'::uuid
  AND r.status IN ('completed', 'failed')
GROUP BY r.strategy_id, s.name, i.agent_name, i.iteration
ORDER BY s.name, i.agent_name, i.iteration;

-- =====================================================================
-- 3. FUNNEL: per-arm decisive-match count (evolution/scripts/analysis/funnel_per_arm_decisive_matches.sql)
-- =====================================================================
-- Decisive threshold = 0.6 (DECISIVE_CONFIDENCE_THRESHOLD in evolution/src/lib/shared/rating.ts).
SELECT
  r.strategy_id,
  s.name AS arm,
  COUNT(*) AS matches_total,
  COUNT(*) FILTER (WHERE c.confidence >= 0.6 AND c.winner IN ('a', 'b')) AS matches_decisive,
  COUNT(*) FILTER (WHERE c.winner = 'draw') AS matches_draw,
  COUNT(*) FILTER (WHERE c.confidence < 0.6 AND c.winner IN ('a', 'b')) AS matches_low_confidence,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE c.confidence >= 0.6 AND c.winner IN ('a', 'b'))
    / NULLIF(COUNT(*), 0),
    1
  ) AS decisive_pct
FROM evolution_runs r
JOIN evolution_strategies s ON s.id = r.strategy_id
JOIN evolution_variants v ON v.run_id = r.id
JOIN evolution_arena_comparisons c ON c.entry_a = v.id
WHERE r.experiment_id = 'bc10c2e0-a51c-41a8-a2c3-34577a1fa489'::uuid
  AND r.status IN ('completed', 'failed')
  AND c.status = 'completed'
GROUP BY r.strategy_id, s.name
ORDER BY s.name;

-- =====================================================================
-- 4. FUNNEL: per-arm top Elo gain (evolution/scripts/analysis/funnel_per_arm_top_elo_gain.sql)
-- Note: for arms without gen=0 variants, seed_elo comes from arena anchor.
-- =====================================================================
WITH per_run_gain AS (
  SELECT
    r.strategy_id,
    r.id AS run_id,
    (SELECT MAX(elo_score) FROM evolution_variants v
       WHERE v.run_id = r.id AND v.synced_to_arena) AS top_elo,
    (SELECT MAX(elo_score) FROM evolution_variants v
       WHERE v.run_id = r.id AND v.synced_to_arena AND v.generation = 0) AS seed_elo
  FROM evolution_runs r
  WHERE r.experiment_id = 'bc10c2e0-a51c-41a8-a2c3-34577a1fa489'::uuid
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

-- =====================================================================
-- 5. NEW (added 2026-07-01): per-arm median + mean Elo delta per invocation
-- evolution/scripts/analysis/per_arm_median_delta_per_invocation.sql
-- Reveals distribution SKEW: median ≈ mean = tight; median > mean = LEFT skew (high-variance
-- ceiling); median < mean = RIGHT skew (reliability at run level not invocation level).
-- =====================================================================
WITH seed_anchor AS (
  SELECT MAX(v.elo_score) AS seed_elo
  FROM evolution_variants v
  JOIN evolution_runs r ON r.experiment_id = 'bc10c2e0-a51c-41a8-a2c3-34577a1fa489'::uuid
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
  WHERE r.experiment_id = 'bc10c2e0-a51c-41a8-a2c3-34577a1fa489'::uuid
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

-- =====================================================================
-- 6. JUDGE DECISIVENESS DISTRIBUTION (evolution/scripts/analysis/judge_decisiveness_distribution.sql)
-- Bucket breakdown across confidence levels {1.0, 0.7, 0.5-TIE, 0.3, 0.0}.
-- =====================================================================
-- (See full query at evolution/scripts/analysis/judge_decisiveness_distribution.sql;
--  reproduces the decisive_pct column with per-bucket counts.)

-- =====================================================================
-- 7. PER-ARM COST BREAKDOWN (evolution/scripts/analysis/per_arm_cost_breakdown.sql)
-- =====================================================================
-- (See full query at evolution/scripts/analysis/per_arm_cost_breakdown.sql;
--  computes total_cost_usd + per-agent split + cost_per_improver.)

-- =====================================================================
-- WIPEOUT HARD GATE (Step 3 of /run_experiment_analysis)
-- =====================================================================
-- Not a SQL query — invoked as CLI:
--   npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts \
--     --experiment-id bc10c2e0-a51c-41a8-a2c3-34577a1fa489 --json
--
-- Baseline (pre-append): count=0
-- Post-tranche: count=0
-- Delta on new self_critique run IDs: 0 (all 10 new runs healthy)

-- =====================================================================
-- CAUSAL EVIDENCE — parseError sampling
-- =====================================================================
-- Fetch 2 self_critique parseError invocations for Finding 7 causal evidence.
SELECT
  id AS inv_id,
  substr(execution_detail->'reflection'->>'parseError', 1, 100) AS parse_err,
  substr(execution_detail->'reflection'->>'rawResponse', 1, 250) AS raw_preview
FROM evolution_agent_invocations
WHERE run_id IN (
    SELECT id FROM evolution_runs
    WHERE experiment_id = 'bc10c2e0-a51c-41a8-a2c3-34577a1fa489'
      AND strategy_id = '6c7f7349-a4f1-421e-9999-0c063f4b1e60'
  )
  AND agent_name = 'self_critique_revise'
  AND execution_detail->'reflection'->>'parseError' IS NOT NULL
LIMIT 2;

-- =====================================================================
-- CAUSAL EVIDENCE — per-run best Elo (100% reliability floor claim)
-- =====================================================================
SELECT
  r.id AS run_id,
  MAX(v.elo_score)::numeric(10,1) AS best_elo,
  COUNT(v.id) FILTER (WHERE v.synced_to_arena = true) AS n_synced
FROM evolution_runs r
JOIN evolution_variants v ON v.run_id = r.id
WHERE r.experiment_id = 'bc10c2e0-a51c-41a8-a2c3-34577a1fa489'
  AND r.strategy_id = '6c7f7349-a4f1-421e-9999-0c063f4b1e60'
  AND v.variant_kind = 'article'
GROUP BY r.id
ORDER BY best_elo DESC;

-- =====================================================================
-- CAUSAL EVIDENCE — changeKind clustering + plan diversity
-- =====================================================================
SELECT
  id,
  substr(execution_detail->'reflection'->>'changeKind', 1, 60) AS ck,
  substr(execution_detail->'reflection'->>'plan', 1, 200) AS plan_preview
FROM evolution_agent_invocations
WHERE run_id IN (
    '9810c8fb-6b1a-4b54-bcc6-6e5e51429378',
    'dc1a8ac5-8f72-4e56-9987-eb1c510bc1d5'
  )
  AND agent_name = 'self_critique_revise'
  AND execution_detail->'reflection'->>'changeKind' LIKE '%Mode shift%'
ORDER BY id
LIMIT 5;
