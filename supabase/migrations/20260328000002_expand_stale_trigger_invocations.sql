-- Expand mark_elo_metrics_stale() to also invalidate invocation-level elo metrics
-- (best_variant_elo, avg_variant_elo) when a variant's mu/sigma changes.

CREATE OR REPLACE FUNCTION mark_elo_metrics_stale()
RETURNS TRIGGER AS $$
DECLARE
  v_strategy_id UUID;
  v_experiment_id UUID;
BEGIN
  IF (NEW.mu IS DISTINCT FROM OLD.mu OR NEW.sigma IS DISTINCT FROM OLD.sigma)
     AND EXISTS (SELECT 1 FROM evolution_runs WHERE id = NEW.run_id AND status = 'completed')
  THEN
    -- Mark ALL run-level finalization metrics stale
    UPDATE evolution_metrics SET stale = true, updated_at = now()
    WHERE entity_type = 'run' AND entity_id = NEW.run_id
      AND metric_name IN ('winner_elo', 'median_elo', 'p90_elo', 'max_elo',
                          'total_matches', 'decisive_rate', 'variant_count');

    -- Mark invocation-level elo metrics stale for invocations in this run
    UPDATE evolution_metrics SET stale = true, updated_at = now()
    WHERE entity_type = 'invocation'
      AND entity_id IN (SELECT id FROM evolution_agent_invocations WHERE run_id = NEW.run_id)
      AND metric_name IN ('best_variant_elo', 'avg_variant_elo');

    SELECT strategy_id, experiment_id INTO v_strategy_id, v_experiment_id
    FROM evolution_runs WHERE id = NEW.run_id;

    IF v_strategy_id IS NOT NULL THEN
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'strategy' AND entity_id = v_strategy_id
        AND metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
          'avg_median_elo', 'avg_p90_elo', 'best_max_elo',
          'total_matches', 'avg_matches_per_run', 'avg_decisive_rate',
          'total_variant_count', 'avg_variant_count', 'run_count', 'total_cost', 'avg_cost_per_run');
    END IF;

    IF v_experiment_id IS NOT NULL THEN
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'experiment' AND entity_id = v_experiment_id
        AND metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
          'avg_median_elo', 'avg_p90_elo', 'best_max_elo',
          'total_matches', 'avg_matches_per_run', 'avg_decisive_rate',
          'total_variant_count', 'avg_variant_count', 'run_count', 'total_cost', 'avg_cost_per_run');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
