-- Phase 5: add agent_invocation_id FK on evolution_variants.
-- Links each variant to the agent invocation that produced it, enabling clean
-- (agent, dimension) grouping for ELO-delta attribution without relying on
-- JSONB traversal of execution_detail.
--
-- No backfill: historic rows keep agent_invocation_id = NULL and are naturally
-- excluded from attribution. Old 'generate_from_seed_article' rows will be
-- deleted in a follow-up operation (see _planning.md Phase 1 runbook).

ALTER TABLE evolution_variants
  ADD COLUMN IF NOT EXISTS agent_invocation_id UUID
  REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_evolution_variants_agent_invocation_id
  ON evolution_variants(agent_invocation_id);
