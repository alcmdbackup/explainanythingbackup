-- Link LLM call tracking rows to their evolution agent invocation.
-- Nullable: non-evolution LLM calls won't have this. ON DELETE SET NULL preserves LLM rows.
-- Rollback: DROP INDEX IF EXISTS idx_llm_tracking_invocation; ALTER TABLE "llmCallTracking" DROP COLUMN IF EXISTS evolution_invocation_id;

ALTER TABLE "llmCallTracking"
  ADD COLUMN evolution_invocation_id UUID
  REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL;
