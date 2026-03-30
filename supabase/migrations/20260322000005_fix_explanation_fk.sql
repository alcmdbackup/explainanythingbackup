-- Fix Bug #15: Missing ON DELETE on evolution_explanation_id FK.
-- Two-step approach (NOT VALID then VALIDATE) minimizes lock duration.
-- ROLLBACK: DROP CONSTRAINT evolution_variants_evolution_explanation_id_fkey;
--           ADD CONSTRAINT without ON DELETE (restore original behavior)

-- Step 1: Find and drop existing constraint (auto-generated name)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'evolution_variants'::regclass
    AND confrelid = 'evolution_explanations'::regclass;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE evolution_variants DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Step 2: Add new constraint as NOT VALID (no lock on existing rows)
ALTER TABLE evolution_variants
  ADD CONSTRAINT evolution_variants_evolution_explanation_id_fkey
  FOREIGN KEY (evolution_explanation_id) REFERENCES evolution_explanations(id)
  ON DELETE SET NULL
  NOT VALID;

-- Step 3: Validate separately (takes SHARE UPDATE EXCLUSIVE, allows reads/writes)
ALTER TABLE evolution_variants
  VALIDATE CONSTRAINT evolution_variants_evolution_explanation_id_fkey;
