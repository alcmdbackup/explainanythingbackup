-- Migration 1f: Composite indexes for the unified explorer's multi-dimensional filters.
-- Covers common filter combinations: prompt + pipeline type + strategy.

CREATE INDEX IF NOT EXISTS idx_evolution_runs_explorer
  ON content_evolution_runs(prompt_id, pipeline_type, strategy_config_id);

-- Rollback:
-- DROP INDEX IF EXISTS idx_evolution_runs_explorer;
