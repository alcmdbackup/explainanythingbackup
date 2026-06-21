-- Adds an `is_test` discriminator to llmCallTracking so the spending dashboard can separate
-- real spend from integration-test / mock pollution (research: ~90% of dev-DB rows are test
-- mock with fake inflated costs). Populated at insert by saveLlmCallTracking via isTestLlmCall;
-- historical rows backfilled by scripts/backfillLlmIsTest.ts.
-- Rollback: ALTER TABLE "llmCallTracking" DROP COLUMN IF EXISTS is_test;
--           DROP INDEX IF EXISTS idx_llmtracking_is_test_created;

-- Constant default → catalog-only change on PG 11+ (no table rewrite, no long lock).
ALTER TABLE "llmCallTracking" ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_llmtracking_is_test_created
  ON "llmCallTracking" (is_test, created_at);

COMMENT ON COLUMN "llmCallTracking".is_test IS
  'True when the row is integration-test/mock pollution rather than real spend (set at insert via isTestLlmCall; backfilled by scripts/backfillLlmIsTest.ts).';
