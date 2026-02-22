-- Experiment orchestration tables for automated Elo optimization.
-- Rollback: DROP TABLE IF EXISTS evolution_experiment_rounds; DROP TABLE IF EXISTS evolution_experiments;
-- (rounds table must be dropped first due to FK dependency)

-- ─── Experiment root table ─────────────────────────────────────────
CREATE TABLE evolution_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'round_running', 'round_analyzing',
                      'pending_next_round', 'converged', 'budget_exhausted',
                      'max_rounds', 'failed', 'cancelled')),
  optimization_target TEXT NOT NULL DEFAULT 'elo'
    CHECK (optimization_target IN ('elo', 'elo_per_dollar')),
  total_budget_usd NUMERIC(10, 2) NOT NULL,
  spent_usd NUMERIC(10, 4) DEFAULT 0,
  max_rounds INT NOT NULL DEFAULT 5,
  current_round INT DEFAULT 0,
  convergence_threshold NUMERIC(8, 4) DEFAULT 10.0,
  factor_definitions JSONB NOT NULL,
  prompts TEXT[] NOT NULL,
  config_defaults JSONB,
  results_summary JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Cron queries by status every 60s; matches idx_batch_runs_status precedent
CREATE INDEX idx_experiments_status ON evolution_experiments(status);
CREATE INDEX idx_experiments_created_at ON evolution_experiments(created_at DESC);

-- No RLS — accessed only via service role (requireAdmin / requireCronAuth)

-- ─── Per-round tracking table ──────────────────────────────────────
CREATE TABLE evolution_experiment_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES evolution_experiments(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('screening', 'refinement')),
  design TEXT NOT NULL CHECK (design IN ('L8', 'full-factorial')),
  factor_definitions JSONB NOT NULL,
  locked_factors JSONB,
  batch_run_id UUID REFERENCES evolution_batch_runs(id),
  analysis_results JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (experiment_id, round_number)
);
-- Composite UNIQUE on (experiment_id, round_number) serves as index on experiment_id (leading col)
