-- Add index to support anchor-eligible entry queries on evolution_hall_of_fame_elo.
-- Anchor-eligible means: match_count >= 4 AND sigma < 5.0 (rating has converged enough to trust).
-- These entries are used as calibration anchors when new variants enter the Hall of Fame.
--
-- Decision: anchor_eligible is computed at query time, NOT stored as a materialized column.
-- Rationale:
--   1. sigma and match_count are updated on every comparison round — a stored boolean would
--      require a trigger or manual backfill to stay in sync, adding write amplification.
--   2. The predicate (match_count >= 4 AND sigma < 5.0) is cheap to evaluate inline;
--      PostgreSQL partial index pushdown handles it without a full scan.
--   3. The thresholds (4 matches, sigma 5.0) may be tuned — a computed column is trivially
--      re-evaluated, whereas a materialized boolean requires a backfill migration.
--   4. No existing code reads an anchor_eligible column, so there is no API contract to satisfy.
--
-- The partial index below covers the anchor-eligible query pattern efficiently:
--   SELECT * FROM evolution_hall_of_fame_elo
--   WHERE topic_id = $1
--     AND match_count >= 4
--     AND sigma < 5.0
--   ORDER BY ordinal DESC;
--
-- This index is also used for anchor subset selection (e.g., stratified top/mid/bottom anchors
-- for new entrant calibration) without scanning non-anchor rows.

-- NOTE: Do NOT use CONCURRENTLY — Supabase migrations run inside transactions.
CREATE INDEX IF NOT EXISTS idx_hof_elo_topic_anchor_eligible
  ON evolution_hall_of_fame_elo (topic_id, ordinal DESC)
  WHERE match_count >= 4 AND sigma < 5.0;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_hof_elo_topic_anchor_eligible;
