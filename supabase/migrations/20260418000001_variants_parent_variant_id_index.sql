-- Index on evolution_variants(parent_variant_id) for fast recursive lineage walks.
-- Consumed by the get_variant_full_chain RPC (Phase 4 of
-- generalize_to_generateFromPreviousArticle_evolution_20260417).

CREATE INDEX IF NOT EXISTS idx_evolution_variants_parent_variant_id
  ON evolution_variants(parent_variant_id);
