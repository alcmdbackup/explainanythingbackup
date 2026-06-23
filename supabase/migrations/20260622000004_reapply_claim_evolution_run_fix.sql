-- Re-apply the claim_evolution_run "FOR UPDATE / outer join" fix.
--
-- WHY THIS EXISTS (generate_enforce_style_fingerprint_evolution_20260620):
-- This branch's original migration shared version 20260621000001 with main's
-- 20260621000001_evolution_claim_gate.sql. Because this branch's migration deployed to
-- staging FIRST (recording version 20260621000001), main's claim_gate could never deploy
-- there, and reconciling the collision (reverting the phantom ledger row, then letting
-- claim_gate deploy) SCRAMBLED the deploy order on staging: claim_gate (buggy
-- LEFT JOIN + FOR UPDATE) re-applied AFTER 20260622000001_evolution_claim_gate_fix_for_update_join
-- had already run, leaving staging's claim_evolution_run on the pre-fix (broken) version.
--
-- Fresh databases (e.g. production) are unaffected — claim_gate then claim_gate_fix apply in
-- version order, ending on the fixed function; this migration then re-applies the identical
-- definition as a harmless no-op. On staging it restores the fixed function.
--
-- The function body below is COPIED VERBATIM from
-- 20260622000001_evolution_claim_gate_fix_for_update_join.sql to avoid any drift.

BEGIN;

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
