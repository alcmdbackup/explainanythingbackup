-- Atomic migration: rename 9 evolution tables, drop 3 unused tables, recreate RPCs,
-- rename FK constraints, and create backward-compatible views for zero-downtime deploy.

-- ============================================================
-- Part A: Rename tables
-- ============================================================
ALTER TABLE IF EXISTS content_evolution_runs RENAME TO evolution_runs;
ALTER TABLE IF EXISTS content_evolution_variants RENAME TO evolution_variants;
ALTER TABLE IF EXISTS hall_of_fame_topics RENAME TO evolution_hall_of_fame_topics;
ALTER TABLE IF EXISTS hall_of_fame_entries RENAME TO evolution_hall_of_fame_entries;
ALTER TABLE IF EXISTS hall_of_fame_comparisons RENAME TO evolution_hall_of_fame_comparisons;
ALTER TABLE IF EXISTS hall_of_fame_elo RENAME TO evolution_hall_of_fame_elo;
ALTER TABLE IF EXISTS strategy_configs RENAME TO evolution_strategy_configs;
ALTER TABLE IF EXISTS batch_runs RENAME TO evolution_batch_runs;
ALTER TABLE IF EXISTS agent_cost_baselines RENAME TO evolution_agent_cost_baselines;

-- ============================================================
-- Part B: Drop dead-code RPC (references content_history which is being dropped)
-- ============================================================
DROP FUNCTION IF EXISTS apply_evolution_winner(integer, uuid, uuid, uuid);

-- ============================================================
-- Part C: Drop unused tables (order matters: content_quality_scores has FK to content_eval_runs)
-- ============================================================
DROP TABLE IF EXISTS content_history;
DROP TABLE IF EXISTS content_quality_scores;
DROP TABLE IF EXISTS content_eval_runs;

-- ============================================================
-- Part D: Recreate RPCs with new table names
-- Must DROP + RECREATE (not just CREATE OR REPLACE) because:
-- - claim_evolution_run: RETURNS SETOF and %ROWTYPE reference the old table name in signature
-- - checkpoint_and_continue: UPDATE references old name as string literal in PL/pgSQL
-- - update_strategy_aggregates: SELECT/UPDATE on strategy_configs (now evolution_strategy_configs)
-- ============================================================

-- D.0: Drop stale 6-arg overload of checkpoint_and_continue if it exists
-- (Migration 20260216000001 created 6-arg version, 20260220000001 added 7-arg overload.
-- CREATE OR REPLACE with different arg count creates a new function, not a replacement.)
DROP FUNCTION IF EXISTS checkpoint_and_continue(UUID, INT, TEXT, JSONB, INT, NUMERIC);

-- D.1: claim_evolution_run — full DROP+RECREATE (signature changes from RETURNS SETOF content_evolution_runs → evolution_runs)
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT);
CREATE OR REPLACE FUNCTION claim_evolution_run(p_runner_id TEXT)
RETURNS SETOF evolution_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run evolution_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM evolution_runs
  WHERE status IN ('pending', 'continuation_pending')
  ORDER BY
    CASE WHEN status = 'continuation_pending' THEN 0 ELSE 1 END,
    created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE evolution_runs
  SET status = 'claimed',
      runner_id = p_runner_id,
      last_heartbeat = NOW(),
      started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN NEXT v_run;
END;
$$;

-- D.2: checkpoint_and_continue — CREATE OR REPLACE (signature unchanged, body references new table)
CREATE OR REPLACE FUNCTION checkpoint_and_continue(
  p_run_id UUID,
  p_iteration INT,
  p_phase TEXT,
  p_state_snapshot JSONB,
  p_pool_length INT DEFAULT 0,
  p_total_cost_usd NUMERIC DEFAULT NULL,
  p_last_agent TEXT DEFAULT 'iteration_complete'
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO evolution_checkpoints (run_id, iteration, phase, last_agent, state_snapshot, created_at)
  VALUES (p_run_id, p_iteration, p_phase, p_last_agent, p_state_snapshot, NOW())
  ON CONFLICT (run_id, iteration, last_agent)
  DO UPDATE SET state_snapshot = EXCLUDED.state_snapshot,
               phase = EXCLUDED.phase,
               created_at = NOW();

  UPDATE evolution_runs
  SET status = 'continuation_pending',
      runner_id = NULL,
      continuation_count = continuation_count + 1,
      current_iteration = p_iteration,
      phase = p_phase,
      last_heartbeat = NOW(),
      runner_agents_completed = p_pool_length,
      total_cost_usd = COALESCE(p_total_cost_usd, total_cost_usd)
  WHERE id = p_run_id
    AND status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run % is not in running status, cannot transition to continuation_pending', p_run_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- D.3: update_strategy_aggregates — CREATE OR REPLACE (signature unchanged, body references new table)
CREATE OR REPLACE FUNCTION update_strategy_aggregates(
  p_strategy_id UUID,
  p_cost_usd NUMERIC,
  p_final_elo NUMERIC
) RETURNS VOID AS $$
DECLARE
  v_stats RECORD;
BEGIN
  SET LOCAL statement_timeout = '5s';

  SELECT run_count, total_cost_usd, avg_final_elo, best_final_elo, worst_final_elo
  INTO v_stats
  FROM evolution_strategy_configs
  WHERE id = p_strategy_id
  FOR UPDATE;

  UPDATE evolution_strategy_configs SET
    run_count = COALESCE(v_stats.run_count, 0) + 1,
    total_cost_usd = COALESCE(v_stats.total_cost_usd, 0) + p_cost_usd,
    avg_final_elo = (COALESCE(v_stats.avg_final_elo * v_stats.run_count, 0) + p_final_elo) / (COALESCE(v_stats.run_count, 0) + 1),
    avg_elo_per_dollar = CASE
      WHEN COALESCE(v_stats.total_cost_usd, 0) + p_cost_usd > 0
      THEN ((COALESCE(v_stats.avg_final_elo * v_stats.run_count, 0) + p_final_elo) / (COALESCE(v_stats.run_count, 0) + 1) - 1200)
           / (COALESCE(v_stats.total_cost_usd, 0) + p_cost_usd)
      ELSE NULL
    END,
    best_final_elo = GREATEST(COALESCE(v_stats.best_final_elo, p_final_elo), p_final_elo),
    worst_final_elo = LEAST(COALESCE(v_stats.worst_final_elo, p_final_elo), p_final_elo),
    last_used_at = NOW()
  WHERE id = p_strategy_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Part E: Rename FK constraints (old article_bank_* prefix → evolution_*)
-- ============================================================
ALTER TABLE IF EXISTS evolution_hall_of_fame_entries
  RENAME CONSTRAINT article_bank_entries_evolution_run_id_fkey
  TO evolution_hall_of_fame_entries_evolution_run_id_fkey;

ALTER TABLE IF EXISTS evolution_hall_of_fame_entries
  RENAME CONSTRAINT article_bank_entries_topic_id_fkey
  TO evolution_hall_of_fame_entries_topic_id_fkey;

ALTER TABLE IF EXISTS evolution_hall_of_fame_comparisons
  RENAME CONSTRAINT article_bank_comparisons_topic_id_fkey
  TO evolution_hall_of_fame_comparisons_topic_id_fkey;

ALTER TABLE IF EXISTS evolution_hall_of_fame_elo
  RENAME CONSTRAINT article_bank_elo_topic_id_fkey
  TO evolution_hall_of_fame_elo_topic_id_fkey;

-- ============================================================
-- Part F: Backward-compatible views (old names → new tables)
-- These keep old code working during the Vercel deploy window.
-- Will be dropped in a follow-up migration after code deploy is confirmed.
-- ============================================================
CREATE OR REPLACE VIEW content_evolution_runs AS SELECT * FROM evolution_runs;
CREATE OR REPLACE VIEW content_evolution_variants AS SELECT * FROM evolution_variants;
CREATE OR REPLACE VIEW hall_of_fame_topics AS SELECT * FROM evolution_hall_of_fame_topics;
CREATE OR REPLACE VIEW hall_of_fame_entries AS SELECT * FROM evolution_hall_of_fame_entries;
CREATE OR REPLACE VIEW hall_of_fame_comparisons AS SELECT * FROM evolution_hall_of_fame_comparisons;
CREATE OR REPLACE VIEW hall_of_fame_elo AS SELECT * FROM evolution_hall_of_fame_elo;
CREATE OR REPLACE VIEW strategy_configs AS SELECT * FROM evolution_strategy_configs;
CREATE OR REPLACE VIEW batch_runs AS SELECT * FROM evolution_batch_runs;
CREATE OR REPLACE VIEW agent_cost_baselines AS SELECT * FROM evolution_agent_cost_baselines;

-- ============================================================
-- Part G: Force PostgREST schema cache refresh
-- Without this, PostgREST may take up to ~60s to see the new views.
-- ============================================================
NOTIFY pgrst, 'reload schema';
