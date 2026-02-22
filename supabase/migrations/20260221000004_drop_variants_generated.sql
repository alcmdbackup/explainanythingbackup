-- Drop the redundant variants_generated column from evolution_runs.
-- This column always held the same value as total_variants; all code now reads total_variants.
-- CASCADE needed because the backward-compat VIEW content_evolution_runs may depend on this column.
ALTER TABLE evolution_runs DROP COLUMN IF EXISTS variants_generated CASCADE;
