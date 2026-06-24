-- Broaden evolution_is_test_name() so the "Hide test content" admin filter stops
-- leaking ephemeral test/canary strategies, prompts, and experiments.
--
-- Bug context (playwright_sweep_evolution_bugs_ux_issues_20260623, findings #1/#9):
-- with "Hide test content" CHECKED, the runs/strategies lists still showed rows like
--   [TESTEVO]-FR3-canary-B2-4d-fixed-1781925811184   (bracket prefix, no underscore)
--   Gate verify real 1782140234529_7fe0bd            (space/underscore-delimited epoch)
-- The previous predicate only matched [TEST]/[E2E]/[TEST_EVO] and a strictly
-- hyphen-delimited `*-<10-13 digits>-*` timestamp, so:
--   * the `[TESTEVO]` spelling (no underscore) was unmatched, and
--   * trailing timestamps (`...-1781925811184$`) and space/underscore-delimited
--     timestamps (` 1782140234529_`) were unmatched.
--
-- Mirrors evolution/src/services/shared.ts:isTestContentName (kept in lockstep by the
-- TEST_NAME_FIXTURES anti-drift table + tests). `Nightly smoke fixture` is intentionally
-- NOT matched (operational fixture, deliberately visible — see
-- 20260621000002_evolution_nightly_smoke_fixture.sql).

BEGIN;

SET LOCAL statement_timeout = '60s';

-- ─── Updated IMMUTABLE predicate ────────────────────────────────────────────
-- Adds: '[TESTEVO]' (no underscore), and a broadened timestamp regex that matches a
-- 10-13 digit epoch bounded by start/end or any of `-`, `_`, space (so trailing and
-- space/underscore-delimited timestamps now count).
CREATE OR REPLACE FUNCTION evolution_is_test_name(name TEXT) RETURNS BOOLEAN
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT
    name IS NOT NULL AND (
      lower(name) = 'test'
      OR name ILIKE '%[TEST]%'
      OR name ILIKE '%[E2E]%'
      OR name ILIKE '%[TEST_EVO]%'
      OR name ILIKE '%[TESTEVO]%'
      OR name ~ '(^|[-_ ])\d{10,13}([-_ ]|$)'
    )
$$;

-- ─── Re-flag existing rows on every table carrying the column ────────────────
-- These UPDATEs set is_test_content only (not name), so the `BEFORE UPDATE OF name`
-- triggers do not fire. WHERE … IS DISTINCT FROM … keeps the write set minimal and
-- makes re-running the migration a no-op.
UPDATE evolution_strategies
  SET is_test_content = evolution_is_test_name(name)
  WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);

UPDATE evolution_prompts
  SET is_test_content = evolution_is_test_name(name)
  WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);

UPDATE evolution_experiments
  SET is_test_content = evolution_is_test_name(name)
  WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);

UPDATE evolution_criteria
  SET is_test_content = evolution_is_test_name(name)
  WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);

UPDATE evolution_judge_rubrics
  SET is_test_content = evolution_is_test_name(name)
  WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);

UPDATE evolution_style_fingerprints
  SET is_test_content = evolution_is_test_name(name)
  WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);

UPDATE evolution_weight_inference_sessions
  SET is_test_content = evolution_is_test_name(name)
  WHERE is_test_content IS DISTINCT FROM evolution_is_test_name(name);

COMMIT;
