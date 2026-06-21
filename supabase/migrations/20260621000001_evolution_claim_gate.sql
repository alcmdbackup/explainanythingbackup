-- Gates the evolution-runner queue claim on `evolution_strategies.is_test_content`
-- to stop the minicomputer's systemd timer from silently claiming and executing
-- E2E-test-inserted pending evolution_runs (which has been burning ~$15/week of
-- real LLM money on staging).
--
-- The gate has three OR branches in the inner SELECT:
--   1. p_run_id IS NOT NULL  → targeted claim (caller is explicit; bypass gate)
--   2. NOT s.is_test_content → queue claim on real strategies (normal path)
--   3. r.allow_test_execution = true → per-run opt-in for integration tests that
--      need to exercise queue-claim semantics with mocked LLM
--
-- Adds the `allow_test_execution` column on `evolution_runs` (NOT NULL DEFAULT false)
-- so existing rows + future inserts that don't set it stay safe by default.
--
-- All other behaviors preserved exactly from 20260323000002_fix_stale_claim_expiry.sql:
-- SECURITY DEFINER, advisory lock, stale-claim expiry, p_max_concurrent enforcement,
-- REVOKE/GRANT.

BEGIN;

ALTER TABLE evolution_runs
  ADD COLUMN IF NOT EXISTS allow_test_execution boolean NOT NULL DEFAULT false;

-- Drop both overloads to avoid ambiguity, then recreate the canonical version.
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID);
DROP FUNCTION IF EXISTS claim_evolution_run(TEXT, UUID, INT);

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

  -- Atomic count check inside the lock
  IF (SELECT count(*) FROM evolution_runs WHERE status IN ('claimed', 'running')) >= p_max_concurrent THEN
    RETURN;
  END IF;

  -- NEW GATE: skip is_test_content strategies on QUEUE claims (p_run_id IS NULL),
  -- bypass on TARGETED claims or explicit per-run opt-in.
  RETURN QUERY
  UPDATE evolution_runs SET status = 'claimed', runner_id = p_runner_id, last_heartbeat = now()
  WHERE id = (
    SELECT r.id
    FROM evolution_runs r
    LEFT JOIN evolution_strategies s ON s.id = r.strategy_id
    WHERE r.status = 'pending'
      AND (
        p_run_id IS NOT NULL                              -- targeted claim: explicit caller, bypass gate
        OR NOT COALESCE(s.is_test_content, false)        -- queue claim: real strategy
        OR r.allow_test_execution = true                  -- queue claim: per-run opt-in
      )
      AND (p_run_id IS NULL OR r.id = p_run_id)
    ORDER BY r.created_at ASC LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-apply access control (DROP removes grants; default is PUBLIC which would allow privilege escalation)
REVOKE EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_evolution_run(TEXT, UUID, INT) TO service_role;

COMMIT;

-- The new evolution_runs.allow_test_execution column needs to surface in PostgREST
-- schema cache for TypeScript-typed selects. NOTIFY runs outside the transaction.
NOTIFY pgrst, 'reload schema';
