-- Backfill variants_generated from total_variants for completed runs where it was never set.
UPDATE content_evolution_runs
SET variants_generated = total_variants
WHERE variants_generated = 0
  AND total_variants > 0
  AND status = 'completed';
