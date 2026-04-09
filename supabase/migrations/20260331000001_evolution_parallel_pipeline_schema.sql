-- Schema additions for the parallelized evolution pipeline (generate_rank_evolution_parallel_20260331).
-- Adds:
--   1. evolution_variants.persisted boolean (with backfill of historical rows)
--   2. evolution_runs.iteration_snapshots JSONB
--   3. evolution_runs error fields (error_code, error_details, failed_at_iteration, failed_at_invocation)
--      NOTE: error_message already exists; not re-added.
--   4. evolution_runs.random_seed BIGINT for reproducibility
--   5. evolution_arena_comparisons in-run observability extensions (nullable prompt_id, iteration,
--      invocation_id, mu/sigma before/after for both entries) + indexes
--
-- Rollback strategy: each ALTER is reversible by dropping the column. The persisted backfill UPDATE
-- can be re-run. The arena_comparisons prompt_id NOT NULL constraint is dropped — restoring it would
-- require deleting in-run rows or backfilling a placeholder prompt_id.

-- ═══════════════════════════════════════════════════════════════════
-- 1. evolution_variants.persisted (with backfill)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE evolution_variants
  ADD COLUMN IF NOT EXISTS persisted BOOLEAN NOT NULL DEFAULT false;

-- Backfill: historical variants existed before the discard rule, so they are all "persisted".
-- This UPDATE marks every pre-existing row true so historical runs remain visible in admin queries
-- after metric/list call sites add `.eq('persisted', true)` filters. Idempotent on re-run.
UPDATE evolution_variants
   SET persisted = true
 WHERE persisted = false;

-- ═══════════════════════════════════════════════════════════════════
-- 2. evolution_runs.iteration_snapshots
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS iteration_snapshots JSONB DEFAULT '[]'::JSONB;

-- ═══════════════════════════════════════════════════════════════════
-- 3. evolution_runs error fields
-- ═══════════════════════════════════════════════════════════════════

-- error_message already exists on evolution_runs — do NOT re-add.
ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_details JSONB,
  ADD COLUMN IF NOT EXISTS failed_at_iteration INT,
  ADD COLUMN IF NOT EXISTS failed_at_invocation UUID
    REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 4. evolution_runs.random_seed
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS random_seed BIGINT;

-- ═══════════════════════════════════════════════════════════════════
-- 5. evolution_arena_comparisons in-run observability extension
-- ═══════════════════════════════════════════════════════════════════

-- Drop NOT NULL on prompt_id so MergeRatingsAgent can write in-run matches without an arena prompt.
ALTER TABLE evolution_arena_comparisons
  ALTER COLUMN prompt_id DROP NOT NULL;

ALTER TABLE evolution_arena_comparisons
  ADD COLUMN IF NOT EXISTS iteration INT,
  ADD COLUMN IF NOT EXISTS invocation_id UUID
    REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entry_a_mu_before NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_a_sigma_before NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_b_mu_before NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_b_sigma_before NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_a_mu_after NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_a_sigma_after NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_b_mu_after NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_b_sigma_after NUMERIC;

CREATE INDEX IF NOT EXISTS idx_arena_comparisons_run_iteration
  ON evolution_arena_comparisons (run_id, iteration);

CREATE INDEX IF NOT EXISTS idx_arena_comparisons_invocation
  ON evolution_arena_comparisons (invocation_id);

-- Partial index for the variant Matches admin tab (joins by entry_a or entry_b filtered to in-run).
CREATE INDEX IF NOT EXISTS idx_arena_comparisons_in_run
  ON evolution_arena_comparisons (run_id, iteration)
  WHERE prompt_id IS NULL;
