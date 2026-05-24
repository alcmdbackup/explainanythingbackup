-- Fix Bug #6: No server-side budget validation.
-- Adds CHECK constraint to prevent invalid budget values at DB level.
-- ROLLBACK: ALTER TABLE evolution_runs DROP CONSTRAINT chk_budget_cap;

-- Idempotent (DROP IF EXISTS + ADD): production already has the constraint
-- from a prior path not recorded in supabase_migrations history, which made
-- the May 23 main→prod deploy fail with SQLSTATE 42710 (constraint exists).
-- The drop+add ensures re-runs are no-ops and the constraint definition
-- stays canonical with the latest migration code.
ALTER TABLE evolution_runs DROP CONSTRAINT IF EXISTS chk_budget_cap;

ALTER TABLE evolution_runs ADD CONSTRAINT chk_budget_cap
  CHECK (budget_cap_usd > 0 AND budget_cap_usd <= 10);
