-- Seed evolution pipeline feature flags into the feature_flags table.
-- These control per-agent gating and dry-run mode for the evolution pipeline.

INSERT INTO feature_flags (name, enabled, description) VALUES
  ('evolution_tournament_enabled', true, 'Enable Tournament agent in COMPETITION phase (false → use CalibrationRanker)'),
  ('evolution_evolve_pool_enabled', true, 'Enable EvolutionAgent (evolvePool) during iterations'),
  ('evolution_dry_run_only', false, 'When enabled, skip all evolution pipeline execution (log only)')
ON CONFLICT (name) DO NOTHING;
