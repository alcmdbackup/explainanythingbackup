-- Fix Bug #6: No server-side budget validation.
-- Adds CHECK constraint to prevent invalid budget values at DB level.
-- ROLLBACK: ALTER TABLE evolution_runs DROP CONSTRAINT chk_budget_cap;

-- Idempotent (DROP IF EXISTS + ADD): production already had the constraint
-- from a prior path not recorded in supabase_migrations history, which made
-- the May 23 main→prod deploy fail with SQLSTATE 42710 (constraint exists).
-- Hotfixed straight to production via PR #1074 (commit bbca28bc); this is the
-- backport so the next mainToProd doesn't reintroduce the original
-- non-idempotent form.
ALTER TABLE evolution_runs DROP CONSTRAINT IF EXISTS chk_budget_cap;

ALTER TABLE evolution_runs ADD CONSTRAINT chk_budget_cap
  CHECK (budget_cap_usd > 0 AND budget_cap_usd <= 10);
