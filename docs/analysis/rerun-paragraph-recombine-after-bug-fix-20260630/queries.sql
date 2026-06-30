-- queries.sql — full reproducer for rerun-paragraph-recombine-after-bug-fix-20260630
--
-- Target: staging Postgres (read-only via `npm run query:staging`).
-- Experiment id: ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6
-- Date: 2026-06-30
--
-- All queries are read-only. Substitute the experiment id literal where it
-- appears as 'ef2d1dc2-…'.

-- ─── Q1: Per-run top_elo (primary DV → dataset.csv) ─────────────────────────
SELECT
  s.name AS arm,
  CASE
    WHEN s.name='Strategy 7a494f (lite, 2it)' THEN 'A-CP-Baseline'
    WHEN s.name='Strategy 66f213 (lite, 2it)' THEN 'B-CP-Off'
    WHEN s.name='Strategy 578ddb (lite, 2it)' THEN 'C-Seq-Stronger-Coordinator'
    WHEN s.name='Strategy 2f2de1 (lite, 2it)' THEN 'D-CP-Stronger-Phase-C'
  END AS arm_label,
  r.id AS run_id,
  MAX(v.elo_score) AS top_elo,
  COUNT(v.id) AS n_variants
FROM evolution_runs r
JOIN evolution_strategies s ON s.id = r.strategy_id
LEFT JOIN evolution_variants v ON v.run_id = r.id
  AND v.variant_kind = 'article'
  AND v.generation_method <> 'seed'
WHERE r.experiment_id = 'ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6'
  AND r.status = 'completed'
GROUP BY s.name, r.id
ORDER BY s.name, r.id;

-- ─── Q2: Per-arm balance audit (invocations) ────────────────────────────────
SELECT
  s.name AS arm,
  COUNT(*) AS invocations_total,
  SUM(CASE WHEN ai.success THEN 1 ELSE 0 END) AS succ,
  SUM(CASE WHEN ai.skipped THEN 1 ELSE 0 END) AS skipped,
  SUM(CASE WHEN NOT ai.success AND NOT ai.skipped THEN 1 ELSE 0 END) AS failed
FROM evolution_runs r
JOIN evolution_strategies s ON s.id=r.strategy_id
JOIN evolution_agent_invocations ai ON ai.run_id=r.id
WHERE r.experiment_id='ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6'
GROUP BY s.name;

-- ─── Q3: Per-arm decisiveness audit (matches @0.6) ──────────────────────────
-- See evolution/scripts/analysis/judge_decisiveness_distribution.sql for the
-- canonical version (parameterized via sed on $experiment_id).
SELECT
  s.id AS strategy_id, s.name AS arm,
  count(*) AS total,
  count(*) FILTER (WHERE c.confidence_score >= 1.0) AS bucket_1_0,
  count(*) FILTER (WHERE c.confidence_score >= 0.7 AND c.confidence_score < 1.0) AS bucket_0_7,
  count(*) FILTER (WHERE c.confidence_score >= 0.5 AND c.confidence_score < 0.7) AS bucket_0_5_tie,
  count(*) FILTER (WHERE c.confidence_score >= 0.3 AND c.confidence_score < 0.5) AS bucket_0_3,
  count(*) FILTER (WHERE c.confidence_score < 0.3) AS bucket_0_0,
  round(100.0 * count(*) FILTER (WHERE c.confidence_score >= 0.6 AND c.winner_kind <> 'draw') / count(*), 1) AS decisive_pct
FROM evolution_arena_comparisons c
JOIN evolution_runs r ON r.id = c.run_id
JOIN evolution_strategies s ON s.id = r.strategy_id
WHERE r.experiment_id = 'ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6'
GROUP BY s.id, s.name;

-- ─── Q4: Per-arm cost breakdown ─────────────────────────────────────────────
-- See evolution/scripts/analysis/per_arm_cost_breakdown.sql for the
-- canonical version. Summary results inlined in the analysis report's
-- ## Queries & Results section.

-- ─── Q5: Top variant per arm + agent attribution ────────────────────────────
WITH ranked AS (
  SELECT
    s.name AS arm,
    v.id AS variant_id,
    v.agent_name,
    v.elo_score,
    v.run_id,
    v.agent_invocation_id,
    ROW_NUMBER() OVER (PARTITION BY s.name ORDER BY v.elo_score DESC) AS rn
  FROM evolution_runs r
  JOIN evolution_strategies s ON s.id = r.strategy_id
  JOIN evolution_variants v ON v.run_id = r.id
  WHERE r.experiment_id = 'ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6'
    AND v.variant_kind = 'article'
    AND v.generation_method <> 'seed'
    AND v.elo_score IS NOT NULL
)
SELECT * FROM ranked WHERE rn <= 1 ORDER BY arm;

-- ─── Q6: Top RECOMBINE-only variants per arm (Causal Evidence § Finding #4) ─
WITH ranked AS (
  SELECT
    s.name AS arm,
    v.id AS variant_id,
    v.agent_name,
    v.elo_score,
    v.run_id,
    v.agent_invocation_id,
    ROW_NUMBER() OVER (PARTITION BY s.name ORDER BY v.elo_score DESC) AS rn
  FROM evolution_runs r
  JOIN evolution_strategies s ON s.id = r.strategy_id
  JOIN evolution_variants v ON v.run_id = r.id
  WHERE r.experiment_id = 'ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6'
    AND v.variant_kind = 'article'
    AND v.agent_name IN ('paragraph_recombine','paragraph_recombine_with_coherence_pass')
    AND v.elo_score IS NOT NULL
)
SELECT * FROM ranked WHERE rn <= 10 ORDER BY arm, rn;

-- ─── Q7: Arena-only wipeout detector (run via TS, not raw SQL) ──────────────
-- $ npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts \
--     --experiment-id ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6 --json
-- Returns: {"count":0,"wipeouts":[]}
