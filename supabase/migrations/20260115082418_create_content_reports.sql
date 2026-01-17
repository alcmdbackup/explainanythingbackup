-- Migration: Create content_reports table for user-reported content
-- Rollback: DROP POLICY IF EXISTS "reports_insert" ON content_reports; DROP POLICY IF EXISTS "reports_select_admin" ON content_reports; DROP POLICY IF EXISTS "reports_update_admin" ON content_reports; DROP TABLE IF EXISTS content_reports;

-- Create content_reports table
CREATE TABLE content_reports (
  id SERIAL PRIMARY KEY,
  explanation_id INTEGER NOT NULL REFERENCES explanations(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_content_reports_explanation ON content_reports(explanation_id);
CREATE INDEX idx_content_reports_status ON content_reports(status);
CREATE INDEX idx_content_reports_created ON content_reports(created_at DESC);

-- Enable Row Level Security
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Authenticated users can insert their own reports
CREATE POLICY "reports_insert" ON content_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

-- RLS Policy: Users can view their own reports
CREATE POLICY "reports_select_own" ON content_reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

-- RLS Policy: Admins can read all reports
CREATE POLICY "reports_select_admin" ON content_reports FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- RLS Policy: Admins can update reports (for resolving)
CREATE POLICY "reports_update_admin" ON content_reports FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- Add comment explaining status values
COMMENT ON COLUMN content_reports.status IS 'Report status: pending, reviewed, dismissed, actioned';
