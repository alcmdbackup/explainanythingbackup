-- split_evolution_explainanythig_into_separate_websites_20260522 — Phase 1 (FK only).
-- Closes one of three FK gaps that would leave orphan evolution rows during the
-- explainanything DB reset:
--   1. evolution_experiments.evolution_explanation_id FK was intended by
--      20260322000006 but never created in the DB. This migration adds it.
--   2. evolution_variants(evolution_explanation_id) needs an index — added in the
--      sibling migration 20260524000002 (CONCURRENTLY, runs outside a transaction).
--   3. evolution_arena_comparisons.entry_a/b intentionally has no DB FK
--      (dropped in 20260409000001); orphan-prevention is enforced at the app
--      layer in evolution/src/lib/core/entities/VariantEntity.ts:65.
--      No DDL needed here; documented for auditor context.
--
-- Forward-only. Pre-step NULLs any pre-existing orphans so ADD CONSTRAINT
-- doesn't fail on a one-time invalid row. NOT VALID + VALIDATE pattern keeps
-- the AccessExclusiveLock window minimal and allows concurrent reads/writes
-- during validation.

BEGIN;

-- Step 1: NULL any existing orphaned evolution_explanation_id refs before adding the FK.
-- If the source row in evolution_explanations no longer exists, the dangling pointer is
-- meaningless and the new ON DELETE SET NULL behavior would null it on the next delete
-- anyway. Doing it explicitly now lets ADD CONSTRAINT ... VALIDATE succeed.
UPDATE evolution_experiments
   SET evolution_explanation_id = NULL
 WHERE evolution_explanation_id IS NOT NULL
   AND evolution_explanation_id NOT IN (SELECT id FROM evolution_explanations);

-- Step 2: Add the missing FK using the two-step NOT VALID + VALIDATE pattern.
-- NOT VALID skips the existing-row check at add time (holds AccessExclusiveLock briefly);
-- VALIDATE re-checks under a SHARE UPDATE EXCLUSIVE lock (concurrent reads/writes allowed).
ALTER TABLE evolution_experiments
  ADD CONSTRAINT evolution_experiments_evolution_explanation_id_fkey
  FOREIGN KEY (evolution_explanation_id)
  REFERENCES evolution_explanations(id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE evolution_experiments
  VALIDATE CONSTRAINT evolution_experiments_evolution_explanation_id_fkey;

COMMIT;

-- Rollback notes (for emergency revert; NOT executed by this migration):
--   ALTER TABLE evolution_experiments
--     DROP CONSTRAINT IF EXISTS evolution_experiments_evolution_explanation_id_fkey;
