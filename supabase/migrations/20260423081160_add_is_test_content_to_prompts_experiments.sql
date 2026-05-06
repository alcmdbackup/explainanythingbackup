-- Add is_test_content column maintained by a BEFORE trigger to evolution_prompts
-- and evolution_experiments, mirroring the pattern from
-- 20260415000001_evolution_is_test_content.sql which did the same for
-- evolution_strategies.
--
-- Why: applyTestContentNameFilter() in evolution/src/services/shared.ts only
-- substring-matched [TEST]/[E2E]/[TEST_EVO] and missed timestamp-pattern names
-- like `e2e-nav-1775877428914-strategy`, so test rows leaked into the prompts
-- list, arena topics list, and the start-experiment wizard pickers even when
-- "Hide test content" was checked. Moving these tables onto the same
-- is_test_content column + trigger as evolution_strategies makes the filter
-- uniform across the schema and indexable.
--
-- The evolution_is_test_name(text) IMMUTABLE function from migration
-- 20260415000001 is reused as-is — do NOT redefine.
--
-- Statement order is critical: ALTER → backfill UPDATE → trigger creation. The
-- backfill must run BEFORE trigger creation so existing rows pick up the
-- correct value (the BEFORE trigger only fires on subsequent INSERT/UPDATE OF
-- name). The whole migration runs in a single transaction.
--
-- All schema-creation statements use IF NOT EXISTS / DROP IF EXISTS guards so
-- the migration is idempotent — supabase db push --include-all is allowed to
-- re-apply this file safely (e.g. after the auto-reorder workflow renames the
-- migration timestamp on a re-pushed branch).

BEGIN;

SET LOCAL statement_timeout = '60s';

-- ─── evolution_prompts ──────────────────────────────────────────────────────

ALTER TABLE evolution_prompts ADD COLUMN IF NOT EXISTS is_test_content BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE evolution_prompts SET is_test_content = evolution_is_test_name(name)
  WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);

CREATE OR REPLACE FUNCTION evolution_prompts_set_is_test_content() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_test_content := evolution_is_test_name(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evolution_prompts_set_is_test_content_tg ON evolution_prompts;
CREATE TRIGGER evolution_prompts_set_is_test_content_tg
  BEFORE INSERT OR UPDATE OF name ON evolution_prompts
  FOR EACH ROW
  EXECUTE FUNCTION evolution_prompts_set_is_test_content();

CREATE INDEX IF NOT EXISTS idx_evolution_prompts_non_test
  ON evolution_prompts(id)
  WHERE is_test_content = FALSE;

-- ─── evolution_experiments ──────────────────────────────────────────────────

ALTER TABLE evolution_experiments ADD COLUMN IF NOT EXISTS is_test_content BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE evolution_experiments SET is_test_content = evolution_is_test_name(name)
  WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);

CREATE OR REPLACE FUNCTION evolution_experiments_set_is_test_content() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_test_content := evolution_is_test_name(NEW.name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evolution_experiments_set_is_test_content_tg ON evolution_experiments;
CREATE TRIGGER evolution_experiments_set_is_test_content_tg
  BEFORE INSERT OR UPDATE OF name ON evolution_experiments
  FOR EACH ROW
  EXECUTE FUNCTION evolution_experiments_set_is_test_content();

CREATE INDEX IF NOT EXISTS idx_evolution_experiments_non_test
  ON evolution_experiments(id)
  WHERE is_test_content = FALSE;

COMMIT;
