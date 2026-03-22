-- Fresh evolution schema: documents the current state of evolution tables on staging.
-- This migration is idempotent — it uses IF NOT EXISTS / CREATE OR REPLACE throughout.
-- Scope: STAGING ONLY. A separate migration will converge prod to match staging.
--
-- Context: The evolution migration history accumulated ~48 migrations across V1→V2,
-- with a clean-slate wipe (20260315) that created discontinuities. This migration
-- documents the current staging state as the single source of truth.
--
-- Rollback: This migration is almost entirely no-ops on staging. The only real changes are:
--   1. DROP FUNCTION checkpoint_and_continue(UUID, JSONB) — legacy V1 function
--   2. ADD RLS policies on evolution_explanations (deny_all + service_role_all)
--   3. RECREATE service_role_all policies on 8 other tables (functionally identical)
-- To rollback: no action needed — the dropped function is unused, and the RLS policies
-- are strictly additive (fixing a security gap, not breaking access).

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 1: DROP legacy objects that should not exist on staging
-- ═══════════════════════════════════════════════════════════════════

-- Drop V1 tables (already gone on staging, but explicit for documentation)
DROP TABLE IF EXISTS evolution_checkpoints CASCADE;
DROP TABLE IF EXISTS evolution_run_agent_metrics CASCADE;
DROP TABLE IF EXISTS evolution_agent_cost_baselines CASCADE;
DROP TABLE IF EXISTS evolution_experiment_rounds CASCADE;
DROP TABLE IF EXISTS evolution_arena_elo CASCADE;
DROP TABLE IF EXISTS evolution_batch_runs CASCADE;
DROP TABLE IF EXISTS evolution_budget_events CASCADE;
DROP TABLE IF EXISTS evolution_arena_batch_runs CASCADE;

-- NOTE: evolution_arena_entries was consolidated into evolution_variants
-- by migration 20260321000002. It no longer exists on staging.
-- Do NOT drop it here — prod still has it and needs a separate data migration.

-- Drop legacy RPCs (checkpoint_and_continue is the only one still on staging)
DROP FUNCTION IF EXISTS apply_evolution_winner(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS compute_run_variant_stats(UUID);
DROP FUNCTION IF EXISTS checkpoint_and_continue(UUID, JSONB);
DROP FUNCTION IF EXISTS get_non_archived_runs();
DROP FUNCTION IF EXISTS archive_experiment(UUID);
DROP FUNCTION IF EXISTS unarchive_experiment(UUID);
DROP FUNCTION IF EXISTS checkpoint_pruning_rpc(UUID, INT);
DROP FUNCTION IF EXISTS get_latest_checkpoint_ids_per_iteration(UUID);

-- Drop legacy views (already gone on staging)
DROP VIEW IF EXISTS content_evolution_runs CASCADE;
DROP VIEW IF EXISTS content_evolution_variants CASCADE;
DROP VIEW IF EXISTS hall_of_fame_entries CASCADE;
DROP VIEW IF EXISTS hall_of_fame_comparisons CASCADE;
DROP VIEW IF EXISTS strategy_configs CASCADE;
DROP VIEW IF EXISTS batch_runs CASCADE;
DROP VIEW IF EXISTS agent_cost_baselines CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 2: DOCUMENT current table state
-- On staging, all tables already have correct names and columns.
-- These statements are no-ops but serve as documentation.
-- ═══════════════════════════════════════════════════════════════════

-- evolution_prompts: drop V1 columns if present (already gone on staging)
ALTER TABLE evolution_prompts DROP COLUMN IF EXISTS difficulty_tier;
ALTER TABLE evolution_prompts DROP COLUMN IF EXISTS domain_tags;

-- evolution_variants: drop dead columns (already gone on staging)
ALTER TABLE evolution_variants DROP COLUMN IF EXISTS elo_attribution;

-- NOTE: Known drift NOT fixed by this migration (deferred to separate work):
-- - evolution_runs.evolution_explanation_id is missing (lost during V2 wipe)
-- - evolution_experiments.evolution_explanation_id is missing (same)
-- - evolution_explanations.prompt_id has no FK to evolution_prompts (orphaned during V2 drop)

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 3: INDEXES (idempotent — IF NOT EXISTS)
-- All indexes already exist on staging. This documents the expected set.
-- ═══════════════════════════════════════════════════════════════════

-- Runs
CREATE INDEX IF NOT EXISTS idx_runs_pending_claim ON evolution_runs (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_runs_heartbeat_stale ON evolution_runs (last_heartbeat) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_runs_experiment ON evolution_runs (experiment_id) WHERE experiment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runs_strategy ON evolution_runs (strategy_id) WHERE strategy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runs_archived ON evolution_runs (archived, status);

-- Variants (includes arena indexes from consolidation migration 20260321000002)
CREATE INDEX IF NOT EXISTS idx_variants_run ON evolution_variants (run_id);
CREATE INDEX IF NOT EXISTS idx_variants_winner ON evolution_variants (run_id) WHERE is_winner = true;
CREATE INDEX IF NOT EXISTS idx_variants_arena_prompt ON evolution_variants (prompt_id, mu DESC) WHERE synced_to_arena = true AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_variants_arena_active ON evolution_variants (prompt_id) WHERE synced_to_arena = true AND archived_at IS NULL;

-- Agent invocations
CREATE INDEX IF NOT EXISTS idx_invocations_run ON evolution_agent_invocations (run_id, iteration);
CREATE INDEX IF NOT EXISTS idx_invocations_run_cost ON evolution_agent_invocations (run_id, cost_usd);

-- Run logs
CREATE INDEX IF NOT EXISTS idx_logs_run_created ON evolution_run_logs (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_run_iteration ON evolution_run_logs (run_id, iteration);
CREATE INDEX IF NOT EXISTS idx_logs_run_agent ON evolution_run_logs (run_id, agent_name);
CREATE INDEX IF NOT EXISTS idx_logs_run_variant ON evolution_run_logs (run_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_logs_run_level ON evolution_run_logs (run_id, level);

-- Arena comparisons
CREATE INDEX IF NOT EXISTS idx_arena_comparisons_prompt ON evolution_arena_comparisons (prompt_id, created_at DESC);

-- Experiments
CREATE INDEX IF NOT EXISTS idx_experiments_status ON evolution_experiments (status);

-- Explanations
CREATE INDEX IF NOT EXISTS idx_evolution_explanations_explanation_id ON evolution_explanations (explanation_id) WHERE explanation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evolution_explanations_prompt_id ON evolution_explanations (prompt_id) WHERE prompt_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 4: RLS POLICIES (idempotent)
-- Fixes evolution_explanations which has NO RLS policies (security gap).
-- Recreates service_role_all on other tables for consistency.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'evolution_strategies',
    'evolution_prompts',
    'evolution_experiments',
    'evolution_runs',
    'evolution_variants',
    'evolution_agent_invocations',
    'evolution_run_logs',
    'evolution_explanations',
    'evolution_arena_comparisons'
  ] LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- deny_all policy
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = tbl AND policyname = 'deny_all') THEN
      EXECUTE format('CREATE POLICY deny_all ON %I FOR ALL USING (false) WITH CHECK (false)', tbl);
    END IF;

    -- service_role_all policy
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', tbl);
    EXECUTE format('CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl);
  END LOOP;

  -- readonly_select for readonly_local role (if it exists)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
    FOREACH tbl IN ARRAY ARRAY[
      'evolution_strategies',
      'evolution_prompts',
      'evolution_experiments',
      'evolution_runs',
      'evolution_variants',
      'evolution_agent_invocations',
      'evolution_run_logs',
      'evolution_explanations',
      'evolution_arena_comparisons'
    ] LOOP
      EXECUTE format('DROP POLICY IF EXISTS readonly_select ON %I', tbl);
      EXECUTE format('CREATE POLICY readonly_select ON %I FOR SELECT TO readonly_local USING (true)', tbl);
    END LOOP;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 5: RPCs (CREATE OR REPLACE — idempotent)
-- All RPCs already exist with correct bodies on staging.
-- This documents them and ensures consistency.
-- ═══════════════════════════════════════════════════════════════════

-- Drop old function signatures that may conflict
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT);
DROP FUNCTION IF EXISTS sync_to_arena(UUID, UUID, JSONB, JSONB, JSONB);

-- claim_evolution_run: Atomic claim with FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE evolution_runs
  SET status = 'claimed', runner_id = p_runner_id, last_heartbeat = now()
  WHERE id = (
    SELECT id FROM evolution_runs
    WHERE status = 'pending'
      AND (p_run_id IS NULL OR id = p_run_id)
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID) TO service_role;

-- update_strategy_aggregates: Update metrics after run finalization
CREATE OR REPLACE FUNCTION update_strategy_aggregates(
  p_strategy_id UUID,
  p_cost_usd NUMERIC,
  p_final_elo NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE evolution_strategies
  SET
    run_count = run_count + 1,
    total_cost_usd = total_cost_usd + COALESCE(p_cost_usd, 0),
    avg_final_elo = CASE
      WHEN run_count = 0 THEN p_final_elo
      ELSE (avg_final_elo * run_count + p_final_elo) / (run_count + 1)
    END,
    best_final_elo = GREATEST(COALESCE(best_final_elo, p_final_elo), p_final_elo),
    worst_final_elo = LEAST(COALESCE(worst_final_elo, p_final_elo), p_final_elo),
    last_used_at = now()
  WHERE id = p_strategy_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_strategy_aggregates(UUID, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_strategy_aggregates(UUID, NUMERIC, NUMERIC) TO service_role;

-- sync_to_arena: Upsert variants + insert comparisons (targets evolution_variants)
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_prompt_id UUID,
  p_run_id UUID,
  p_entries JSONB,
  p_matches JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entry JSONB;
  match JSONB;
BEGIN
  IF jsonb_array_length(p_entries) > 200 THEN
    RAISE EXCEPTION 'p_entries exceeds maximum of 200 elements';
  END IF;
  IF jsonb_array_length(p_matches) > 1000 THEN
    RAISE EXCEPTION 'p_matches exceeds maximum of 1000 elements';
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO evolution_variants (
      id, prompt_id, synced_to_arena, run_id, variant_content,
      mu, sigma, elo_score, arena_match_count, generation_method, created_at
    )
    VALUES (
      (entry->>'id')::UUID,
      p_prompt_id,
      true,
      p_run_id,
      COALESCE(entry->>'variant_content', ''),
      COALESCE((entry->>'mu')::NUMERIC, 25),
      COALESCE((entry->>'sigma')::NUMERIC, 8.333),
      COALESCE((entry->>'elo_score')::NUMERIC, 1200),
      0,
      COALESCE(entry->>'generation_method', 'pipeline'),
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      synced_to_arena = true,
      mu = COALESCE((entry->>'mu')::NUMERIC, evolution_variants.mu),
      sigma = COALESCE((entry->>'sigma')::NUMERIC, evolution_variants.sigma),
      elo_score = COALESCE((entry->>'elo_score')::NUMERIC, evolution_variants.elo_score),
      arena_match_count = COALESCE((entry->>'arena_match_count')::INT, evolution_variants.arena_match_count),
      generation_method = COALESCE(entry->>'generation_method', evolution_variants.generation_method);
  END LOOP;

  FOR match IN SELECT * FROM jsonb_array_elements(p_matches)
  LOOP
    INSERT INTO evolution_arena_comparisons (prompt_id, entry_a, entry_b, winner, confidence, run_id)
    VALUES (
      p_prompt_id,
      (match->>'entry_a')::UUID,
      (match->>'entry_b')::UUID,
      match->>'winner',
      COALESCE((match->>'confidence')::NUMERIC, 0),
      p_run_id
    );
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_to_arena(UUID, UUID, JSONB, JSONB) TO service_role;

-- cancel_experiment: Atomically cancel experiment + fail its runs
CREATE OR REPLACE FUNCTION cancel_experiment(p_experiment_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE evolution_experiments
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_experiment_id AND status = 'running';

  UPDATE evolution_runs
  SET status = 'failed', error_message = 'Experiment cancelled', completed_at = now()
  WHERE experiment_id = p_experiment_id AND status IN ('pending', 'claimed', 'running');
END;
$$;

REVOKE EXECUTE ON FUNCTION cancel_experiment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_experiment(UUID) TO service_role;

-- get_run_total_cost: Sum cost from invocations
CREATE OR REPLACE FUNCTION get_run_total_cost(p_run_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(cost_usd), 0) FROM evolution_agent_invocations WHERE run_id = p_run_id;
$$;

REVOKE ALL ON FUNCTION get_run_total_cost(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_run_total_cost(UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- PHASE 6: VIEW (CREATE OR REPLACE)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW evolution_run_costs AS
  SELECT run_id, COALESCE(SUM(cost_usd), 0) AS total_cost_usd
  FROM evolution_agent_invocations
  GROUP BY run_id;

REVOKE ALL ON evolution_run_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON evolution_run_costs TO service_role;
