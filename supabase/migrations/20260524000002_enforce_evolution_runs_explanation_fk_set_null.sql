-- split_evolution_explainanythig_into_separate_websites_20260522 — Phase 1.
-- Enforce ON DELETE SET NULL on evolution_runs.explanation_id → explanations(id).
--
-- Why this is necessary: 20260409000002_restore_evolution_runs_explanation_id.sql
-- used `ADD COLUMN IF NOT EXISTS ... REFERENCES ... ON DELETE SET NULL`. In
-- PostgreSQL, when the column already exists, `ADD COLUMN IF NOT EXISTS`
-- silently skips the ENTIRE clause — including REFERENCES. The test database
-- exhibits exactly this drift (explanation delete leaves dangling FK values
-- in evolution_runs), so the same drift is plausible in production.
--
-- This is the central safety property of the explainanything DB reset: when
-- explanations rows go away, the FK must auto-null in evolution_runs so the
-- evolution dataset survives the reset.
--
-- Strategy: drop any existing FK on the column (regardless of action), null out
-- any orphan FK pointers (they reference explanations that no longer exist —
-- evidence the FK was never enforced; otherwise the ON DELETE SET NULL trigger
-- would have nulled them when the parent went away), then re-add the FK with
-- the correct ON DELETE SET NULL behaviour. Idempotent.
--
-- Rollback: ALTER TABLE evolution_runs DROP CONSTRAINT IF EXISTS evolution_runs_explanation_id_fkey;

DO $$
DECLARE
  fk_name text;
BEGIN
  -- Find any existing FK on evolution_runs.explanation_id and drop it.
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'evolution_runs'::regclass
    AND contype = 'f'
    AND conkey = (
      SELECT array_agg(attnum)
      FROM pg_attribute
      WHERE attrelid = 'evolution_runs'::regclass
        AND attname = 'explanation_id'
    );

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evolution_runs DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

-- Null orphan FK pointers — they reference explanations that no longer exist.
-- These are exactly the dangling rows the SET NULL trigger would have nulled
-- if the FK had been properly enforced, so this is a one-time backfill that
-- brings the data into the state the FK contract has always implied.
UPDATE evolution_runs er
SET explanation_id = NULL
WHERE er.explanation_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM explanations e WHERE e.id = er.explanation_id);

-- Re-add with explicit ON DELETE SET NULL. Now the table is clean so this
-- validates immediately.
ALTER TABLE evolution_runs
  ADD CONSTRAINT evolution_runs_explanation_id_fkey
  FOREIGN KEY (explanation_id) REFERENCES explanations(id) ON DELETE SET NULL;
