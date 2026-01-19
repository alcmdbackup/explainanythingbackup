-- Migration: Update RLS policy to use delete_status instead of is_hidden
-- This completes the migration from is_hidden to delete_status
-- Rollback: Run the previous migration's policy creation

-- Drop existing select policy
DROP POLICY IF EXISTS "explanations_select_policy" ON explanations;

-- Create new policy using delete_status
-- Visible content (delete_status = 'visible') is accessible to everyone
-- Hidden/deleted content is only accessible to admins
CREATE POLICY "explanations_select_policy" ON explanations FOR SELECT USING (
  delete_status = 'visible'
  OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
);

-- Note: This migration depends on:
-- 1. admin_users table existing (from 20260115080637_create_admin_users.sql)
-- 2. delete_status column being populated (from 20260117173000_add_delete_status.sql)
