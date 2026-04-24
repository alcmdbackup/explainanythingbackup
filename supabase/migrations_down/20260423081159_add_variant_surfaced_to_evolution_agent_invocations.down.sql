-- DOWN migration for 20260423081159_add_variant_surfaced_to_evolution_agent_invocations.sql.
-- Drops the variant_surfaced column. Safe to run while code is rolled back — the rollup
-- path falls back to the pre-B048 behavior (sum all invocations, no surfaced filter).

ALTER TABLE evolution_agent_invocations
  DROP COLUMN IF EXISTS variant_surfaced;
