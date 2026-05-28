-- rename_agents_subagents_evolution_20260508 Phase 4b: contract-phase migration.
--
-- After the expand-phase migration (20260509000001) introduced subagent_name +
-- bidirectional trigger + view refresh, this contract-phase migration drops the
-- legacy agent_name column. Sequencing: this migration may run only after all
-- code paths that read/write agent_name have been updated to use subagent_name
-- (see corresponding code changes in this PR).
--
-- @destructive-ddl-approved: intentional DROP COLUMN as the contract step of the
-- expand/contract column rename pattern. Expand migration 20260509000001 added
-- subagent_name + bidirectional mirror trigger; this PR's code changes write
-- subagent_name and have been dual-tested. The destructive-DDL guardrail in
-- ci.yml respects this marker (intentional opt-out documented in-file).

-- 1. Drop the bidirectional mirror trigger first (cannot drop a referenced column).
DROP TRIGGER IF EXISTS evolution_logs_mirror_subagent_name ON evolution_logs;
DROP FUNCTION IF EXISTS evolution_logs_mirror_subagent_name();

-- 2. Recreate the legacy view WITHOUT agent_name (it would dangle once the column is dropped).
DROP VIEW IF EXISTS evolution_run_logs CASCADE;
CREATE VIEW evolution_run_logs AS
  SELECT id, entity_type, entity_id, run_id, experiment_id, strategy_id,
         created_at, level, subagent_name, iteration, variant_id,
         message, context
  FROM evolution_logs;

-- 3. Drop the legacy column. CASCADE removes any remaining grants/dependencies.
ALTER TABLE evolution_logs DROP COLUMN IF EXISTS agent_name CASCADE;
