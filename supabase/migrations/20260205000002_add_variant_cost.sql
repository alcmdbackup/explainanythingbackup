-- Migration: Add cost_usd column to content_evolution_variants
-- Enables per-variant cost attribution for fine-grained analysis

ALTER TABLE content_evolution_variants
  ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10, 6);

COMMENT ON COLUMN content_evolution_variants.cost_usd IS 'Cost in USD to generate this variant';

-- Rollback:
-- ALTER TABLE content_evolution_variants DROP COLUMN IF EXISTS cost_usd;
