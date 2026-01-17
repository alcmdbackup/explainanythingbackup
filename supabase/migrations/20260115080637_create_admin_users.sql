-- Migration: Create admin_users table for database-backed admin authentication
-- Rollback: DROP POLICY IF EXISTS "admin_users_select_own" ON admin_users; DROP TABLE IF EXISTS admin_users;

-- Create admin_users table to track which users have admin privileges
CREATE TABLE admin_users (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id)
);

-- Enable Row Level Security
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Admins can only read their OWN record
-- This prevents privilege escalation - admins cannot see other admin users
CREATE POLICY "admin_users_select_own" ON admin_users
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Create index for faster lookups by user_id
CREATE INDEX idx_admin_users_user_id ON admin_users(user_id);
