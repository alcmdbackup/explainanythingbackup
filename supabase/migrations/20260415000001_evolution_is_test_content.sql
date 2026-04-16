-- Add evolution_strategies.is_test_content column maintained by a BEFORE trigger
-- so admin UI test-content filters can use a single boolean instead of a
-- .not.in(<large uuid list>) query that silently hits PostgREST URL length limits.
--
-- Bug context: with ~984 test strategies on staging, the IN-list URL was ~36 KB,
-- exceeding PostgREST's URL length ceiling. Runs list + variants list queries
-- silently returned empty with the "Hide test content" checkbox ticked.
--
-- Applied after 20260325000001_drop_duplicate_strategy_fk.sql which removed the
-- duplicate FK that previously caused PGRST201 on !inner joins through
-- evolution_runs → evolution_strategies (callers of this column use !inner).

BEGIN;

SET LOCAL statement_timeout = '60s';

-- ─── IMMUTABLE predicate function ───────────────────────────────────────────
-- Mirrors evolution/src/services/shared.ts:isTestContentName:
--   - lowercase equals 'test'
--   - contains '[test]' / '[e2e]' / '[test_evo]' (case-insensitive)
--   - timestamp pattern: `<anything>-<10-13 digits>-<anything>` (e.g. e2e-nav-1775877428914-strategy)
CREATE OR REPLACE FUNCTION evolution_is_test_name(name TEXT) RETURNS BOOLEAN
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT
    name IS NOT NULL AND (
      lower(name) = 'test'
      OR name ILIKE '%[TEST]%'
      OR name ILIKE '%[E2E]%'
      OR name ILIKE '%[TEST_EVO]%'
      OR name ~ '^.*-\d{10,13}-.*$'
    )
$$;

-- ─── Column (default FALSE so existing rows start as non-test) ──────────────
ALTER TABLE evolution_strategies ADD COLUMN is_test_content BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Backfill BEFORE trigger creation (so trigger doesn't re-fire) ──────────
UPDATE evolution_strategies SET is_test_content = evolution_is_test_name(name);

-- ─── BEFORE INSERT/UPDATE OF name trigger that mutates NEW (no recursion) ───
CREATE OR REPLACE FUNCTION evolution_strategies_set_is_test_content() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_test_content := evolution_is_test_name(NEW.name);
  RETURN NEW;
END;
$$;

CREATE TRIGGER evolution_strategies_set_is_test_content_tg
  BEFORE INSERT OR UPDATE OF name ON evolution_strategies
  FOR EACH ROW
  WHEN (TG_OP = 'INSERT' OR OLD.name IS DISTINCT FROM NEW.name)
  EXECUTE FUNCTION evolution_strategies_set_is_test_content();

-- ─── Partial index for the common "non-test only" scan ──────────────────────
CREATE INDEX IF NOT EXISTS idx_strategies_non_test
  ON evolution_strategies(id)
  WHERE is_test_content = FALSE;

COMMIT;
