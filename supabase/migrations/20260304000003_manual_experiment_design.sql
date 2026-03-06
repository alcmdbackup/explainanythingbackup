-- Add 'manual' to experiment design CHECK constraint for manual run creation.
-- Manual experiments allow adding runs one-by-one instead of L8 factorial auto-generation.

-- Guard: backfill any NULL design values before constraint change
UPDATE evolution_experiments SET design = 'L8' WHERE design IS NULL;

-- DROP existing CHECK, ADD new one including 'manual'
ALTER TABLE evolution_experiments
  DROP CONSTRAINT IF EXISTS evolution_experiments_design_check;

ALTER TABLE evolution_experiments
  ADD CONSTRAINT evolution_experiments_design_check
  CHECK (design IN ('L8', 'full-factorial', 'manual'));

-- DOWN (rollback):
-- DELETE FROM evolution_experiments WHERE design = 'manual';
-- ALTER TABLE evolution_experiments DROP CONSTRAINT IF EXISTS evolution_experiments_design_check;
-- ALTER TABLE evolution_experiments ADD CONSTRAINT evolution_experiments_design_check CHECK (design IN ('L8', 'full-factorial'));
