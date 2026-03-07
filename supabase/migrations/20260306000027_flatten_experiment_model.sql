-- Flatten experiment data model: Experiment → Run (removing Round and Batch intermediaries).
-- Adds experiment_id FK on runs, absorbs round fields into experiments, drops round/batch tables.

-- 1. Add experiment_id FK to evolution_runs
ALTER TABLE evolution_runs
  ADD COLUMN experiment_id UUID REFERENCES evolution_experiments(id);
CREATE INDEX idx_evolution_runs_experiment ON evolution_runs(experiment_id);

-- 2. Backfill experiment_id from batch_run_id → round → experiment
UPDATE evolution_runs r SET experiment_id = er.experiment_id
FROM evolution_experiment_rounds er
WHERE er.batch_run_id = r.batch_run_id AND r.batch_run_id IS NOT NULL;

-- 3. Add design + analysis_results to experiments (absorbed from rounds)
ALTER TABLE evolution_experiments
  ADD COLUMN IF NOT EXISTS design TEXT DEFAULT 'L8'
    CHECK (design IN ('L8', 'full-factorial')),
  ADD COLUMN IF NOT EXISTS analysis_results JSONB;

-- 4. Backfill design from first round (if any data exists)
UPDATE evolution_experiments e
SET design = COALESCE(
  (SELECT r.design FROM evolution_experiment_rounds r WHERE r.experiment_id = e.id LIMIT 1),
  'L8'
);

-- 5. Drop old status constraint FIRST (so backfill can write new values)
ALTER TABLE evolution_experiments
  DROP CONSTRAINT IF EXISTS evolution_experiments_status_check;

-- 6. Backfill old statuses to new values
UPDATE evolution_experiments SET status = 'running' WHERE status IN ('round_running', 'pending_next_round');
UPDATE evolution_experiments SET status = 'analyzing' WHERE status = 'round_analyzing';
UPDATE evolution_experiments SET status = 'completed' WHERE status IN ('converged', 'budget_exhausted', 'max_rounds');

-- 7. Add new status constraint (after backfill)
ALTER TABLE evolution_experiments
  ADD CONSTRAINT evolution_experiments_status_check
  CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed', 'cancelled'));

-- 8. Drop unused columns from experiments
ALTER TABLE evolution_experiments
  DROP COLUMN IF EXISTS current_round,
  DROP COLUMN IF EXISTS max_rounds;

-- 9. Drop batch_run_id from runs, drop stale views
ALTER TABLE evolution_runs DROP COLUMN IF EXISTS batch_run_id;
DROP VIEW IF EXISTS batch_runs CASCADE;

-- 10. Drop intermediate tables
DROP TABLE IF EXISTS evolution_experiment_rounds CASCADE;
DROP TABLE IF EXISTS evolution_batch_runs CASCADE;
