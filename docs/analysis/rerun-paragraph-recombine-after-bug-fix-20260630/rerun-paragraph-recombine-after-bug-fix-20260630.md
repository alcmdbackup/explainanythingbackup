# Rerun Paragraph Recombine After Bug Fix — 4-Arm A/B (federal_reserve_2)

## Header
- **Analysis name:** rerun-paragraph-recombine-after-bug-fix-20260630
- **Project:** docs/planning/rerun_paragraph_recombine_after_bug_fix_evolution_20260630/
- **Branch:** feat/rerun_paragraph_recombine_after_bug_fix_evolution_20260630
- **Date:** 2026-06-30
- **Source research doc:** docs/planning/rerun_paragraph_recombine_after_bug_fix_evolution_20260630/_research.md
- **EAR (full adversarial-review report):** docs/planning/rerun_paragraph_recombine_after_bug_fix_evolution_20260630/EAR.md
- **Experiment ID:** ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6
- **Experiment Name:** RerunParagraphRecombineAfterBugFix A/B (federal_reserve_2)
- **Total cost:** $2.30 (4 arms × 8 runs × ~$0.58/run)

## Methodology

Re-validation of the paragraph-recombine system on `federal_reserve_2` after
PR #1323 fixed cross-run paragraph-topic contamination in
`ParagraphRecombineWithCoherencePassAgent` (pre-fix, slot topics were keyed
by paragraph INDEX, leaking variants across all runs; post-fix, slot topics
are keyed by parent variant UUID).

**Experiment design:** 4 arms × 8 runs/arm = 32 runs. Each arm changes
exactly ONE knob from a single reference baseline (Arm A) to isolate that
knob's effect. Prompt + seed-generation phase + total budget cap held
identical across arms.

| Arm | Label | Agent | Knob changed | Strategy id |
|---|---|---|---|---|
| **A** | CP-Baseline | `paragraph_recombine_with_coherence_pass` | None (post-#1323 default) | `fe314a1e-…` (reused) |
| **B** | CP-Off | `paragraph_recombine_with_coherence_pass` | `coherencePassEnabled: false` | `0cd27136-…` (reused) |
| **C** | Seq + Stronger Coordinator | `paragraph_recombine` (sequential sibling) | `coordinatorModel: gpt-5-mini` | `3e967467-…` (new) |
| **D** | CP + Stronger Phase C | `paragraph_recombine_with_coherence_pass` | `coherencePassProposerModel + coherencePassApproverModel: gpt-5-mini` | `d09d25a1-…` (new) |

**"Stronger" model choice:** `gpt-5-mini` — the documented "safe lift"
upgrade path for coordinator role per `evolution/src/lib/schemas.ts:1113`.
Same model used uniformly across upgraded roles to keep cross-arm comparison
apples-to-apples.

**Primary outcome:** per-run top variant Elo (`MAX(elo_score) WHERE
variant_kind='article' AND generation_method<>'seed'`). Pre-registered as
the primary DV in the project's PRAP (`_planning.md ## Pre-Registered
Analysis Plan`).

**Statistical test (per PRAP):** Mann-Whitney U two-sided (α=0.05) on
per-run top_elo, applied to the four arm pairs A-vs-B, A-vs-C, A-vs-D,
B-vs-D. Exact enumeration of all C(16,8)=12,870 rank partitions used as
canonical reference (no ties in per-arm data). Normal-approximation
cross-check agrees within 0.046 max divergence.

**Effect sizes (supplement to p-values):** Hodges-Lehmann shift with 95%
percentile bootstrap CIs (2,000 LCG-seeded resamples), rank-biserial r
with 95% bootstrap CI, median delta with bootstrap CI.

**Decision rule (per PRAP):** PASS ⇔ p < 0.05 AND median Δ > +10 Elo.
FAIL ⇔ either condition unmet. (Conjunction rule inflates Type-II error
at n=8; absence of significance ≠ absence of effect — flagged as a
methodological limitation.)

**Multiplicity:** 4 pre-registered tests at uncorrected α=0.05 (per PRAP).
Family-wise α under independence = 1 − 0.95^4 = 0.1855. No correction
applied because all observed p ≫ 0.5; Bonferroni-corrected α=0.0125, Holm
rank-1 threshold = 0.0125, BH-FDR rank-1 = 0.0125 — same verdict under any
correction.

**Validity audit:**
- Wipeout gate: 0 arena-only wipeouts (`detectArenaOnlyWipeouts.ts
  --experiment-id ef2d1dc2-…` → `count: 0`).
- Balance: per-arm runs 8/8, invocations 132–138 (≤4.5% spread). Variant
  throughput varies 150–358 (structural — different agents have different
  per-invocation output cardinality). Match-decisiveness varies 16.8%–
  31.8% (structural — Arm C's sequential agent uses prior-context judging).
- Adversarial review: 5-iteration `/analysis-review-loop` against the EAR;
  final iteration aggregate 17/18 cells at 5/5 across Methodology +
  Statistical Validity + Causal Evidence reviewers; zero critical gaps.

**PII handling:** dataset.csv contains only Elo scalars, UUIDs, arm labels.
No user content or PII.

## Key Findings

1. **None of the four pre-registered Mann-Whitney comparisons reject the
   null at α=0.05.** Exact p: A-vs-B 0.6454, A-vs-C 0.7209, A-vs-D 0.9591,
   B-vs-D 1.0000. Zero of four pre-registered hypothesized lifts supported.
   Bonferroni-corrected α=0.0125; all observed p exceed by 50–80×.

2. **All point estimates of central shift place Arm A at or above the
   other arms, but the effect sizes are SMALL and the bootstrap CIs span
   both directions.** Hodges-Lehmann shifts (n=8/arm): A-vs-B −3.41 (CI
   [−39.34, +35.66]); A-vs-C −2.02 [−40.44, +7.44]; A-vs-D −2.57
   [−43.65, +48.01]; B-vs-D +0.08 [−41.12, +53.50]. Rank-biserial |r| ≤
   0.156, all r CIs span 0. **At this n the CI WIDTH (40–95 Elo for HL)
   is more informative than the point estimate**; the experiment cannot
   distinguish a true ±40 Elo effect from no effect. The much-larger
   median deltas (−31 to −36 Elo) in the per-arm summary reflect the
   median's sensitivity to one or two re-ranks at n=8 and overstate the
   true central shift.

3. **The experiment's single highest variant (Elo 1376.53) came from Arm
   D's `paragraph_recombine_with_coherence_pass` agent — NOT from the
   seed-phase generate iteration.** Concrete: variant `c67580a0-…` (run
   `92a0a822-…`). In Arms A, B, C the per-arm top variant came from the
   iter-0 `grounding_enhance` tactic instead. "Seed-phase top ≥ recombine
   top" pattern holds in 3 of 4 arms; reverses in Arm D where stronger
   Phase C models produced one outlier-high recombine variant.

4. **Arm D shows three-cluster recombine output (observational, n=8).**
   Per-run top_elo: 5 of 8 in low band 1206–1249; 2 of 8 in mid band
   1295–1325; 1 of 8 outlier at 1376.53. Between-cluster gaps (~46 Elo
   low→mid, ~51 Elo mid→outlier) exceed within-cluster spreads (43.11
   low; 30.22 mid). Pattern is consistent with either bimodal/trimodal
   stronger-Phase-C behavior OR a unimodal high-variance distribution
   where the upper tail was sampled twice in 8 runs. **Not a causal
   claim** — Mann-Whitney A-vs-D is non-significant and rank-biserial r
   = 0.031 (negligible).

5. **Arm C (sequential paragraph_recombine + stronger coordinator) shows
   the same three-cluster pattern at lower amplitude** (observational): 3
   of 8 above 1284, 3 of 8 in 1245–1248, 2 of 8 below 1245. The sequential
   agent's higher per-match decisive rate (31.8% vs ~18% in coherence-pass
   arms) did NOT translate to higher article-level Elo. **Not a causal
   claim** — same n=8 power limitations.

6. **Variant-throughput asymmetry confounds top_elo across arms**
   (observational): Arm B produced 358 ranked article variants vs Arm C's
   150 — a 2.4× ratio driven by structural agent differences
   (`coherencePassEnabled=false` still runs Phase A + B per-slot rewrites;
   sequential agent generates fewer article-level variants per invocation).
   The max-of-sample metric is mechanically larger for larger samples; the
   Mann-Whitney test on top_elo does NOT correct for this. Absent a
   throughput-corrected metric, B-vs-C top-Elo gaps cannot be read causally.

## Dataset

`dataset.csv` (32 rows = 4 arms × 8 runs each) — per-run top variant Elo
for the Mann-Whitney comparisons.

Columns:
- `arm` — strategy name (proxy for arm label)
- `arm_label` — A / B / C / D semantic label
- `run_id` — `evolution_runs.id`
- `top_elo` — `MAX(v.elo_score)` over the run's article-kind variants
  (excluding seed)
- `n_variants` — count of article-kind ranked variants in the run

**Row count:** 32 (well below the 10k cap; inline in full).

**PII check:** dataset contains only Elo scalars, UUIDs, arm labels. No
user content. Confirm dataset.csv contains no PII before committing.

### Quick-view per-run top_elo table

| Arm | Run-1 | Run-2 | Run-3 | Run-4 | Run-5 | Run-6 | Run-7 | Run-8 | median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A** CP-Baseline | 1229.27 | 1244.24 | 1246.99 | 1283.06 | 1283.12 | 1286.27 | 1286.30 | 1291.60 | **1283.09** |
| **B** CP-Off | 1233.45 | 1236.27 | 1243.79 | 1247.33 | 1256.29 | 1282.66 | 1290.53 | 1337.98 | 1251.81 |
| **C** Seq + Stronger Coord | 1234.23 | 1242.87 | 1245.11 | 1245.83 | 1247.65 | 1284.11 | 1286.97 | 1290.50 | 1246.74 |
| **D** CP + Stronger Phase C | 1206.29 | 1234.34 | 1239.47 | 1246.61 | 1249.40 | 1295.00 | 1325.22 | **1376.53** | 1248.01 |

## Queries & Results

All queries against staging (`npm run query:staging --json "<sql>"`) on
2026-06-30. Experiment id substituted via sed in the EAR's reproducer
script; raw SQL inlined here.

### Per-run top_elo (primary DV — input to Mann-Whitney)

```sql
SELECT r.id AS run_id, s.id AS strategy_id, s.name AS arm,
       MAX(v.elo_score) AS top_elo, COUNT(v.id) AS n_variants
FROM evolution_runs r
JOIN evolution_strategies s ON s.id = r.strategy_id
LEFT JOIN evolution_variants v ON v.run_id = r.id
  AND v.variant_kind = 'article'
  AND v.generation_method <> 'seed'
WHERE r.experiment_id = 'ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6'
  AND r.status = 'completed'
GROUP BY r.id, s.id, s.name
ORDER BY s.name, r.id;
```

Results materialized to `dataset.csv` (full 32 rows).

### Per-arm Mann-Whitney U + effect sizes

Computed via `/tmp/.../scratchpad/rigorous_stats.ts` (exact enumeration of
all C(16,8)=12,870 rank partitions; 2,000-resample bootstrap with
deterministic LCG seed=42 for CIs):

| Comparison | Exact MW p (two-sided) | Median Δ (y−x), 95% CI | HL shift, 95% CI | Rank-biserial r, 95% CI |
|---|---:|---|---|---|
| A vs B | 0.6454 | −31.28 [−46.26, +27.97] | −3.41 [−39.34, +35.66] | +0.156 [−0.438, +0.750] |
| A vs C | 0.7209 | −36.35 [−41.82, +21.94] | −2.02 [−40.44, +7.44] | +0.125 [−0.469, +0.719] |
| A vs D | 0.9591 | −35.09 [−48.76, +49.47] | −2.57 [−43.65, +48.01] | +0.031 [−0.594, +0.688] |
| B vs D | 1.0000 | −3.81 [−45.76, +65.75] | +0.08 [−41.12, +53.50] | +0.000 [−0.594, +0.625] |

### Wipeout gate

```bash
$ npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts \
    --experiment-id ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6 --json
{"target":"staging","experimentId":"ef2d1dc2-...","count":0,"wipeouts":[]}
```

No runs match the arena-only wipeout fingerprint. All 32 runs included
in significance computation.

### Per-arm balance audit

```sql
SELECT s.name AS arm, COUNT(*) AS invocations_total,
       SUM(CASE WHEN ai.success THEN 1 ELSE 0 END) AS succ,
       SUM(CASE WHEN ai.skipped THEN 1 ELSE 0 END) AS skipped,
       SUM(CASE WHEN NOT ai.success AND NOT ai.skipped THEN 1 ELSE 0 END) AS failed
FROM evolution_runs r
JOIN evolution_strategies s ON s.id=r.strategy_id
JOIN evolution_agent_invocations ai ON ai.run_id=r.id
WHERE r.experiment_id='ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6'
GROUP BY s.name;
```

| Arm | invocations_total | success | failed | skipped |
|---|---:|---:|---:|---:|
| A — CP-Baseline | 134 | 125 | 9 | 0 |
| B — CP-Off | 138 | 126 | 12 | 0 |
| C — Seq + Stronger Coord | 134 | 124 | 10 | 0 |
| D — CP + Stronger Phase C | 132 | 122 | 10 | 0 |

Balanced (4.5% spread across arms, failure rate 7–9% uniformly).

### Per-arm decisiveness audit

```sql
-- See evolution/scripts/analysis/judge_decisiveness_distribution.sql for full query
```

| Arm | total matches | bucket 1.0 | bucket 0.7 | bucket 0.5-TIE | decisive_pct @0.6 |
|---|---:|---:|---:|---:|---:|
| A — CP-Baseline | 1,644 | 353 | 38 | 1,253 | 16.8% |
| B — CP-Off | 1,760 | 407 | 33 | 1,320 | 18.0% |
| C — Seq + Stronger Coord | 352 | 111 | 9 | 232 | 31.8% |
| D — CP + Stronger Phase C | 949 | 210 | 25 | 714 | 18.7% |

Arm C ~2× as decisive as others due to structural prior-context judging
in sequential agent. Position-bias not computed (would need 2-pass reversal
pairing not pre-registered).

### Per-arm cost breakdown

```sql
-- See evolution/scripts/analysis/per_arm_cost_breakdown.sql for full query
```

| Arm | total_cost_usd | improver_count | cost_per_improver_usd |
|---|---:|---:|---:|
| A — CP-Baseline | $0.561 | 312 | $0.0018 |
| B — CP-Off | $0.573 | 358 | $0.0016 |
| C — Seq + Stronger Coord | $0.581 | 150 | $0.0039 |
| D — CP + Stronger Phase C | $0.589 | 216 | $0.0027 |

Per-arm budget utilization 70–74% of $0.80 ($0.10/run × 8 runs). Stronger
models in Arms C+D approximately double cost per improver vs default
gemini-flash-lite.

### Top variant per arm + agent attribution

```sql
WITH ranked AS (
  SELECT s.name AS arm, v.id AS variant_id, v.agent_name, v.elo_score,
         v.run_id, v.agent_invocation_id,
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
```

| Arm | top variant | top agent | top Elo |
|---|---|---|---:|
| A — CP-Baseline | `2c8959c9-…` | `grounding_enhance` | 1291.60 |
| B — CP-Off | `f0e53fe5-…` | `grounding_enhance` | 1337.98 |
| C — Seq + Stronger Coord | `95c83b8b-…` | `grounding_enhance` | 1290.50 |
| D — CP + Stronger Phase C | `c67580a0-…` | `paragraph_recombine_with_coherence_pass` | **1376.53** |

In 3 of 4 arms the per-arm top variant came from the iter-0 `grounding_enhance`
tactic (seed-phase). Only Arm D produced its top from the recombine agent
itself, via the stronger Phase C models.

---

**Reproduction:** full reproducer queries live in `queries.sql` alongside
this file. Per-arm raw data lives in `dataset.csv`. The EAR
(`docs/planning/rerun_paragraph_recombine_after_bug_fix_evolution_20260630/EAR.md`)
carries the full per-section adversarial review log + 5-iteration history.
