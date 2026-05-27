-- Extend mark_elo_metrics_stale() to invalidate criteria-level metrics on
-- variant rating changes. When arena matches re-rate a variant whose
-- weakest_criteria_ids array references a criteria, that criteria's
-- aggregates (avg_elo_delta_when_focused, etc.) become stale and must be
-- recomputed on next read.
--
-- Replaces the function from 20260418000004 which already handles run /
-- invocation / strategy / experiment cascades for elo + eloAttrDelta:* +
-- eloAttrDeltaHist:* metrics. This version adds the entity_type='criteria'
-- cascade keyed on weakest_criteria_ids @> ARRAY[criteria_id].

BEGIN;

SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION mark_elo_metrics_stale()
RETURNS TRIGGER AS $$
DECLARE
  v_strategy_id UUID;
  v_experiment_id UUID;
BEGIN
  IF (NEW.mu IS DISTINCT FROM OLD.mu OR NEW.sigma IS DISTINCT FROM OLD.sigma)
     AND EXISTS (SELECT 1 FROM evolution_runs WHERE id = NEW.run_id AND status = 'completed')
  THEN
    -- Run-level finalization metrics (static + dynamic eloAttrDelta/eloAttrDeltaHist).
    UPDATE evolution_metrics SET stale = true, updated_at = now()
    WHERE entity_type = 'run' AND entity_id = NEW.run_id
      AND (
        metric_name IN ('winner_elo', 'median_elo', 'p90_elo', 'max_elo',
                        'total_matches', 'decisive_rate', 'variant_count')
        OR metric_name LIKE 'eloAttrDelta:%'
        OR metric_name LIKE 'eloAttrDeltaHist:%'
      );

    -- Invocation-level elo metrics (best/avg variant elo + per-invocation delta).
    UPDATE evolution_metrics SET stale = true, updated_at = now()
    WHERE entity_type = 'invocation'
      AND entity_id IN (SELECT id FROM evolution_agent_invocations WHERE run_id = NEW.run_id)
      AND metric_name IN ('best_variant_elo', 'avg_variant_elo', 'elo_delta_vs_parent');

    SELECT strategy_id, experiment_id INTO v_strategy_id, v_experiment_id
    FROM evolution_runs WHERE id = NEW.run_id;

    IF v_strategy_id IS NOT NULL THEN
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'strategy' AND entity_id = v_strategy_id
        AND (
          metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
            'avg_median_elo', 'avg_p90_elo', 'best_max_elo',
            'total_matches', 'avg_matches_per_run', 'avg_decisive_rate',
            'total_variant_count', 'avg_variant_count', 'run_count', 'total_cost', 'avg_cost_per_run')
          OR metric_name LIKE 'eloAttrDelta:%'
          OR metric_name LIKE 'eloAttrDeltaHist:%'
        );
    END IF;

    IF v_experiment_id IS NOT NULL THEN
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'experiment' AND entity_id = v_experiment_id
        AND (
          metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
            'avg_median_elo', 'avg_p90_elo', 'best_max_elo',
            'total_matches', 'avg_matches_per_run', 'avg_decisive_rate',
            'total_variant_count', 'avg_variant_count', 'run_count', 'total_cost', 'avg_cost_per_run')
          OR metric_name LIKE 'eloAttrDelta:%'
          OR metric_name LIKE 'eloAttrDeltaHist:%'
        );
    END IF;

    -- Criteria-level metrics: cascade staleness to every criteria that this
    -- variant focused on (weakest_criteria_ids array elements). Only fires
    -- when the variant has criteria-driven generation lineage.
    IF NEW.weakest_criteria_ids IS NOT NULL AND array_length(NEW.weakest_criteria_ids, 1) > 0 THEN
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'criteria'
        AND entity_id = ANY(NEW.weakest_criteria_ids)
        AND metric_name IN (
          'avg_score', 'frequency_as_weakest', 'total_variants_focused',
          'avg_elo_delta_when_focused', 'run_count'
        );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
