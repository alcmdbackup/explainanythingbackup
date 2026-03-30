-- Evolution metrics EAV table: standardized storage for all entity metrics with stale-flag recompute.
-- Replaces scattered columns, VIEWs, RPCs, and on-demand computation with a single unified table.

CREATE TABLE evolution_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt', 'arena_topic')),
  entity_id UUID NOT NULL,
  metric_name TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  sigma DOUBLE PRECISION,
  ci_lower DOUBLE PRECISION,
  ci_upper DOUBLE PRECISION,
  n INT DEFAULT 1,
  origin_entity_type TEXT,
  origin_entity_id UUID,
  aggregation_method TEXT,
  source TEXT,
  stale BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(entity_type, entity_id, metric_name)
);

-- Primary access pattern: get all metrics for an entity
CREATE INDEX idx_metrics_entity ON evolution_metrics (entity_type, entity_id);
-- Leaderboard/comparison: get one metric across all entities of a type
CREATE INDEX idx_metrics_type_name ON evolution_metrics (entity_type, metric_name);
-- Cascade staleness: find metrics derived from a source entity
CREATE INDEX idx_metrics_origin ON evolution_metrics (origin_entity_type, origin_entity_id);
-- Recompute queue: find stale metrics
CREATE INDEX idx_metrics_stale ON evolution_metrics (stale) WHERE stale = true;

-- RLS (matches existing evolution table pattern including readonly_local)
ALTER TABLE evolution_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON evolution_metrics FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY readonly_local ON evolution_metrics FOR SELECT USING (true);
REVOKE ALL ON evolution_metrics FROM PUBLIC, anon, authenticated;
GRANT ALL ON evolution_metrics TO service_role;
GRANT SELECT ON evolution_metrics TO authenticated;

-- When a completed run's variant mu OR sigma changes, mark dependent metrics stale
CREATE FUNCTION mark_elo_metrics_stale()
RETURNS TRIGGER AS $$
DECLARE
  v_strategy_id UUID;
  v_experiment_id UUID;
BEGIN
  IF (NEW.mu IS DISTINCT FROM OLD.mu OR NEW.sigma IS DISTINCT FROM OLD.sigma)
     AND EXISTS (SELECT 1 FROM evolution_runs WHERE id = NEW.run_id AND status = 'completed')
  THEN
    -- Mark run-level elo metrics stale
    UPDATE evolution_metrics SET stale = true, updated_at = now()
    WHERE entity_type = 'run' AND entity_id = NEW.run_id
      AND metric_name IN ('winner_elo', 'median_elo', 'p90_elo', 'max_elo');

    -- Mark strategy-level metrics stale
    SELECT strategy_id, experiment_id INTO v_strategy_id, v_experiment_id
    FROM evolution_runs WHERE id = NEW.run_id;

    IF v_strategy_id IS NOT NULL THEN
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'strategy' AND entity_id = v_strategy_id
        AND metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
          'avg_median_elo', 'avg_p90_elo', 'best_max_elo');
    END IF;

    IF v_experiment_id IS NOT NULL THEN
      UPDATE evolution_metrics SET stale = true, updated_at = now()
      WHERE entity_type = 'experiment' AND entity_id = v_experiment_id
        AND metric_name IN ('avg_final_elo', 'best_final_elo', 'worst_final_elo',
          'avg_median_elo', 'avg_p90_elo', 'best_max_elo');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only fire on mu/sigma changes (trigger columns match IF condition)
CREATE TRIGGER variant_rating_changed
  AFTER UPDATE OF mu, sigma ON evolution_variants
  FOR EACH ROW
  EXECUTE FUNCTION mark_elo_metrics_stale();
