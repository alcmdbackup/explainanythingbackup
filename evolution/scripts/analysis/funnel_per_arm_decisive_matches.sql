-- funnel_per_arm_decisive_matches.sql
-- Per-arm decisive-match count + tie/draw rate from evolution_arena_comparisons.
-- Consumed by /run_experiment_analysis Step 2 (funnel/balance audit).
--
-- Decisive threshold = 0.6, sourced from DECISIVE_CONFIDENCE_THRESHOLD in
--   evolution/src/lib/shared/rating.ts. A match is decisive iff confidence ≥ 0.6
--   AND winner IN ('a','b'). Anything else (winner='draw' OR low confidence) is
--   a TIE for analysis purposes.
--
-- Per-arm grouping: match's arm = the strategy of the parent run that produced
--   either entry. We attribute by entry_a's run.strategy_id; this approximates
--   "which arm produced the participant" and is fine for balance audit since
--   we're checking experimental BALANCE not match-level outcomes.

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
WHERE r.experiment_id = $experiment_id::uuid
  AND r.status IN ('completed', 'failed')
  AND c.status = 'completed'
GROUP BY r.strategy_id, s.name
ORDER BY s.name;
