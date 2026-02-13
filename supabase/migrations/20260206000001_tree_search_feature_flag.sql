-- Seed tree search feature flag into the feature_flags table.
-- Controls the TreeSearchAgent in COMPETITION phase (mutually exclusive with iterative editing).

INSERT INTO feature_flags (name, enabled, description) VALUES
  ('evolution_tree_search_enabled', false, 'Enable TreeSearchAgent beam search in COMPETITION phase (mutually exclusive with iterative editing)')
ON CONFLICT (name) DO NOTHING;
