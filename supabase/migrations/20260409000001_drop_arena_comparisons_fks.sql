-- Drop FK constraints that prevented in-run arena comparison writes.
-- MergeRatingsAgent writes evolution_arena_comparisons during the iteration loop,
-- but new variants are only persisted to evolution_variants in finalizeRun (after the loop).
-- Any comparison involving a freshly generated variant hit FK constraint violations and was
-- silently dropped (caught by best-effort try/catch in MergeRatingsAgent.ts:301-318).
--
-- These FKs are safe to remove because:
--   1. No queries JOIN entry_a/entry_b to fetch variant details anywhere in the codebase.
--   2. VariantEntity.ts:65 already does explicit deletion of evolution_arena_comparisons rows
--      when a variant is deleted, making ON DELETE CASCADE redundant.
--   3. Referential integrity is enforced at the application layer.
--
-- After applying this migration, run: npm run db:types
-- to regenerate src/lib/database.types.ts with updated schema metadata.
ALTER TABLE evolution_arena_comparisons DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_a_fkey;
ALTER TABLE evolution_arena_comparisons DROP CONSTRAINT IF EXISTS evolution_arena_comparisons_entry_b_fkey;

-- Rollback: re-add as NOT VALID to skip validating existing rows (some may be orphaned):
-- First delete orphaned rows:
--   DELETE FROM evolution_arena_comparisons
--   WHERE entry_a NOT IN (SELECT id FROM evolution_variants)
--      OR entry_b NOT IN (SELECT id FROM evolution_variants);
-- Then re-add constraints:
-- ALTER TABLE evolution_arena_comparisons ADD CONSTRAINT evolution_arena_comparisons_entry_a_fkey
--   FOREIGN KEY (entry_a) REFERENCES evolution_variants(id) ON DELETE CASCADE NOT VALID;
-- ALTER TABLE evolution_arena_comparisons ADD CONSTRAINT evolution_arena_comparisons_entry_b_fkey
--   FOREIGN KEY (entry_b) REFERENCES evolution_variants(id) ON DELETE CASCADE NOT VALID;
