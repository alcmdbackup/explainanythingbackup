-- Drop the redundant variants_generated column from evolution_runs.
-- This column always held the same value as total_variants; all code now reads total_variants.
ALTER TABLE evolution_runs DROP COLUMN IF EXISTS variants_generated;
