-- Add JSONB columns for creator-based Elo attribution on variants and agent invocations.
-- These store per-variant EloAttribution and per-agent AgentAttribution computed at finalization.

ALTER TABLE evolution_variants
  ADD COLUMN IF NOT EXISTS elo_attribution JSONB;

ALTER TABLE evolution_agent_invocations
  ADD COLUMN IF NOT EXISTS agent_attribution JSONB;
