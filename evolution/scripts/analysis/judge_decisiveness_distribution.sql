-- judge_decisiveness_distribution.sql
-- Full confidence-bucket distribution per arm from evolution_arena_comparisons.
-- Consumed by /run_experiment_analysis Step 5 (Decisiveness Audit).
--
-- Standard buckets from prior judge-agreement analyses
-- (docs/analysis/judge_agreement_summary_tables.md):
--   confidence == 1.0  → both passes agreed strongly
--   confidence == 0.7  → both passes agreed but not strongly
--   confidence == 0.5  → forced TIE (2-pass disagreement)
--   confidence == 0.3  → weak agreement / partial signal
--   confidence == 0.0  → no signal (judges abstained)
--
-- Skill reports per arm: bucket counts + total + decisive % (≥0.6 threshold).

SELECT
  r.strategy_id,
  s.name AS arm,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE c.confidence = 1.0) AS bucket_1_0,
  COUNT(*) FILTER (WHERE c.confidence = 0.7) AS bucket_0_7,
  COUNT(*) FILTER (WHERE c.confidence = 0.5) AS bucket_0_5_tie,
  COUNT(*) FILTER (WHERE c.confidence = 0.3) AS bucket_0_3,
  COUNT(*) FILTER (WHERE c.confidence = 0.0) AS bucket_0_0,
  COUNT(*) FILTER (
    WHERE c.confidence NOT IN (0.0, 0.3, 0.5, 0.7, 1.0)
  ) AS bucket_other,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE c.confidence >= 0.6 AND c.winner IN ('a', 'b'))
    / NULLIF(COUNT(*), 0),
    1
  ) AS decisive_pct
FROM evolution_runs r
JOIN evolution_strategies s ON s.id = r.strategy_id
JOIN evolution_variants v ON v.run_id = r.id
JOIN evolution_arena_comparisons c ON c.entry_a = v.id
WHERE r.experiment_id = $experiment_id::uuid
  AND r.status IN ('completed', 'failed')
  AND c.status = 'completed'
GROUP BY r.strategy_id, s.name
ORDER BY s.name;
