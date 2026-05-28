-- rename_agents_subagents_evolution_20260508 Phase 4a: expand-phase migration.
--
-- Add `subagent_name` column to `evolution_logs` alongside the existing `agent_name`
-- column. Both columns are populated via a bidirectional dual-write trigger so old
-- code reading agent_name and new code reading/writing subagent_name continue to
-- work during the rollover. The DROP COLUMN agent_name happens in a follow-up
-- project (Phase 4b).
--
-- CI's destructive-DDL guardrail (.github/workflows/ci.yml) blocks RENAME COLUMN
-- but allows ADD COLUMN, BEFORE INSERT/UPDATE triggers, and DROP VIEW IF EXISTS +
-- CREATE VIEW (the explicit-column form).

-- 1. Add the new column.
ALTER TABLE evolution_logs ADD COLUMN IF NOT EXISTS subagent_name TEXT;

-- 2. The mirror trigger + dual-column view + backfill only make sense while
--    agent_name still exists. If Phase 4b (migration 20260524000007) has
--    already dropped agent_name (e.g. on a re-run against staging where both
--    Phase 4a and 4b previously applied), skip the trigger/backfill/view —
--    they would all fail referencing the missing column. Phase 4b's view
--    recreate already produced the agent_name-less view; this block is a
--    no-op in that environment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'evolution_logs'
      AND column_name = 'agent_name'
  ) THEN
    -- 2a. Bidirectional dual-write trigger function.
    -- IS NULL gate: mirror only when target is NULL. UPDATEs that set both columns
    -- to non-null but DIFFERENT values intentionally leave them desynced — this is
    -- a NULL-mirroring trigger, not an equality enforcer.
    CREATE OR REPLACE FUNCTION evolution_logs_mirror_subagent_name()
    RETURNS TRIGGER AS $func$
    BEGIN
      IF NEW.subagent_name IS NULL THEN
        NEW.subagent_name := NEW.agent_name;
      END IF;
      IF NEW.agent_name IS NULL THEN
        NEW.agent_name := NEW.subagent_name;
      END IF;
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;

    EXECUTE 'DROP TRIGGER IF EXISTS evolution_logs_mirror_subagent_name ON evolution_logs';
    EXECUTE 'CREATE TRIGGER evolution_logs_mirror_subagent_name
      BEFORE INSERT OR UPDATE OF agent_name, subagent_name ON evolution_logs
      FOR EACH ROW
      EXECUTE FUNCTION evolution_logs_mirror_subagent_name()';

    -- 2b. One-shot backfill: populate subagent_name for pre-trigger rows.
    UPDATE evolution_logs SET subagent_name = agent_name WHERE subagent_name IS NULL;

    -- 2c. Refresh the legacy `evolution_run_logs` view with an explicit column list.
    EXECUTE 'DROP VIEW IF EXISTS evolution_run_logs CASCADE';
    EXECUTE 'CREATE VIEW evolution_run_logs AS
      SELECT id, entity_type, entity_id, run_id, experiment_id, strategy_id,
             created_at, level, agent_name, subagent_name, iteration, variant_id,
             message, context
      FROM evolution_logs';
  ELSE
    RAISE NOTICE 'evolution_logs.agent_name already dropped (Phase 4b applied); skipping mirror trigger + dual-column view creation.';
  END IF;
END $$;
