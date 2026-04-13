-- Rollback companion for 20260413000001_rename_mu_sigma_to_elo_uncertainty.sql.
--
-- NOTE: This migration is intentionally a no-op placeholder to be applied ONLY if
-- the Elo rename migration causes production issues. It reverses the column renames.
--
-- To activate rollback: rename this file to a later timestamp and apply it.
-- Example: cp 20260413000002_rollback_rename_mu_sigma.sql 20260414000001_rollback_rename.sql
--
-- Activation-only contents shown below (commented out to keep this migration inert):

-- ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_a_elo_before TO entry_a_mu_before;
-- ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_a_uncertainty_before TO entry_a_sigma_before;
-- ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_b_elo_before TO entry_b_mu_before;
-- ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_b_uncertainty_before TO entry_b_sigma_before;
-- ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_a_elo_after TO entry_a_mu_after;
-- ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_a_uncertainty_after TO entry_a_sigma_after;
-- ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_b_elo_after TO entry_b_mu_after;
-- ALTER TABLE evolution_arena_comparisons RENAME COLUMN entry_b_uncertainty_after TO entry_b_sigma_after;
-- ALTER TABLE evolution_metrics RENAME COLUMN uncertainty TO sigma;

-- Inert SELECT so the migration runner has something to execute:
SELECT 1 WHERE false;
