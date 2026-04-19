-- Down migration for 20260415000001_evolution_is_test_content.sql.
-- Only apply if the forward migration must be rolled back (application revert is
-- usually enough since the column + function are additive and no code breaks when
-- they're simply ignored by old callers).

BEGIN;

DROP INDEX IF EXISTS idx_strategies_non_test;

DROP TRIGGER IF EXISTS evolution_strategies_set_is_test_content_tg ON evolution_strategies;
DROP FUNCTION IF EXISTS evolution_strategies_set_is_test_content();

ALTER TABLE evolution_strategies DROP COLUMN IF EXISTS is_test_content;

DROP FUNCTION IF EXISTS evolution_is_test_name(TEXT);

COMMIT;
