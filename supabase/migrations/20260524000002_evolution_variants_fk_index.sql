-- supabase:disable-transaction
-- ^^^ Required: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Established pattern matches 20260322000004_add_arena_indexes.sql.
--
-- split_evolution_explainanythig_into_separate_websites_20260522 — Phase 1 (index only).
-- Sibling of 20260524000001 (the FK migration). Adds the missing index on
-- evolution_variants(evolution_explanation_id) so the ON DELETE SET NULL
-- cascade from evolution_explanations isn't a full-table scan.
--
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_evolution_variants_evolution_explanation_id;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evolution_variants_evolution_explanation_id
  ON evolution_variants(evolution_explanation_id);
