-- Migration: Add soft delete (is_hidden) columns to explanations table
-- Rollback: ALTER TABLE explanations DROP COLUMN IF EXISTS is_hidden, hidden_at, hidden_by;

-- Add soft delete columns
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS hidden_by UUID REFERENCES auth.users(id);

-- Create index for filtering hidden content
CREATE INDEX IF NOT EXISTS idx_explanations_is_hidden ON explanations(is_hidden);

-- Update RLS policy to exclude hidden explanations from non-admins
-- First drop existing select policy if it exists
DROP POLICY IF EXISTS "explanations_select_policy" ON explanations;
DROP POLICY IF EXISTS "Enable read access for all users" ON explanations;

-- Create new policy: non-hidden content visible to all, hidden content only visible to admins
CREATE POLICY "explanations_select_policy" ON explanations FOR SELECT USING (
  is_hidden = FALSE
  OR is_hidden IS NULL
  OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
);

-- Note: This migration depends on admin_users table existing (from previous migration)
