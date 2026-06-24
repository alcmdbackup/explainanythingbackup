-- queries.sql — exact SQL used to pull the CoherencePassPerf A/B dataset
-- on staging via `npm run query:staging`.
--
-- Experiment row: a0bcd825-e9df-48c8-afbf-8a2cb24303d6
-- Control strategy:   b722babf-873d-49f0-81a5-62109d172801  (lengthCap=1.02, maxCycles=1)
-- Treatment strategy: fe314a1e-4894-4765-9162-8bf51c827dbc  (lengthCap=1.10, maxCycles=2)

-- ─── Q1: run-level pivot (the dataset.csv body) ─────────────────────
SELECT
  r.id AS run_id,
  CASE WHEN r.strategy_id = 'b722babf-873d-49f0-81a5-62109d172801'
    THEN 'Control' ELSE 'Treatment' END AS arm,
  (SELECT value FROM evolution_metrics
    WHERE entity_type = 'run' AND entity_id = r.id AND metric_name = 'cost') AS cost_usd,
  (SELECT value FROM evolution_metrics
    WHERE entity_type = 'run' AND entity_id = r.id
    AND metric_name = 'eloAttrDelta:paragraph_recombine_with_coherence_pass:paragraph_recombine_with_coherence_pass') AS tactic_delta,
  (SELECT value FROM evolution_metrics
    WHERE entity_type = 'run' AND entity_id = r.id
    AND metric_name = 'eloAttrDelta:generate_from_previous_article:grounding_enhance') AS grounding,
  (SELECT value FROM evolution_metrics
    WHERE entity_type = 'run' AND entity_id = r.id
    AND metric_name = 'eloAttrDelta:generate_from_previous_article:structural_transform') AS structural,
  (SELECT value FROM evolution_metrics
    WHERE entity_type = 'run' AND entity_id = r.id
    AND metric_name = 'eloAttrDelta:generate_from_previous_article:lexical_simplify') AS lexical,
  (SELECT value FROM evolution_metrics
    WHERE entity_type = 'run' AND entity_id = r.id
    AND metric_name = 'winner_elo') AS winner_elo,
  (SELECT value FROM evolution_metrics
    WHERE entity_type = 'run' AND entity_id = r.id
    AND metric_name = 'variant_count') AS variant_count,
  (SELECT value FROM evolution_metrics
    WHERE entity_type = 'run' AND entity_id = r.id
    AND metric_name = 'paragraph_recombine_coherence_cost') AS coherence_cost
FROM evolution_runs r
WHERE r.experiment_id = 'a0bcd825-e9df-48c8-afbf-8a2cb24303d6'
  AND r.status = 'completed'
ORDER BY arm, r.completed_at;

-- ─── Q2: failure diagnosis (3 stale-claim failures) ─────────────────
SELECT r.id, r.strategy_id, r.error_code, r.error_message
FROM evolution_runs r
WHERE r.experiment_id = 'a0bcd825-e9df-48c8-afbf-8a2cb24303d6'
  AND r.status = 'failed';
-- Returned: 3 rows, all with error_message = 'stale claim auto-expired by claim_evolution_run'
-- (infrastructure failure, not config/content — minicomputer claimed but
-- timed out before completing). 2 Control + 1 Treatment.

-- ─── Q3: cost-tracking integrity (llmCallTracking rows exist) ───────
SELECT
  CASE WHEN s.id = 'b722babf-873d-49f0-81a5-62109d172801' THEN 'Control' ELSE 'Treatment' END AS arm,
  count(DISTINCT r.id) AS n_runs,
  count(t.id) AS n_llm_calls,
  sum(t.estimated_cost_usd) AS sum_tracked_cost
FROM evolution_runs r
JOIN evolution_strategies s ON s.id = r.strategy_id
LEFT JOIN "llmCallTracking" t ON t.evolution_invocation_id IN (
  SELECT id FROM evolution_agent_invocations WHERE run_id = r.id
)
WHERE r.experiment_id = 'a0bcd825-e9df-48c8-afbf-8a2cb24303d6'
  AND r.status = 'completed'
GROUP BY 1;

-- ─── Q4: outlier check (ALL non-coherence tactics negative?) ────────
-- The plan's outlier rule: drop runs where grounding < 0 AND structural < 0 AND lexical < 0.
-- Result: 0 runs match. No outliers to drop.
SELECT r.id, r.strategy_id
FROM evolution_runs r
WHERE r.experiment_id = 'a0bcd825-e9df-48c8-afbf-8a2cb24303d6'
  AND r.status = 'completed'
  AND (SELECT value FROM evolution_metrics
        WHERE entity_type = 'run' AND entity_id = r.id
        AND metric_name = 'eloAttrDelta:generate_from_previous_article:grounding_enhance') < 0
  AND (SELECT value FROM evolution_metrics
        WHERE entity_type = 'run' AND entity_id = r.id
        AND metric_name = 'eloAttrDelta:generate_from_previous_article:structural_transform') < 0
  AND (SELECT value FROM evolution_metrics
        WHERE entity_type = 'run' AND entity_id = r.id
        AND metric_name = 'eloAttrDelta:generate_from_previous_article:lexical_simplify') < 0;
-- Returns: 0 rows.

-- ─── Mann-Whitney U computed in the analysis prose, not in SQL.
-- The staging Supabase project doesn't have a stats extension installed, so
-- the U statistic + one-sided p was computed manually. See the report's
-- "Queries & Results > Q3" section for the rank-by-rank derivation.
