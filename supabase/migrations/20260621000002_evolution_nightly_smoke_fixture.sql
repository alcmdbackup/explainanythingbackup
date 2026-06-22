-- Seed the `Nightly smoke fixture` strategy for the Layer-3 nightly smoke workflow
-- (.github/workflows/evolution-nightly-smoke.yml — separate PR). The fixture is a
-- real (non-test-content) strategy with min-config + deepseek-v4-flash so the
-- nightly smoke can verify the runner is alive end-to-end at ~$0.005/night.
--
-- The strategy NAME 'Nightly smoke fixture' does NOT match evolution_is_test_name
-- (which matches: 'test', '[TEST]', '[E2E]', '[TEST_EVO]', or timestamp pattern
-- *-<10-13 digits>-*). So the BEFORE trigger sets is_test_content=false,
-- the systemd runner's claim_evolution_run gate accepts it, and the daily janitor
-- (which filters by is_test_content=true) leaves it alone.
--
-- INSERT...SELECT...WHERE NOT EXISTS handles BOTH:
--   - PK collision (re-application via migration:verify on ephemeral postgres)
--   - config_hash UNIQUE constraint collision (uq_strategies_config_hash from
--     20260329000001) under a hash-drift re-import.
-- If you change the config later, ship an UPDATE migration. This INSERT is
-- bootstrap-only.

BEGIN;

INSERT INTO evolution_strategies (id, name, label, config, config_hash, status, is_predefined, created_by)
SELECT
  '00000000-0000-4f00-8f00-000000000fff'::uuid,
  'Nightly smoke fixture',
  'smoke',
  jsonb_build_object(
    'generationModel', 'deepseek-v4-flash',
    'judgeModel', 'deepseek-v4-flash',
    'strategiesPerRound', 1,
    'calibrationOpponents', 2,
    'tournamentTopK', 2,
    'iterationConfigs', jsonb_build_array(
      jsonb_build_object('agentType', 'generate', 'budgetPercent', 100, 'maxAgents', 1)
    ),
    'budgetUsd', 0.05
  ),
  'v2:nightly_smoke_v1',
  'active',
  true,
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM evolution_strategies
  WHERE id = '00000000-0000-4f00-8f00-000000000fff'::uuid
     OR config_hash = 'v2:nightly_smoke_v1'
);

COMMIT;
