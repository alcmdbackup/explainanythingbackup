-- Migration: Drop legacy is_hidden columns after migration to delete_status
-- This completes the clean break from the old soft delete system
-- Rollback: Add back the columns (see 20260115081312_add_explanations_is_hidden.sql)

-- Verify no code references is_hidden before running!
-- Run: grep -r "is_hidden" src/ --include="*.ts" --include="*.tsx"

-- Drop old index first
DROP INDEX IF EXISTS idx_explanations_is_hidden;

-- Drop old columns
ALTER TABLE explanations DROP COLUMN IF EXISTS is_hidden;
ALTER TABLE explanations DROP COLUMN IF EXISTS hidden_at;
ALTER TABLE explanations DROP COLUMN IF EXISTS hidden_by;

-- Note: After this migration:
-- 1. delete_status is the only way to track deletion state
-- 2. RLS policy uses delete_status (from 20260117174000)
-- 3. All queries filter by delete_status='visible'
