-- funnel_per_arm_invocations.sql
-- Per-arm invocation outcomes by agent_name + iteration (success/failed/skipped).
-- Consumed by /run_experiment_analysis Step 2 (funnel/balance audit).
--
-- "Failed" = success=false AND error_message IS NOT NULL (actual error, not a skip).
-- "Skipped" = skipped=true (intentional skip, e.g. budget gate).
-- Together with funnel_per_arm_variants.sql these answer "where in the pipeline
--   did each arm produce vs drop work" — the load-bearing question for catching
--   per-arm balance violations (e.g. the coherence-pass-perf-ab proposer-mode
--   mismatch that flipped 8/15 invocations to clean rewrites instead of edits).

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
WHERE r.experiment_id = $experiment_id::uuid
  AND r.status IN ('completed', 'failed')
GROUP BY r.strategy_id, s.name, i.agent_name, i.iteration
ORDER BY s.name, i.agent_name, i.iteration;
