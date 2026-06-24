-- Scope the EVOLUTION_MAX_CONCURRENT_RUNS cap to QUEUE claims only.
--
-- Background: claim_evolution_run() applies a global concurrency check BEFORE
-- the targeted-claim logic. When >= p_max_concurrent runs are in 'claimed' or
-- 'running' status, the RPC returns empty for EVERY caller — including E2E
-- tests that pass p_run_id (an explicit targeted claim).
--
-- This is wrong for two reasons:
--   1. The cap exists to throttle QUEUE consumption (the unparameterized
--      `pick the oldest pending run` path) so workers don't pile up beyond
--      what the LLM provider / DB can absorb. A targeted claim names exactly
--      ONE row by id; it cannot grow the parallel-run load beyond that one.
--   2. Concurrent CI runs on shared staging (multiple PR branches in flight)
--      regularly push the active-run count above 5, silently breaking every
--      cross-branch E2E test that targets a known runId. The symptom is
--      `result.claimed: false` with no error_message on a row that's still
--      in 'pending' status. This silently flakes whenever staging is busy.
--
-- Fix: skip the concurrency check entirely when p_run_id IS NOT NULL. The
-- targeted-claim path still respects pending-status / row-existence / stale-
-- expiry semantics — it just doesn't gate on the queue cap.
--
-- Investigated by: investigate_iterative_editing_runs_stage_20260623.

BEGIN;

CREATE OR REPLACE FUNCTION claim_evolution_run(
  p_runner_id TEXT,
  p_run_id UUID DEFAULT NULL,
  p_max_concurrent INT DEFAULT 5
)
RETURNS SETOF evolution_runs AS $$
DECLARE
  v_stale_threshold INTERVAL := interval '10 minutes';
BEGIN
  -- Advisory lock serializes all claim attempts (global lock, acceptable bottleneck for <=5 runners)
  PERFORM pg_advisory_xact_lock(hashtext('evolution_claim'));

  -- Expire stale claimed/running runs before checking concurrency.
  -- Handles both null heartbeat (old claim function) and stale heartbeat.
  UPDATE evolution_runs
  SET status = 'failed',
      error_message = 'stale claim auto-expired by claim_evolution_run',
      runner_id = NULL
  WHERE status IN ('claimed', 'running')
    AND (
      (last_heartbeat IS NOT NULL AND last_heartbeat < now() - v_stale_threshold)
      OR
      (last_heartbeat IS NULL AND created_at < now() - v_stale_threshold)
    );

  -- Concurrency cap applies to QUEUE claims only (p_run_id IS NULL).
  -- Targeted claims (p_run_id provided) always bypass — they cannot grow the
  -- parallel-run load beyond the single row they name and are used by E2E
  -- tests + admin "run now" triggers that need to succeed deterministically
  -- regardless of how busy the queue is.
  IF p_run_id IS NULL THEN
    IF (SELECT count(*) FROM evolution_runs WHERE status IN ('claimed', 'running')) >= p_max_concurrent THEN
      RETURN;
    END IF;
  END IF;

  -- GATE: skip is_test_content strategies on QUEUE claims (p_run_id IS NULL),
  -- bypass on TARGETED claims or explicit per-run opt-in.
  -- INNER JOIN (not LEFT JOIN) because evolution_runs.strategy_id is NOT NULL —
  -- LEFT JOIN trips "FOR UPDATE cannot be applied to the nullable side of an outer join".
  RETURN QUERY
  UPDATE evolution_runs SET status = 'claimed', runner_id = p_runner_id, last_heartbeat = now()
  WHERE id = (
    SELECT r.id
    FROM evolution_runs r
    JOIN evolution_strategies s ON s.id = r.strategy_id
    WHERE r.status = 'pending'
      AND (
        p_run_id IS NOT NULL                  -- targeted claim: bypass gate
        OR NOT s.is_test_content              -- queue claim: real strategy
        OR r.allow_test_execution = true      -- queue claim: per-run opt-in
      )
      AND (p_run_id IS NULL OR r.id = p_run_id)
    ORDER BY r.created_at ASC LIMIT 1
    FOR UPDATE OF r SKIP LOCKED
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID, INT) TO service_role;

COMMIT;
