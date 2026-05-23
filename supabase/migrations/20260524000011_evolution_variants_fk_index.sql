-- supabase:disable-transaction
-- ^^^ Required: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Established pattern matches 20260322000004_add_arena_indexes.sql.
--
-- split_evolution_explainanythig_into_separate_websites_20260522 — Phase 1.
-- Adds the missing index on evolution_variants(evolution_explanation_id) so the
-- ON DELETE SET NULL cascade from evolution_explanations isn't a full-table scan.
--
-- Originally planned as part of a 3-FK hardening pass, but the other two were
-- moot: (a) evolution_experiments.evolution_explanation_id column doesn't exist
-- in production (research misread) and no app code references it; (b)
-- evolution_arena_comparisons.entry_a/b intentionally has no DB FK (dropped in
-- 20260409000001, app-layer enforced in VariantEntity.ts:65).
--
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_evolution_variants_evolution_explanation_id;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evolution_variants_evolution_explanation_id
  ON evolution_variants(evolution_explanation_id);
