-- Phase 2 follow-up of build_website_for_evolutiOn_20260626: tag arena topics by
-- their originating run source so the admin arena UI can hide /edit-derived
-- topics from the default view.
--
-- WHY a topic-level column even though we already have evolution_runs.run_source
-- (added by 20260627000004): topic-list pages query evolution_prompts directly
-- and would otherwise need a 3-table JOIN (prompts → variants → runs) to derive
-- the source per topic. Denormalizing as a single TEXT column lets the topic
-- list filter with a plain `WHERE source = 'admin'` (the default), zero JOINs.
--
-- All EXISTING topics belong to admin-driven runs (the only run-source that
-- existed before this migration), so DEFAULT 'admin' backfills correctly.
-- New topics created by /edit-source runs are tagged 'public_edit' by the
-- upsertSlotTopic call site (slotTopicActions.ts), threaded through ctx.runSource.
--
-- ROLLBACK:
-- ALTER TABLE evolution_prompts DROP CONSTRAINT IF EXISTS evolution_prompts_source_check;
-- ALTER TABLE evolution_prompts DROP COLUMN IF EXISTS source;

ALTER TABLE evolution_prompts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin';

-- CHECK constraint — same value set as evolution_runs.run_source so the topic's
-- source value matches the originating run's. (`test` + `local` retained for
-- topic rows created by integration / one-shot script runs.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evolution_prompts_source_check'
  ) THEN
    ALTER TABLE evolution_prompts
      ADD CONSTRAINT evolution_prompts_source_check
      CHECK (source IN ('admin', 'public_edit', 'test', 'local', 'minicomputer'));
  END IF;
END $$;

COMMENT ON COLUMN evolution_prompts.source IS
  'Provenance of the topic origin. Denormalizes evolution_runs.run_source so arena topic-list filters do not need a 3-table JOIN. Default ''admin'' for legacy/admin-created topics; set to ''public_edit'' on new paragraph topics inserted via upsertSlotTopic during a public-edit run.';

-- Partial index for the common filter path (topics where source != 'admin').
-- Sparse: in the steady state most topics are 'admin'; the index only stores
-- the small minority needing to be excluded from default views.
CREATE INDEX IF NOT EXISTS idx_evolution_prompts_source_non_admin
  ON evolution_prompts (source)
  WHERE source <> 'admin';
