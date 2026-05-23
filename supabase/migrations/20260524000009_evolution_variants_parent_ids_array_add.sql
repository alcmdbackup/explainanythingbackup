-- bring_back_debate_agent_20260506 Phase 1.15a — multi-parent lineage migration (PR 1).
--
-- Adds parent_variant_ids: uuid[] alongside the legacy parent_variant_id single-FK
-- column. After this migration applies, both columns coexist; the persistence layer
-- (Phase 3.8a) dual-writes to both. The legacy column is dropped in a follow-up PR
-- (1.15b) AFTER a 24h+ soak window where dual-write inconsistencies can be observed
-- via the dual_write_inconsistency_count metric.
--
-- Forward-only. Idempotent: ADD COLUMN IF NOT EXISTS + ON CONFLICT-equivalent guards
-- on the backfill so re-runs are safe.
--
-- Scale-tier note: data is tiny (<<100k rows), so the backfill runs inline in this
-- migration's transaction. The lock window is sub-second. At larger scale the plan
-- would extract the backfill to a separate Node script with batching — see the
-- planning doc Phase 1.15a-script + 1.15a-verify discussion.

-- Add the new array column with default empty array.
-- ALTER TABLE ADD COLUMN with non-volatile DEFAULT '{}' is metadata-only in
-- Postgres 11+: no row rewrite, ACCESS EXCLUSIVE held only briefly.
ALTER TABLE evolution_variants
  ADD COLUMN IF NOT EXISTS parent_variant_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill: convert single-FK rows to 1-element arrays. NULL parent_variant_id
-- rows (root/seed variants) keep the empty-array default. Idempotent guard:
-- only update rows where parent_variant_ids is still empty AND legacy column
-- is non-null, so re-running this migration is a no-op.
UPDATE evolution_variants
  SET parent_variant_ids = ARRAY[parent_variant_id]
  WHERE parent_variant_id IS NOT NULL
    AND parent_variant_ids = '{}';

-- GIN index for `WHERE ? = ANY(parent_variant_ids)` and `parent_variant_ids @> ARRAY[?]`
-- lookups by lineage queries. Regular (non-CONCURRENTLY) build is fine at this
-- data scale — index build takes <1s on tiny tables.
CREATE INDEX IF NOT EXISTS idx_evolution_variants_parent_variant_ids
  ON evolution_variants USING GIN (parent_variant_ids);

COMMENT ON COLUMN evolution_variants.parent_variant_ids IS
  'Array of parent variant IDs. parent_variant_ids[0] is the canonical primary parent by convention (e.g. judge''s winner for debate variants per bring_back_debate_agent_20260506 Decision §20). Empty array for root/seed variants. App-layer enforces referential integrity (no DB-level FK on array elements — PostgreSQL does not support that). See data_model.md Multi-parent variants subsection (deferred to PR 2).';
