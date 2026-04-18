-- Create evolution_tactics entity table (thin — no prompt columns).
-- Tactic prompts live in code (git-controlled). This table provides entity identity
-- for metrics, admin UI, and future FK references.

CREATE TABLE IF NOT EXISTS evolution_tactics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  agent_type TEXT NOT NULL,
  category TEXT,
  is_predefined BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: deny-all default + service_role bypass + readonly SELECT
ALTER TABLE evolution_tactics ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evolution_tactics' AND policyname = 'deny_all') THEN
    CREATE POLICY deny_all ON evolution_tactics FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;

CREATE POLICY service_role_all ON evolution_tactics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    CREATE POLICY readonly_select ON evolution_tactics
      FOR SELECT TO readonly_local USING (true);
  END IF;
END $$;

REVOKE ALL ON evolution_tactics FROM PUBLIC, anon, authenticated;

-- Add tactic column to evolution_agent_invocations (nullable — ranking/merge agents have NULL)
ALTER TABLE evolution_agent_invocations
  ADD COLUMN IF NOT EXISTS tactic TEXT;

CREATE INDEX IF NOT EXISTS idx_invocations_tactic
  ON evolution_agent_invocations (tactic)
  WHERE tactic IS NOT NULL;

-- Add 'tactic' to evolution_metrics entity_type CHECK constraint (non-blocking).
-- Current values (as of 20260324000001 which removed arena_topic):
-- run, invocation, variant, strategy, experiment, prompt
ALTER TABLE evolution_metrics DROP CONSTRAINT IF EXISTS evolution_metrics_entity_type_check;
ALTER TABLE evolution_metrics ADD CONSTRAINT evolution_metrics_entity_type_check
  CHECK (entity_type IN ('run','invocation','variant','strategy','experiment','prompt','tactic'))
  NOT VALID;
ALTER TABLE evolution_metrics VALIDATE CONSTRAINT evolution_metrics_entity_type_check;
