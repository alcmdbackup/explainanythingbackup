-- Phase 6 of scan_codebase_for_bugs_20260422 (B048) — record whether each agent
-- invocation surfaced a variant to the pool vs. discarded it.
--
-- Without this column, cost rollups that sum evolution_agent_invocations.cost_usd count
-- generate-agent invocations whose variants were discarded during local ranking. The
-- rollup therefore over-counted "useful" cost — an agent that generated a variant,
-- ranked it, and discarded it looked the same as one that produced a surfaced variant.
-- Adding the flag lets B053 filter tactic-cost rollups by `variant_surfaced IS NOT FALSE`
-- (keeps historic NULL + new TRUE rows, excludes new FALSE discards).
--
-- RLS: no change needed. The existing `service_role_all` policy (migration
-- 20260321000001_evolution_service_role_rls.sql) and `readonly_select` policy
-- (migration 20260318000001_evolution_readonly_select_policy.sql) apply to the whole
-- table and cover the new column automatically.
--
-- DOWN migration: 20260423081159_add_variant_surfaced_to_evolution_agent_invocations.down.sql

ALTER TABLE evolution_agent_invocations
  ADD COLUMN IF NOT EXISTS variant_surfaced boolean;

COMMENT ON COLUMN evolution_agent_invocations.variant_surfaced IS
  'B048: true when the agent surfaced a variant into the pool; false when it was locally '
  'discarded (budget + low local elo); NULL for historic rows (pre-migration, opaque).';
