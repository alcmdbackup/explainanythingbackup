-- Migration: Create feature_flags table for admin-controlled feature toggles
-- Rollback: DROP POLICY IF EXISTS "flags_update_admin" ON feature_flags; DROP POLICY IF EXISTS "flags_select" ON feature_flags; DROP TABLE IF EXISTS feature_flags;

-- Create feature_flags table
CREATE TABLE feature_flags (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT FALSE,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for name lookups
CREATE INDEX idx_feature_flags_name ON feature_flags(name);

-- Enable Row Level Security
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Anyone authenticated can read flags (for feature gating in app)
CREATE POLICY "flags_select" ON feature_flags FOR SELECT TO authenticated
  USING (true);

-- RLS Policy: Only admins can update flags
CREATE POLICY "flags_update_admin" ON feature_flags FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- RLS Policy: Only admins can insert new flags
CREATE POLICY "flags_insert_admin" ON feature_flags FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- Add comments for documentation
COMMENT ON TABLE feature_flags IS 'Feature flags for controlled rollouts and A/B testing';
COMMENT ON COLUMN feature_flags.name IS 'Unique identifier for the flag (e.g., enable_new_editor)';
COMMENT ON COLUMN feature_flags.enabled IS 'Whether the feature is currently enabled';
COMMENT ON COLUMN feature_flags.description IS 'Human-readable description of what the flag controls';

-- Seed some default feature flags
INSERT INTO feature_flags (name, enabled, description) VALUES
  ('maintenance_mode', false, 'Put the application in maintenance mode'),
  ('new_explanation_flow', false, 'Enable the new explanation creation flow'),
  ('advanced_analytics', false, 'Show advanced analytics in the dashboard'),
  ('beta_features', false, 'Enable beta features for testing');
