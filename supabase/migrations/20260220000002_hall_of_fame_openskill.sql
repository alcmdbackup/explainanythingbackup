-- Migrate hall_of_fame_elo from Elo K-32 to native OpenSkill (mu/sigma/ordinal).
-- Keeps elo_rating as a derived backward-compat column for UI display (0-3000 scale).

-- Rollback: ALTER TABLE hall_of_fame_elo DROP COLUMN mu, DROP COLUMN sigma, DROP COLUMN ordinal;
--           DROP INDEX IF EXISTS idx_hall_of_fame_elo_topic_ordinal;
--           CREATE INDEX idx_hall_of_fame_elo_leaderboard ON hall_of_fame_elo(topic_id, elo_rating DESC);

-- Add OpenSkill columns
ALTER TABLE hall_of_fame_elo
  ADD COLUMN mu NUMERIC(10,6) NOT NULL DEFAULT 25.0,
  ADD COLUMN sigma NUMERIC(10,6) NOT NULL DEFAULT 8.333333,
  ADD COLUMN ordinal NUMERIC(10,6) NOT NULL DEFAULT 0.0;

-- Migrate existing rows: map elo_rating → mu, derive sigma from match_count
-- Note: ordinal can go negative for low-Elo entries (e.g., elo=400 → mu=-25 → ordinal≈-50).
-- This is fine — NUMERIC(10,6) handles negatives, and ordinalToEloScale clamps to [0,3000]
-- which satisfies the existing CHECK constraint on elo_rating.
UPDATE hall_of_fame_elo SET
  mu = 25.0 + (elo_rating - 1200) * (25.0 / 400.0),
  sigma = CASE
    WHEN match_count >= 8 THEN 3.0
    WHEN match_count >= 4 THEN 5.0
    ELSE 8.333333
  END,
  ordinal = (25.0 + (elo_rating - 1200) * (25.0 / 400.0))
            - 3 * (CASE WHEN match_count >= 8 THEN 3.0
                        WHEN match_count >= 4 THEN 5.0
                        ELSE 8.333333 END);

-- Now update elo_rating and elo_per_dollar to be consistent with the new ordinal values.
-- The round-trip elo → mu/sigma → ordinal → eloScale does NOT reproduce the original elo
-- (e.g., elo=1200, matchCount=8 → mu=25, sigma=3, ordinal=16 → eloScale=1456).
-- This is expected: the Elo-scale display now reflects the OpenSkill ordinal, not the old Elo rating.
-- Leaderboard ordering will change because entries with different sigma values (match counts)
-- will produce different ordinals even from the same original elo_rating.
UPDATE hall_of_fame_elo SET
  elo_rating = GREATEST(0, LEAST(3000,
    1200 + ordinal * (400.0 / 25.0)
  )),
  elo_per_dollar = CASE
    WHEN total_cost_usd IS NULL OR total_cost_usd = 0 THEN NULL
    ELSE (GREATEST(0, LEAST(3000, 1200 + ordinal * (400.0 / 25.0))) - 1200) / total_cost_usd
  END;

-- Replace elo_rating-based index with ordinal-based index for leaderboard sorting
DROP INDEX IF EXISTS idx_hall_of_fame_elo_leaderboard;
CREATE INDEX idx_hall_of_fame_elo_topic_ordinal ON hall_of_fame_elo(topic_id, ordinal DESC);
