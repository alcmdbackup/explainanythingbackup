-- Migration: Create admin_audit_log table for tracking admin actions
-- Rollback: DROP POLICY IF EXISTS "audit_select_admin" ON admin_audit_log; DROP TABLE IF EXISTS admin_audit_log;

-- Create admin_audit_log table
CREATE TABLE admin_audit_log (
  id SERIAL PRIMARY KEY,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_audit_log_admin ON admin_audit_log(admin_user_id);
CREATE INDEX idx_audit_log_entity ON admin_audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_action ON admin_audit_log(action);
CREATE INDEX idx_audit_log_created ON admin_audit_log(created_at DESC);

-- Enable Row Level Security
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Admins can read all audit logs
CREATE POLICY "audit_select_admin" ON admin_audit_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- Note: Insert is done via service role only (no insert policy for authenticated users)
-- This ensures audit logs can only be created by the server, not directly by users

-- Add comments for documentation
COMMENT ON TABLE admin_audit_log IS 'Audit trail for all admin actions';
COMMENT ON COLUMN admin_audit_log.action IS 'Action performed (e.g., hide_explanation, disable_user, resolve_report)';
COMMENT ON COLUMN admin_audit_log.entity_type IS 'Type of entity affected (e.g., explanation, user, report)';
COMMENT ON COLUMN admin_audit_log.entity_id IS 'ID of the affected entity';
COMMENT ON COLUMN admin_audit_log.details IS 'Additional action details (sanitized, no PII)';
