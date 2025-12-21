-- Migration: Add created_at timestamp to userExplanationEvents
-- Purpose: Enable time-based filtering for "Top" discovery mode

-- Add created_at column with default value
ALTER TABLE "userExplanationEvents"
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill existing rows with approximate timestamp based on ID
-- Assumes newer IDs are more recent events
UPDATE "userExplanationEvents"
SET created_at = NOW() - (interval '1 minute' * (
  (SELECT MAX(id) FROM "userExplanationEvents") - id
))
WHERE created_at IS NULL;

-- Create index for time-based queries
CREATE INDEX IF NOT EXISTS idx_user_explanation_events_created_at
ON "userExplanationEvents" (created_at);

-- Create composite index for event_name + time queries (used by TOP mode)
CREATE INDEX IF NOT EXISTS idx_user_explanation_events_name_created
ON "userExplanationEvents" (event_name, created_at);
