-- Migration: Create user_profiles table for user management
-- Rollback: DROP POLICY IF EXISTS "profiles_insert_admin" ON user_profiles; DROP POLICY IF EXISTS "profiles_update_admin" ON user_profiles; DROP POLICY IF EXISTS "profiles_select_admin" ON user_profiles; DROP POLICY IF EXISTS "profiles_select_own" ON user_profiles; DROP TABLE IF EXISTS user_profiles;

-- Create user_profiles table
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  is_disabled BOOLEAN DEFAULT FALSE,
  disabled_at TIMESTAMPTZ,
  disabled_by UUID REFERENCES auth.users(id),
  disabled_reason TEXT,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_user_profiles_disabled ON user_profiles(is_disabled) WHERE is_disabled = TRUE;
CREATE INDEX idx_user_profiles_created ON user_profiles(created_at DESC);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own profile
CREATE POLICY "profiles_select_own" ON user_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- RLS Policy: Admins can view all profiles
CREATE POLICY "profiles_select_admin" ON user_profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- RLS Policy: Admins can update profiles
CREATE POLICY "profiles_update_admin" ON user_profiles FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- RLS Policy: Admins can insert profiles (for creating profiles for existing users)
CREATE POLICY "profiles_insert_admin" ON user_profiles FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- Add comments for documentation
COMMENT ON TABLE user_profiles IS 'User profile data for admin management, including disable status';
COMMENT ON COLUMN user_profiles.is_disabled IS 'When true, user is blocked from using the application';
COMMENT ON COLUMN user_profiles.disabled_reason IS 'Reason for disabling the account (visible to user)';
COMMENT ON COLUMN user_profiles.admin_notes IS 'Internal notes about the user (admin-only)';

-- Create function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_user_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_user_profile_updated_at();
