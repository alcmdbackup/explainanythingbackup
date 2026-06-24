-- Forward-fix for 20260623000001: revert the timestamp-pattern broadening, keep [TESTEVO].
--
-- 20260623000001 broadened the epoch match to space/underscore/trailing delimiters to also
-- catch gate-verification run names like `Gate verify real 1782140234529_7fe0bd`. But that
-- over-flags legitimate auto-suffixed names — a space-before epoch is structurally identical
-- between a gate run and a real name (e.g. `Real Prompt 1781926024392_a9sxoe`), which broke
-- two existing integration tests (evolution-test-content-filter, evolution-weight-inference)
-- whose "real" fixtures use `Name <Date.now()>_<rand>`.
--
-- This reverts evolution_is_test_name's timestamp rule to the original HYPHEN-delimited
-- `^.*-\d{10,13}-.*$` while KEEPING the `[TESTEVO]` bracket match (the actual high-volume
-- canary leak from finding #1/#9). The `[TESTEVO]-…` canaries are caught by the bracket rule
-- regardless of their timestamp, so dropping the space/trailing broadening loses only the
-- minor `Gate verify real …` case (acceptable — it can't be caught without over-matching).
--
-- Since 20260623000001 already applied to staging, this is a forward-only CREATE OR REPLACE
-- + re-backfill of the 7 tables (re-flagging the over-matched rows back to false).
-- Mirrors evolution/src/services/shared.ts:isTestContentName.

BEGIN;

SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION evolution_is_test_name(name TEXT) RETURNS BOOLEAN
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT
    name IS NOT NULL AND (
      lower(name) = 'test'
      OR name ILIKE '%[TEST]%'
      OR name ILIKE '%[E2E]%'
      OR name ILIKE '%[TEST_EVO]%'
      OR name ILIKE '%[TESTEVO]%'
      OR name ~ '^.*-\d{10,13}-.*$'
    )
$$;

-- Re-flag every table carrying the column (UPDATEs touch is_test_content only, so the
-- BEFORE UPDATE OF name triggers do not fire; IS DISTINCT FROM keeps re-runs no-ops).
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
