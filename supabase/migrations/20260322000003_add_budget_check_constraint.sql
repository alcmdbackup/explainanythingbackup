-- Fix Bug #6: No server-side budget validation.
-- Adds CHECK constraint to prevent invalid budget values at DB level.
-- ROLLBACK: ALTER TABLE evolution_runs DROP CONSTRAINT chk_budget_cap;

ALTER TABLE evolution_runs ADD CONSTRAINT chk_budget_cap
  CHECK (budget_cap_usd > 0 AND budget_cap_usd <= 10);
