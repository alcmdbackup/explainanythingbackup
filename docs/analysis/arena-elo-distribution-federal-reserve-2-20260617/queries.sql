-- Arena Elo distribution for federal_reserve_2
-- Run against staging Supabase (`readonly_local` role) via:
--   npm run query:staging -- --json "<query>"
--
-- Prompt: federal_reserve_2 (staging only)
--   id   = a546b7e9-f066-403d-9589-f5e0d2c9fa4f
--   name = 'Federal Reserve 2'
--
-- Population: all active synced arena variants for this prompt.
--   synced_to_arena = true, archived_at IS NULL
-- No variant_kind filter — federal_reserve_2 currently has zero paragraph-kind
-- arena rows (verified in the prior decay-curve analysis), so the full set is
-- article variants. No generation filter — we want the full leaderboard
-- distribution, including roots/seeds.
--
-- Snapshot date: 2026-06-17.

-- =========================================================================
-- Q1 — Percentile summary (one row).
-- =========================================================================
SELECT count(*)                                                                          AS n,
       round(min(elo_score)::numeric,1)                                                  AS min,
       round(percentile_cont(0.01) WITHIN GROUP (ORDER BY elo_score)::numeric,1)         AS p1,
       round(percentile_cont(0.05) WITHIN GROUP (ORDER BY elo_score)::numeric,1)         AS p5,
       round(percentile_cont(0.10) WITHIN GROUP (ORDER BY elo_score)::numeric,1)         AS p10,
       round(percentile_cont(0.25) WITHIN GROUP (ORDER BY elo_score)::numeric,1)         AS p25,
       round(percentile_cont(0.50) WITHIN GROUP (ORDER BY elo_score)::numeric,1)         AS p50,
       round(percentile_cont(0.75) WITHIN GROUP (ORDER BY elo_score)::numeric,1)         AS p75,
       round(percentile_cont(0.90) WITHIN GROUP (ORDER BY elo_score)::numeric,1)         AS p90,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY elo_score)::numeric,1)         AS p95,
       round(percentile_cont(0.99) WITHIN GROUP (ORDER BY elo_score)::numeric,1)         AS p99,
       round(max(elo_score)::numeric,1)                                                  AS max,
       round(avg(elo_score)::numeric,1)                                                  AS mean,
       round(stddev(elo_score)::numeric,1)                                               AS stddev
FROM evolution_variants
WHERE prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
  AND synced_to_arena=true
  AND archived_at IS NULL;

-- =========================================================================
-- Q2 — Ventile (5%-bucket) breakdown via ntile(20).
-- Returns 20 rows ordered ventile 1 (bottom 5%) → 20 (top 5%).
-- The output table in dataset.csv lists them top-down (ventile DESC).
-- =========================================================================
WITH ranked AS (
  SELECT elo_score, ntile(20) OVER (ORDER BY elo_score) AS ventile
  FROM evolution_variants
  WHERE prompt_id='a546b7e9-f066-403d-9589-f5e0d2c9fa4f'
    AND synced_to_arena=true
    AND archived_at IS NULL
)
SELECT ventile,
       count(*)                          AS n,
       round(min(elo_score)::numeric,1)  AS min_elo,
       round(max(elo_score)::numeric,1)  AS max_elo,
       round(avg(elo_score)::numeric,1)  AS avg_elo
FROM ranked
GROUP BY ventile
ORDER BY ventile DESC;
