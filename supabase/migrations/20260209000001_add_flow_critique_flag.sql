-- Seed flow critique feature flag into the feature_flags table.
-- Controls flow critique + flow comparison as a second evaluation pass in the evolution pipeline.

INSERT INTO feature_flags (name, enabled, description) VALUES
  ('evolution_flow_critique_enabled', false, 'Enable dedicated flow critique (0-5 sub-dimensions) and flow comparison in the evolution pipeline')
ON CONFLICT (name) DO NOTHING;
