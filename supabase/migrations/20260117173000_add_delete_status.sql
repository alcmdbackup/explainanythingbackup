-- Migration: Add two-stage soft delete system (delete_status) to explanations table
-- This adds new columns alongside existing is_hidden for gradual migration
-- Rollback: ALTER TABLE explanations DROP COLUMN IF EXISTS delete_status, delete_status_changed_at, delete_reason, delete_source, moderation_reviewed, moderation_reviewed_by, moderation_reviewed_at, legal_hold;

-- Add new delete lifecycle columns
-- delete_status: 'visible' (normal), 'hidden' (soft delete), 'deleted' (archived)
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS delete_status TEXT DEFAULT 'visible';
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS delete_status_changed_at TIMESTAMPTZ;
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS delete_source TEXT DEFAULT 'manual';
  -- Values: 'manual', 'automated', 'user_request', 'legal'

-- Add moderation review tracking
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS moderation_reviewed BOOLEAN DEFAULT FALSE;
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS moderation_reviewed_by UUID REFERENCES auth.users(id);
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS moderation_reviewed_at TIMESTAMPTZ;

-- Add legal hold flag (prevents deletion progression)
ALTER TABLE explanations ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN DEFAULT FALSE;

-- Create indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_explanations_delete_status ON explanations(delete_status);
CREATE INDEX IF NOT EXISTS idx_explanations_delete_status_changed_at ON explanations(delete_status_changed_at);

-- Backfill delete_status from existing is_hidden column
-- Note: delete_status_changed_at is set to hidden_at for hidden content, NULL for visible
UPDATE explanations SET
  delete_status = CASE WHEN is_hidden = true THEN 'hidden' ELSE 'visible' END,
  delete_status_changed_at = CASE WHEN is_hidden = true THEN COALESCE(hidden_at, NOW()) ELSE NULL END,
  delete_source = 'manual',
  moderation_reviewed = CASE WHEN is_hidden = true THEN true ELSE false END
WHERE delete_status IS NULL OR delete_status = 'visible';

-- Add check constraint for valid delete_status values
ALTER TABLE explanations DROP CONSTRAINT IF EXISTS explanations_delete_status_check;
ALTER TABLE explanations ADD CONSTRAINT explanations_delete_status_check
  CHECK (delete_status IN ('visible', 'hidden', 'deleted'));

-- Add check constraint for valid delete_source values
ALTER TABLE explanations DROP CONSTRAINT IF EXISTS explanations_delete_source_check;
ALTER TABLE explanations ADD CONSTRAINT explanations_delete_source_check
  CHECK (delete_source IN ('manual', 'automated', 'user_request', 'legal'));

-- Note: RLS policy is NOT updated yet - still uses is_hidden
-- This will be updated in Milestone 3 when code is migrated to use delete_status
