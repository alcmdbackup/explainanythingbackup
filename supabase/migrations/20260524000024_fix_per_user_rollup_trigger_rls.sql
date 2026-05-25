-- Follow-up to 20260524000003_add_per_user_daily_cost_rollups.sql.
--
-- The trigger function update_per_user_daily_cost_rollup() was declared
-- SECURITY DEFINER but that does NOT bypass RLS on its own — it only changes
-- which role's privileges are checked for table-level access (GRANT/REVOKE).
-- RLS policies are still evaluated against the function's executing role.
--
-- Because per_user_daily_cost_rollups has a deny_all RLS policy (matched by
-- the migration-owner role that runs the trigger), the INSERT inside the
-- trigger was being denied, which rolled back the OUTER INSERT into
-- llmCallTracking. This silently broke any caller (including the E2E
-- fixture createMultiHopFixture's seedLlmCallTracking path) that inserted
-- into llmCallTracking after the migration applied.
--
-- Fix: add `SET row_security = off` to the function definition so it can
-- write through deny_all RLS. The trigger only inserts into the rollup
-- table; it cannot leak data because reads still go through normal RLS
-- (deny_all + service_role bypass).

ALTER FUNCTION update_per_user_daily_cost_rollup() SET row_security = off;
