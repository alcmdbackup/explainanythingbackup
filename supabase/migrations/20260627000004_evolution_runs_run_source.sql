-- Phase 1 of build_website_for_evolutiOn_20260626: add `run_source` provenance
-- column to evolution_runs.
--
-- WHY: the new public /edit surface needs to be distinguishable in cost
-- dashboards, admin lists, and future per-source policies (cleanup TTL, priority
-- lanes). Historical rows are backfilled via runner_id heuristics:
--   - runner_id LIKE 'v2-%'  → 'minicomputer' (processRunQueue.ts pattern)
--   - runner_id LIKE 'api-%' → 'admin'        (route.ts admin "Trigger Run")
--   - runner_id IS NULL      → 'local'        (run-evolution-local.ts pattern)
--   - everything else stays at the column DEFAULT 'admin'
--
-- All NEW insert sites must explicitly set run_source. NOT NULL DEFAULT 'admin'
-- catches missed sites with a small cost-attribution caveat (test fixtures
-- without an explicit run_source bill as admin runs) — accepted for v1.
--
-- ROLLBACK:
-- ALTER TABLE evolution_runs DROP CONSTRAINT IF EXISTS evolution_runs_run_source_check;
-- ALTER TABLE evolution_runs DROP COLUMN IF EXISTS run_source;

ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS run_source TEXT NOT NULL DEFAULT 'admin';

-- Allowed values: admin, minicomputer, public_edit, test, local
-- (test = E2E/integration fixtures; local = run-evolution-local.ts CLI)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'evolution_runs_run_source_check'
  ) THEN
    ALTER TABLE evolution_runs
      ADD CONSTRAINT evolution_runs_run_source_check
      CHECK (run_source IN ('admin', 'minicomputer', 'public_edit', 'test', 'local'));
  END IF;
END $$;

COMMENT ON COLUMN evolution_runs.run_source IS
  'Provenance of this run. admin = Trigger Run / API route; minicomputer = processRunQueue.ts; public_edit = /edit POST; test = E2E/integration fixture; local = run-evolution-local.ts CLI.';

-- Backfill historical rows by runner_id prefix
UPDATE evolution_runs SET run_source = 'minicomputer'
  WHERE runner_id LIKE 'v2-%' AND run_source = 'admin';

UPDATE evolution_runs SET run_source = 'admin'
  WHERE runner_id LIKE 'api-%' AND run_source = 'admin';

UPDATE evolution_runs SET run_source = 'local'
  WHERE runner_id IS NULL AND run_source = 'admin';
