-- funnel_per_arm_variants.sql
-- Per-arm variant counts by iteration, with synced-to-arena split.
-- Consumed by /run_experiment_analysis Step 2 (funnel/balance audit).
--
-- Parameter: $experiment_id (UUID, validated by Step 1 pre-flight gate).
-- Filter convention (Phase 3): r.status IN ('completed', 'failed') — failed runs
--   with error_code='all_generations_failed' (post-D3 wipeouts) must be visible
--   in funnel counts so the downstream Balance Audit can surface them.
-- Bug-fix from plan-review iter 1: COUNT(v.id) not COUNT(*) + COALESCE on
--   generation, because LEFT JOIN on a zero-variant run otherwise inflates
--   variants_produced by 1 (the synthesized NULL row).

SELECT
  r.strategy_id,
  s.name AS arm,
  COALESCE(v.generation, -1) AS iteration,  -- -1 sentinel for runs with zero variants
  COUNT(v.id) AS variants_produced,         -- NOT COUNT(*) — would count LEFT JOIN's null synthesis
  COUNT(v.id) FILTER (WHERE v.synced_to_arena) AS variants_synced
FROM evolution_runs r
JOIN evolution_strategies s ON s.id = r.strategy_id
LEFT JOIN evolution_variants v ON v.run_id = r.id
WHERE r.experiment_id = $experiment_id::uuid
  AND r.status IN ('completed', 'failed')
GROUP BY r.strategy_id, s.name, COALESCE(v.generation, -1)
ORDER BY s.name, iteration;
