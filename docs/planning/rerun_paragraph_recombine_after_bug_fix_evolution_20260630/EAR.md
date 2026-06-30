# rerun_paragraph_recombine_after_bug_fix — Experiment Analysis Report (EAR)

## Header
- **Project:** docs/planning/rerun_paragraph_recombine_after_bug_fix_evolution_20260630/
- **Branch:** feat/rerun_paragraph_recombine_after_bug_fix_evolution_20260630
- **Experiment ID:** ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6
- **Experiment Name:** RerunParagraphRecombineAfterBugFix A/B (federal_reserve_2)
- **Date:** 2026-06-30
- **Skill version:** /run_experiment_analysis (origin/main @ d5fdae7a6 + 0ec1ce007 Table A column updates)
- **Total cost:** $2.30 (4 arms × 8 runs; sum of per-arm totals = $0.561 + $0.573 + $0.581 + $0.589 = $2.304, rounded for header)

## Methodology

**Pre-registered test (per PRAP):** Mann-Whitney U two-sided (α=0.05) on per-run top variant final Elo = `MAX(evolution_variants.elo_score) WHERE variant_kind='article' AND generation_method<>'seed'`, n=8 runs per arm.

**Pre-registered pairwise comparisons:** A vs B, A vs C, A vs D, B vs D (4 tests).

**Pre-registered threshold (decision rule):** PASS ⇔ p < 0.05 AND median Δ > +10 Elo points vs the matched control. FAIL ⇔ either condition unmet. INCONCLUSIVE ⇔ p < 0.05 AND |median Δ| < 10. **Conjunction-rule caveat**: requiring BOTH p < 0.05 AND |median Δ| > 10 inflates the Type-II error rate vs requiring either alone — a non-effect arising from null-rejection failure is indistinguishable in the verdict from a non-effect arising from effect-size-below-threshold. At n=8/arm with ~60% power for a 1-σ shift, this compounding makes the FAIL verdict an even weaker signal of "no effect" than the underlying MW non-rejection alone would suggest.

**Outlier rule (per PRAP):** None applied. The PRAP did not pre-register an outlier exclusion because Mann-Whitney is rank-based and intrinsically robust.

**Multiplicity:** Pre-registered as 4 independent tests at uncorrected α=0.05 per pair. With 4 tests under independence the family-wise error rate inflates to ~1 − 0.95^4 = 0.1855. **No correction is applied** because (a) the PRAP did not specify one, and (b) all observed p-values are >> 0.5, so any common correction would leave every test non-rejected. Explicit: **Bonferroni-corrected α = 0.05/4 = 0.0125** — all four observed p (0.6454, 0.7209, 0.9591, 1.0000) exceed this by ~50× to 80×. **Holm-Bonferroni step-down** ranks the p-values ascending and tests p_{(1)} < α/4, then p_{(2)} < α/3, … — at the smallest p_{(1)} = 0.6454 the threshold is 0.0125, not rejected, so Holm stops and rejects nothing. **Benjamini-Hochberg FDR** uses critical values (i/m)·α; for rank i=1, m=4 the threshold is 0.0125 — the smallest p (0.6454) does not cross it. (Note: Bonferroni and the rank-1 thresholds of Holm and BH all coincide at α/m = 0.0125 — this is not a typo; the three corrections diverge at higher ranks but all three reject the same set at rank 1.) So the four FAIL verdicts hold under every correction. This is explicitly disclosed as a methodological limitation: if any pairwise p were borderline, the family-wise α would matter.

**Power note:** With n=8/arm and a desired α=0.05, the two-sided Mann-Whitney has ~60% power to detect a 1-σ shift (rule-of-thumb derivation, **not** computed from any specific distribution assumption). The experiment is therefore underpowered for definitive non-effect declarations. We address this by reporting effect-size estimates with CIs rather than relying on null-rejection alone.

**Implementation:** **Exact Mann-Whitney via enumeration of all C(16,8) = 12,870 rank partitions** is the canonical reference for the headline p-values (no ties in the per-arm data → exact is feasible at n=8/8 and strictly preferred over normal approximation). Cross-checked via normal-approx with tied-rank-adjusted variance: max divergence 0.046 on A-vs-B (exact 0.6454 vs normal-approx 0.5995); divergence < 0.05 on all four comparisons. Implementation: `scripts/skills/rigorous_stats.ts` exact-MW path + normal-approx cross-check.

**Effect sizes reported alongside p-values** (critical for n=8 interpretation). All bootstrap CIs are **percentile bootstrap** (sort the 2,000 resampled statistic values and take the 2.5th/97.5th percentile; deterministic LCG-seeded). BCa or studentized bootstrap would be theoretically preferable at n=8 but the percentile variant is sufficient for the "CI is much wider than the point estimate" reading that drives the interpretation.

- **Median Δ** (post-stratum point difference) with 95% percentile bootstrap CI.
- **Hodges-Lehmann shift** (median of all n1·n2 pairwise differences) with 95% percentile bootstrap CI. Strictly preferred over median Δ at small n.
- **Rank-biserial r** (matched-pairs effect-size correlate) with 95% percentile bootstrap CI. Convention: r > 0 means x stochastically dominates y.

PRAP source: `docs/planning/rerun_paragraph_recombine_after_bug_fix_evolution_20260630/_planning.md ## Pre-Registered Analysis Plan`.

**Wipeout gate result:** 0 arena-only wipeouts detected (`detectArenaOnlyWipeouts.ts --experiment-id ef2d1dc2-…` → `count: 0`). All 32 completed runs included; no PRAP deviations.

**Throughput-bias caveat (new — per Statistical Validity review):** the per-run top_elo metric is the MAX over a varying number of article variants per arm (150 to 358). The maximum of a larger sample is mechanically larger than the maximum of a smaller sample even under an identical underlying distribution. The Mann-Whitney test on top_elo does NOT correct for this throughput asymmetry. See `## Balance Audit ### Balance Notes` for the cross-arm variant counts; this confound is flagged but not corrected post-hoc to preserve PRAP fidelity.

## Key Findings

### Table A — Test-vs-Control Metrics Summary

| Arm | n_runs (queued / completed / ranked) | variants_produced (article ranked) | top_elo | median_elo | top_elo Δ vs A | median_elo Δ vs A | pct_variants_better_than_seed | budget_per_run_usd | total_budget_usd | total_spent_usd | cost_per_improver_usd | significance verdict (vs control) |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---|
| **A — CP-Baseline** | 8 / 8 / 8 | 312 | 1291.60 | 1283.09 | — | — | 36.5% (114/312) | $0.10 | $0.80 | $0.561 | $0.0018 | reference |
| **B — CP-Off** | 8 / 8 / 8 | 358 | 1337.98 | 1251.81 | +46.38 | −31.28 | 38.5% (138/358) | $0.10 | $0.80 | $0.573 | $0.0016 | FAIL vs A (exact MW p=0.6454; HL=−3.41 [−39.34, +35.66]; r_rb=+0.156) |
| **C — Seq + Stronger Coord** | 8 / 8 / 8 | 150 | 1290.50 | 1246.74 | −1.10 | −36.35 | 35.3% (53/150) | $0.10 | $0.80 | $0.581 | $0.0039 | FAIL vs A (exact MW p=0.7209; HL=−2.02 [−40.44, +7.44]; r_rb=+0.125) |
| **D — CP + Stronger Phase C** | 8 / 8 / 8 | 216 | **1376.53** | 1248.01 | +84.93 | −35.09 | 38.0% (82/216) | $0.10 | $0.80 | $0.589 | $0.0027 | FAIL vs A (exact MW p=0.9591; HL=−2.57 [−43.65, +48.01]; r_rb=+0.031); FAIL vs B (exact MW p=1.0000; HL=+0.08 [−41.12, +53.50]; r_rb=0.000) |
| **Total / mean** | 32 / 32 / 32 | 1,036 | 1376.53 (Arm D) | — | — | — | — | — | $3.20 | $2.304 | — | — |

`pct_variants_better_than_seed` baseline is **1200** Elo. Counts are per-arm RANKED article variants (any non-seed `article`-kind variant with `arena_match_count > 0`; in this experiment every produced article variant was ranked).

> **Critical reading note on the verdict column:** every FAIL above is a *non-rejection of the null*, not *evidence of equivalence*. At n=8/arm the bootstrap CIs on the Hodges-Lehmann shift estimator (the most reliable central-tendency-separation estimator here) span from ~−40 to +50 Elo across every comparison — i.e. the data are consistent with any true central shift in that range. The directional point estimates do tell a story (see Findings #1–#5 below), but no causal language ("X reduces Y", "X is better than Y") is justified by the formal tests.

### Findings (numbered)

1. **None of the four pre-registered Mann-Whitney comparisons reject the null at α=0.05.** Exact p-values: A-vs-B 0.6454, A-vs-C 0.7209, A-vs-D 0.9591, B-vs-D 1.0000. Family-wise α inflates to 0.1855 across 4 tests but no correction is needed since every p exceeds Bonferroni-corrected α (0.0125) by ~50–80×. **Interpretation**: zero of four pre-registered hypothesized lifts was supported. **This is NOT evidence of equivalence between arms** — the Hodges-Lehmann shift bootstrap CIs admit central shifts of approximately ±40 Elo points in either direction across all four comparisons. With n=8/arm, the data are consistent with *any* true cross-arm shift in that range; the experiment cannot distinguish "true effect smaller than ~40 Elo" from "no effect" at this n.

2. **All point estimates of central shift place Arm A at or above the other arms, but the effect sizes are SMALL and the bootstrap CIs span both directions.** Hodges-Lehmann shift estimates: A-vs-B −3.41 (CI [−39.34, +35.66]); A-vs-C −2.02 (CI [−40.44, +7.44]); A-vs-D −2.57 (CI [−43.65, +48.01]); B-vs-D +0.08 (CI [−41.12, +53.50]). Rank-biserial r with CIs: A-vs-B 0.156 [−0.438, +0.750]; A-vs-C 0.125 [−0.469, +0.719]; A-vs-D 0.031 [−0.594, +0.688]; B-vs-D 0.000 [−0.594, +0.625]. **All r CIs span r=0**: the experiment cannot reject "no stochastic dominance in either direction". **Interpretation**: the much-larger median deltas (−31 to −36 Elo) in Table A reflect the median's sensitivity to one or two re-ranks at n=8 — they overstate the true central shift. **At this n the CI WIDTH (40–95 Elo for HL, ~1.2 for r_rb) is more informative than the point estimate**; the bootstrap CIs cannot distinguish even a 40 Elo gap in the wrong direction from no effect. The A-vs-D and B-vs-D HL CIs are notably wider (~92 Elo and ~95 Elo) than A-vs-B (~75 Elo) and A-vs-C (~48 Elo), meaning the non-rejections involving Arm D are the most fragile (consistent with Arm D's three-cluster per-run top_elo distribution, see Findings #3–#4).

3. **The experiment's single highest variant (Elo 1376.53) came from Arm D's `paragraph_recombine_with_coherence_pass` agent, NOT from Arm D's seed-phase generate iteration.** Concrete: variant `c67580a0-e87c-4a3b-8fd6-d64a3c525245` (agent_invocation `bcf7cb78-5277-4561-8ef8-0ece7b816978`, run `92a0a822-a716-44a4-b959-1f626128060f`) was produced by the stronger-Phase-C coherence-pass agent. This *partially* contradicts an early reading of this report. **Across the other three arms (A, B, C), the per-arm top variant came from the iter-0 `grounding_enhance` tactic — NOT from the recombine agent** (A: `2c8959c9-…` Elo 1291.60 grounding_enhance; B: `f0e53fe5-…` Elo 1337.98 grounding_enhance; C: `95c83b8b-…` Elo 1290.50 grounding_enhance). So "seed-phase generate ≥ recombine for the per-arm top variant" holds in **3 of 4 arms (A, B, C)** but **reverses in Arm D**, where stronger Phase C models produced one outlier-high recombine variant (1376.53).

4. **Arm D shows clear bimodal/high-variance recombine output (no causal language; descriptive only).** Top 5 recombine variants in Arm D: 1376.53 / 1248.62 / 1246.61 / 1244.66 / 1236.87 — a ~128 Elo gap between #1 and #2, then a tight cluster around 1240. In contrast, Arm A's top 5 recombine variants are tightly clustered (1286.30 / 1284.17 / 1284.01 / 1283.31 / 1249.33), and Arm B's top 5 are similar (1290.53 / 1289.37 / 1256.29 / …). **Observational claim**: stronger Phase C models (Arm D) appear to produce higher-variance recombine outputs than default Phase C models (Arm A). **Not a causal claim**: the Mann-Whitney A-vs-D is non-significant, and rank-biserial r=0.031 (negligible). The pattern is consistent with higher-variance Phase C output *or* with sampling noise at n=8.

5. **Arm C (sequential paragraph_recombine + stronger coordinator) showed the lowest median top_elo (1246.74), but again non-significantly so.** Observational pattern: across 8 of 8 Arm-C runs, the per-run top variants form three rough clusters — 3 of 8 land above 1284 (max 1290.50), 3 of 8 in a tight band 1245–1248, 2 of 8 below 1245 (min 1234.23). Concrete examples are `d62cdee1-…` Elo 1284.11 (high cluster) and `a386e8ae-…` Elo 1247.80 (middle cluster). **Not a causal claim**. The sequential agent's higher per-match decisive rate (31.8% vs ~18% in coherence-pass arms — see Decisiveness Audit) did NOT translate to higher article-level Elo, but the sample is too small to declare either direction.

6. **Variant-throughput asymmetry is real and confounds top_elo.** Arm B produced 358 ranked article variants vs Arm C's 150 — a 2.4× ratio. The maximum of a sample of size 358 mechanically exceeds the maximum of a sample of size 150 even under an identical underlying distribution. The Mann-Whitney test on per-run top_elo does not correct for this. **Observation**: despite the 2.4× throughput advantage, Arm B's top_elo (1337.98) exceeds Arm C's (1290.50) by 47 Elo and B's median exceeds C's by only 5 Elo. The throughput advantage did NOT yield a proportional ceiling lift — but absent a properly throughput-corrected metric, this comparison should not be read causally either.

### Follow-up Ideas

1. **Run a larger N (16–24/arm) re-validation of just Arms A and B** (CP-default vs CP-Off) using the same seed script. The current n=8 leaves the headline A-vs-B comparison underpowered (HL CI [−39, +36] Elo); doubling n would tighten the CI roughly by √2 and either confirm or rule out a clinically meaningful shift.
2. **Switch the high-end ceiling investigation to a different prompt.** Federal Reserve 2 has a long history of admin runs accumulating in its arena topics. Even with PR #1323 in place, the cross-arm pattern that the per-arm top variants in Arms A/B/C come from the seed-phase generate iteration may be FR2-specific (an unusually-strong seed-phase prior). A clean prompt with no pre-existing arena pollution would test whether this generalizes.
3. **Sample-correct the top_elo metric for future sweeps.** Instead of top_elo per run, use either (a) p90 of variant Elos per run (less sensitive to outliers), or (b) a per-variant-density metric like `pct_variants_better_than_seed` (proportional, throughput-unbiased). Both already in Table A — promote one to primary DV in the next PRAP.
4. **Investigate Arm D's bimodal pattern with execution-detail analysis.** The 1376.53 outlier in run `92a0a822-…` should have a logged `execution_detail.coordinatorPlan` and a `paragraph_recombine_with_coherence_pass.execution_detail` JSON — comparing those to the low-end runs (e.g. run `90fb68a2-…` top recombine at 1206.29) might surface whether the stronger Phase C succeeds-or-fails on identifiable input characteristics.
5. **Validate the seed-phase tactic prevalence in the top.** That `grounding_enhance` produced the per-arm top in 3 of 4 arms is itself an interesting observation; an eloAttrDelta tactic-leaderboard query across this experiment + the 3 prior FR2 experiments would confirm whether this is FR2-specific or a generalizable seed-phase strong tactic.

## Dataset

Per-run top_elo data is materialized at `/tmp/.../scratchpad/per_run_top_elo.json` (32 rows = 4 arms × 8 runs) and will be promoted to `docs/analysis/<promoted-name>/dataset.csv` by `/write_doc_for_completed_analysis` on EAR approval. Source query in `## Queries & Results` below.

**PII check:** dataset contains only Elo scalars + UUIDs + arm labels; no user content or PII.

## Queries & Results

### Per-run top_elo (used for Mann-Whitney)

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

**Raw per-run top_elo per arm** (8 runs each, sorted ascending):

- **A (CP-Baseline)**: 1229.27, 1244.24, 1246.99, 1283.06, 1283.12, 1286.27, 1286.30, 1291.60 → median 1283.09
- **B (CP-Off)**: 1233.45, 1236.27, 1243.79, 1247.33, 1256.29, 1282.66, 1290.53, 1337.98 → median 1251.81
- **C (Seq + Stronger Coord)**: 1234.23, 1242.87, 1245.11, 1245.83, 1247.65, 1284.11, 1286.97, 1290.50 → median 1246.74
- **D (CP + Stronger Phase C)**: 1206.29, 1234.34, 1239.47, 1246.61, 1249.40, 1295.00, 1325.22, 1376.53 → median 1248.01

### Mann-Whitney U + effect sizes (exact MW + bootstrap CIs)

Run via `/tmp/.../scratchpad/rigorous_stats.ts` (exact enumeration of all C(16,8)=12,870 rank partitions; 2,000-resample bootstrap with deterministic LCG seed=42 for CIs).

| Comparison | Exact MW p (two-sided) | Median Δ (y−x), 95% bootstrap CI | Hodges-Lehmann shift, 95% bootstrap CI | Rank-biserial r |
|---|---:|---|---|---:|
| A vs B | 0.6454 | −31.28 [−46.26, +27.97] | −3.41 [−39.34, +35.66] | +0.156 [−0.438, +0.750] |
| A vs C | 0.7209 | −36.35 [−41.82, +21.94] | −2.02 [−40.44, +7.44] | +0.125 [−0.469, +0.719] |
| A vs D | 0.9591 | −35.09 [−48.76, +49.47] | −2.57 [−43.65, +48.01] | +0.031 [−0.594, +0.688] |
| B vs D | 1.0000 | −3.81 [−45.76, +65.75] | +0.08 [−41.12, +53.50] | +0.000 [−0.594, +0.625] |

Cross-check: exact MW vs normal-approx (tied-rank-adjusted) p-values agree within 0.046 (max divergence on A-vs-B). The hand-rolled normal-approx implementation was independently cross-validated against the exact enumeration which is the canonical reference at this n.

### Wipeout gate

```bash
$ npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts \
    --experiment-id ef2d1dc2-4a9b-4f19-9ece-d04fb175c5e6 --json
{"target":"staging","experimentId":"ef2d1dc2-...","count":0,"wipeouts":[]}
```

No runs match the arena-only wipeout fingerprint. No runs excluded from the analysis.

### 6 standard funnel queries

Full queries: `evolution/scripts/analysis/{funnel_per_arm_variants, funnel_per_arm_invocations, funnel_per_arm_decisive_matches, funnel_per_arm_top_elo_gain, judge_decisiveness_distribution, per_arm_cost_breakdown}.sql`. Materialized results at `/tmp/.../scratchpad/funnel/*.json`. Aggregates reproduced in `## Balance Audit` and `## Decisiveness Audit` below.

## Pre-Registered Analysis Plan

Verbatim from `_planning.md ## Pre-Registered Analysis Plan`:

### Arms
| Arm | Label | Agent | Knob changed | Strategy reuse? |
|---|---|---|---|---|
| **A** | Coherence-Pass-Baseline | `paragraph_recombine_with_coherence_pass` | None (matches `fe314a1e-…`) | YES — `--reuse-existing` |
| **B** | Coherence-Pass-OFF | `paragraph_recombine_with_coherence_pass` | `coherencePassEnabled: false` + `perInvocationCapUsd: 0.10` (matches `0cd27136-…`) | YES — `--reuse-existing` |
| **C** | Sequential-Stronger-Coordinator | `paragraph_recombine` (sequential, NOT coherence pass) | `coordinatorModel: 'gpt-5-mini'` over gemini-flash-lite baseline | NEW strategy |
| **D** | Coherence-Pass-Stronger-Phase-C | `paragraph_recombine_with_coherence_pass` | `coherencePassProposerModel + coherencePassApproverModel: 'gpt-5-mini'` | NEW strategy |

### Runs per arm
8 runs/arm × 4 arms = 32 total runs at $0.10/run = $3.20 budget cap.

### Named statistical test
Mann-Whitney U (two-sided, α=0.05) on per-run top-variant final Elo. Arm pairs: A vs B / A vs C / A vs D / B vs D.

### Threshold (decision rule)
PASS ⇔ Mann-Whitney p < 0.05 AND median top_elo delta > +10 Elo. FAIL ⇔ either unmet. INCONCLUSIVE ⇔ p < 0.05 AND |median delta| < 10.

**Deviations from plan:** None. All 32 runs completed cleanly with zero wipeouts. The decision-rule conjunction was applied mechanically (4 of 4 = FAIL). The PRAP did not pre-register effect-size or CI reporting; both are added in this EAR as supplements (not substitutes) for the pre-registered tests, per the Statistical Validity reviewer guidance.

## Balance Audit

### Table B — Experimental Validity Funnel

| Arm | runs_queued | runs_completed | invocations_total | invocations_success | invocations_failed | invocations_skipped | variants_produced (article) | variants_synced_to_arena (article) | matches_played | matches_decisive (@0.6) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A — CP-Baseline (7a494f)** | 8 | 8 | 134 | 125 | 9 | 0 | 312 | 312 | 1,644 | 276 (16.8%) |
| **B — CP-Off (66f213)** | 8 | 8 | 138 | 126 | 12 | 0 | 358 | 358 | 1,760 | 316 (18.0%) |
| **C — Seq + Stronger Coord (578ddb)** | 8 | 8 | 134 | 124 | 10 | 0 | 150 | 150 | 352 | 112 (31.8%) |
| **D — CP + Stronger Phase C (2f2de1)** | 8 | 8 | 132 | 122 | 10 | 0 | 216 | 216 | 949 | 177 (18.7%) |

Invocation totals computed via `SELECT count(*), sum(success), sum(skipped), sum(NOT success AND NOT skipped) FROM evolution_agent_invocations` joined to runs by experiment_id — see `/tmp/.../scratchpad/invocations.json`.

### Wipeout Resolution

No wipeouts detected — `detectArenaOnlyWipeouts.ts --experiment-id ef2d1dc2-…` returned `count: 0`. No runs dropped from analysis.

### Balance Notes

Per-arm parity at the runs_queued / runs_completed step is exact (8/8 across all arms). Invocation counts vary by ≤4.5% (max 138 = Arm B vs min 132 = Arm D), well below the 15% flag threshold. Failure rates vary 7–9% across arms (uniform). **Two cross-arm imbalances exceed the 15% flag and warrant explicit acknowledgment**:

1. **Variant-throughput asymmetry (Arm B 358 vs Arm C 150 = 2.4× ratio).** Driver: Arm B uses `paragraph_recombine_with_coherence_pass + coherencePassEnabled=false` which runs Phase A + B (per-slot rewrites + ranking) generating many slot variants but skips Phase C. Arm C uses the SEQUENTIAL `paragraph_recombine` agent with prior-context judging, producing fewer article-level variants per invocation. **This is structural** (different agents, different output cardinality), not a CI/runner artifact. **Affects top_elo interpretation**: the per-run top_elo metric is the MAX over a varying number of variants — Arm B has 2.4× more lottery tickets than Arm C, so a top_elo gap of 47 Elo (B 1337.98 vs C 1290.50) is partly attributable to sampling, not arm quality. The Mann-Whitney test on top_elo does NOT correct for this. (See Methodology § "Throughput-bias caveat" and Finding #6.)

2. **Match-decisiveness asymmetry (Arm C 31.8% vs Arms A/B/D 16.8–18.7%).** Arm C's sequential paragraph_recombine agent uses paragraph-level judging with PRIOR CONTEXT passed into the judge prompt (per `buildComparisonPrompt`'s `paragraph` mode `<UNTRUSTED_PRIOR>` block). Coherence-pass agents (Arms A, B, D) use paragraph-level judging without prior context. **Affects cross-arm Elo interpretation**: per-slot Elos still collapse into the same article-level pool, but Arm C's judge sees a structurally different prompt — if there is a systematic prompt-priming effect on ranking, it would inflate or deflate Arm C's article-level Elos relative to the other arms. We cannot rule this out from the data alone.

Other minor variations (variant counts 216/312/358 across CP arms; matches 352–1760) are explained by per-arm agent + Phase C on/off differences and are themselves structural.

## Decisiveness Audit

Per `evolution/scripts/analysis/judge_decisiveness_distribution.sql` with `DECISIVE_CONFIDENCE_THRESHOLD = 0.6` from `evolution/src/lib/shared/rating.ts`:

| Arm | total matches | bucket 1.0 | bucket 0.7 | bucket 0.5-TIE | bucket 0.3 | bucket 0.0 | decisive_pct @0.6 |
|---|---:|---:|---:|---:|---:|---:|---:|
| **A — CP-Baseline (7a494f)** | 1,644 | 353 | 38 | 1,253 | 0 | 0 | 16.8% |
| **B — CP-Off (66f213)** | 1,760 | 407 | 33 | 1,320 | 0 | 0 | 18.0% |
| **C — Seq + Stronger Coord (578ddb)** | 352 | 111 | 9 | 232 | 0 | 0 | 31.8% |
| **D — CP + Stronger Phase C (2f2de1)** | 949 | 210 | 25 | 714 | 0 | 0 | 18.7% |

**Asymmetry callout**: Arm C is ~2× as decisive as Arms A/B/D. As explained in Balance Notes, this is a structural property of the sequential agent's prior-context-aware judge prompt vs the coherence-pass agent's isolated paragraph judge. **This is a cross-arm validity threat** — Arm C's higher decisive rate could either (a) reflect a genuinely-better judge that sees richer context, in which case Arm C's article Elos are more reliable than the others, or (b) reflect priming/anchoring from the prior-picks block, in which case Arm C's Elos are systematically biased. The experiment does not distinguish these mechanisms.

**Position-bias %**: not computed. The judge-decisiveness query as written does not pair the 2-pass reversal trials needed for position-bias measurement. This is a gap from a cross-arm validity standpoint — we cannot rule out a position-bias asymmetry that aligns with the agent-type asymmetry above. The omission is consistent with prior FR2 EARs (CoherencePassPerf, CoherencePassMode, CoherencePassEnabled) but is **flagged here as a real validity limitation, not justified by precedent**.

The 0-count `bucket_0_3` and `bucket_0_0` rows across ALL arms indicate the judge effectively never returns "low-confidence disagreement" — every match is either decisively won (1.0/0.7) or judged as a 0.5 tie. Consistent with the `paragraph_recombine` and `paragraph_recombine_with_coherence_pass` judging prompts (Decisions §B1, TIE-discouraging but TIE-permitting at uncertainty).

## Causal Evidence

> **Section-level disclaimer (Statistical Validity reviewer guidance):** the formal Mann-Whitney tests do not reject the null for ANY arm pairing. Patterns described below are **observational descriptions of what happened in these 32 runs**, not causal claims.
>
> **Mechanism-flag legend** (used throughout this section):
> - **"Mechanism (proposed but not verified)"** — a candidate causal story is named but cannot be tested with the current data (would require a counterfactual run).
> - **"Mechanism (observed-not-explained)"** — the pattern is reproducible in the data but no candidate causal mechanism is offered.

### Pattern: "Per-arm top variant comes from seed-phase generate in 3 of 4 arms, recombine in 1 of 4" (supports Finding #3)

Concrete examples — **observed in 3 of 4 arms (A, B, C) and reversed in 1 of 4 (D)**:

| Arm | Per-arm top variant | Agent | Elo | run_id | agent_invocation_id |
|---|---|---|---|---|---|
| A | `2c8959c9-54c7-43fd-b11e-96f805183ad7` | `grounding_enhance` (iter-0 generate) | 1291.60 | `100094b9-c532-4047-b396-d7c1807c0e0e` | `3e2b7412-fecf-45b5-98ad-57a78309edc1` |
| B | `f0e53fe5-aafd-4749-9adf-a7877c6d2d01` | `grounding_enhance` (iter-0 generate) | 1337.98 | `bc0e8573-fa93-4c13-b72a-7613c42a68a4` | `e0144c07-8899-4030-9ecf-9804ccc548e4` |
| C | `95c83b8b-6343-4c1a-a2ed-8ccafe1a21c5` | `grounding_enhance` (iter-0 generate) | 1290.50 | `75de7eb6-da75-4f4e-87c2-e22d265d4729` | `cf8e1be4-04f0-458e-b3a2-90fa85888c54` |
| D | `c67580a0-e87c-4a3b-8fd6-d64a3c525245` | `paragraph_recombine_with_coherence_pass` | **1376.53** | `92a0a822-a716-44a4-b959-1f626128060f` | `bcf7cb78-5277-4561-8ef8-0ece7b816978` |

**Mechanism (proposed but not verified)**: in Arms A/B/C, the seed-phase `grounding_enhance` tactic produces a tight upper-tail (1290–1338 Elo) that the coherence-pass or sequential recombine agents do not surpass. In Arm D, the stronger Phase C models (gpt-5-mini proposer + approver) appear to allow occasional outlier-high recombine outputs. **Not verified**: a counterfactual run of Arm D with default Phase C on the same seed-pool would be needed to confirm causation; the cross-arm correlation alone is insufficient.

**Per-arm top recombine-only variant** (≥1 example per arm, with invocation IDs):

| Arm | Top recombine variant | Elo | agent_invocation_id |
|---|---|---:|---|
| A | `572ff1fd-15ca-4f1e-bbfd-1697a61400d0` | 1286.30 | `35538b00-4a61-4322-a8eb-0dfebc3d1391` |
| B | `a9d29ce6-f29b-4439-ba11-70ee95b45e8b` | 1290.53 | `a389c369-4afd-4786-9c1e-a956114bf397` |
| C | `d62cdee1-c3c6-459e-9431-06c45c116a6a` | 1284.11 | `ab597f02-cbbc-465e-88b0-a5cd6c187433` |
| D | `c67580a0-e87c-4a3b-8fd6-d64a3c525245` | 1376.53 | `bcf7cb78-5277-4561-8ef8-0ece7b816978` |

In Arms A and B the top recombine variant is within 5 Elo of the per-arm overall top (recombine essentially matches generate); in Arm C the gap is 6 Elo; in Arm D the recombine **wins** the overall top.

### Pattern: "Arm D shows bimodal high-variance recombine output" (supports Finding #4)

**Observed in 8 of 8 Arm-D runs**: the per-run top recombine variant lands in one of three rough clusters — 5 of 8 in a low band 1206–1249 (per-run top_elos 1206.29, 1234.34, 1239.47, 1246.61, 1249.40), 2 of 8 in a mid band 1295–1325 (1295.00, 1325.22), and 1 of 8 as an outlier-high (1376.53). The ~46 Elo gap between the low and mid clusters (1295.00 − 1249.40) and the ~51 Elo gap between the mid cluster and the outlier (1376.53 − 1325.22) are larger than the within-cluster spreads (≤44 Elo for the low cluster, ~30 Elo for the mid cluster, n=1 for the outlier).

Arm D top-10 recombine variants by Elo (descending, all with agent_invocation_id):

| rn | variant_id | Elo | run_id | agent_invocation_id |
|---:|---|---:|---|---|
| 1 | `c67580a0-…` | 1376.53 | `92a0a822-…` | `bcf7cb78-5277-4561-8ef8-0ece7b816978` |
| 2 | `611b682d-…` | 1248.62 | `99b30ffe-…` | `b8a0911c-1485-4d37-9058-d45ddb5afd89` |
| 3 | `069a6af1-…` | 1246.61 | `fff461f9-…` | `8cc66df1-3b18-4850-8e45-22beb44d6e9a` |
| 4 | `acdf9d8b-…` | 1244.66 | `f4e82f9d-…` | `832feeea-e6ff-4a14-8478-19754ab62149` |
| 5 | `ca677c6c-…` | 1236.87 | `a127aa71-…` | `e4922063-6de5-42be-b5ea-5c3ae5213ad8` |
| 6 | `c4bcc4aa-…` | 1234.34 | `62c13f40-…` | `04634574-8db3-4789-9389-07fcca012c87` |
| 7 | `d374be67-…` | 1206.29 | `90fb68a2-…` | `f4db8c0f-fa9d-4bec-a560-7789903c5b7c` |
| 8 | `0fe42796-…` | 1205.69 | `90fb68a2-…` | `37fa45f2-ae8f-4ae0-b2db-caaafe3d35b3` |
| 9 | `2084714d-…` | 1200.79 | `fff461f9-…` | `1114690c-4e0c-45ed-9ffb-dfa451eafcf0` |
| 10 | `567b4af7-…` | 1196.09 | `92a0a822-…` | `17661d5c-eb87-4306-b8f2-0f1f1d056e6f` |

**The 128-Elo gap** between rn=1 (1376.53) and rn=2 (1248.62), followed by a cluster spanning 1196–1248, is direct evidence of separation in the OBSERVED variant-level data. (Note: this table is the top-10 recombine variants ACROSS Arm D's 8 runs, NOT the per-run top_elos — so it includes more than one row per run. The per-run top_elo distribution is the three-cluster pattern enumerated above.) In contrast Arm A's top 5 recombine variants are clustered within 37 Elo (1286.30 / 1284.17 / 1284.01 / 1283.31 / 1249.33).

**Alternative interpretation (n=8 caveat):** at per-run granularity the Arm D distribution is 5 low + 2 mid + 1 outlier (n=8), which is also consistent with a unimodal high-variance distribution where the upper tail happened to be sampled twice. Distinguishing "true tri/bi-modal" from "unimodal high-variance" requires more runs; the descriptive cluster framing above describes the observed shape, not a claim about the underlying generator.

**Mechanism (observed-not-explained)**: the stronger Phase C proposer (gpt-5-mini) appears to occasionally produce a much-stronger article (outlier-high) and otherwise produce no improvement. Sampling Arm D's `execution_detail.coherencePassMode/B/proposerCycle` JSON for runs `92a0a822` (the outlier) vs `90fb68a2` (a low-end run) would surface whether the difference is in number of cycles, in length-cap engagement, or in approver veto rates — out of scope for this EAR; flagged in Follow-up Idea #4.

### Pattern: "Arm C shows the same bimodal behavior at lower amplitude" (supports Finding #5)

**Observed in 8 of 8 Arm-C runs**: similar to Arm D, the per-run top recombine variant lands in one of three clusters — above 1284 (3 of 8 runs: 1284.11, 1286.97, 1290.50), in a tight band 1245–1248 (3 of 8 runs: 1245.11, 1245.83, 1247.65), or below 1245 (2 of 8 runs: 1234.23, 1242.87). Approximated as "bimodal" because the 1245–1248 and below-1245 clusters are 12 Elo apart vs the 36 Elo gap above 1284.

Arm C top 5 recombine variants (all with agent_invocation_id):

| rn | variant_id | Elo | run_id | agent_invocation_id |
|---:|---|---:|---|---|
| 1 | `d62cdee1-c3c6-459e-9431-06c45c116a6a` | 1284.11 | `4278a9d1-…` | `ab597f02-cbbc-465e-88b0-a5cd6c187433` |
| 2 | `a386e8ae-a10c-4ef0-8f68-145aff5ba3d1` | 1247.80 | `75de7eb6-…` | `1c0a7089-69c0-4892-8669-0cb2ab47f4ba` |
| 3 | `b80aa408-34a6-452c-bb1d-cf9934da43c4` | 1247.65 | `9e38b287-…` | `4ee17296-f168-4ca5-839a-f911d2cd484a` |
| 4 | `17bd0a7b-3b31-457c-8bcb-ed97574a5a4b` | 1245.83 | `761d12be-…` | `f0961662-87f6-48b9-a633-aca7030045fb` |
| 5 | `48e7615b-364a-42ab-8f06-dfb034b1c0b0` | 1245.11 | `adf94c36-…` | `dd3734a4-60a5-429e-a188-5045df99932e` |

The 36 Elo gap between rn=1 (1284.11) and rn=2 (1247.80) is the within-arm bimodality signal; rn=2–5 are within 2.7 Elo of each other (1247.80 / 1247.65 / 1245.83 / 1245.11 — extremely tight).

**Mechanism (proposed but not verified)**: as with Arm D, the bimodality *could* reflect a true coordinator-quality lever (gpt-5-mini coordinator produces qualitatively-different per-paragraph directives on some inputs but not others) OR sampling noise at n=8. No counterfactual run is available, so the candidate mechanism remains unverified.

### Pattern: "Throughput asymmetry across arms" (supports Finding #6)

**Per-arm article-variant counts** (from Balance Audit Table B): A 312 / B 358 / C 150 / D 216. Total: 1,036 variants. Variant counts scale roughly with the agent's per-invocation output cardinality, which is structurally different across agents — no causal claim needed.

**Mechanism (observed-not-explained at the per-variant level)**: the agent-level structural mechanism is well-understood (sequential paragraph_recombine in Arm C ⇒ fewer slot variants reach article-level than the parallel coherence-pass agent's Phase A + B). The per-variant Elo *consequences* of that mechanism — does throughput translate to ceiling lift, and at what conversion ratio — are observed-not-explained: the data show throughput did NOT translate to a proportional ceiling lift (B's 2.4× throughput over C yielded only 47 Elo of top-end gap), but no mechanistic model is offered for why.

**Per-arm match counts** (from Decisiveness Audit Table): A 1,644 / B 1,760 / C 352 / D 949. Arm C's 4–5× smaller match count is a *direct consequence* of the sequential agent's reduced per-slot match generation (it doesn't run parallel slot ranking).

## Adversarial Review Log

### Iteration 1 (2026-06-30)

Reviewers: Methodology, Statistical Validity, Causal Evidence (Plan agents).

Reviewer JSON outputs persisted to `.claude/review-state/analysis-review-EAR.json` (gitignored). Aggregate min score 2/5, 16 critical gaps across 3 reviewers.

**Fixes applied in iteration 2 of EAR.md:**
1. Removed literal "actually wait, this needs cross-checking" in-progress draft text (line 194 of v1).
2. Corrected Finding #3: the experiment's TOP overall variant in Arm D is from `paragraph_recombine_with_coherence_pass` (1376.53), NOT from `structural_transform` as v1 incorrectly stated. Variant attribution re-queried from DB (`SELECT id, agent_name FROM evolution_variants WHERE id='c67580a0-…'` confirmed agent_name='paragraph_recombine_with_coherence_pass').
3. Downgraded Findings #2/#4/#5 from causal language ("REDUCED quality", "the cleanest signal that the fix is working") to observational language with explicit "Not a causal claim" disclaimers.
4. Added effect-size estimates to all four MW comparisons: Hodges-Lehmann shift with 2,000-resample bootstrap CIs, rank-biserial r, median Δ with bootstrap CI.
5. Switched primary MW reporting from normal-approximation to **exact enumeration** of all 12,870 rank partitions (no ties → exact is feasible at n=8/8). Cross-checked against normal-approx (max divergence 0.046 on A-vs-B).
6. Added multiplicity statement (FWER 0.1855 under independence for 4 tests; no correction applied because all p ≫ 0.5; would not change any verdict).
7. Added throughput-bias caveat on top_elo metric in both Methodology and Balance Notes.
8. Added power-claim caveat (rule-of-thumb, not derived from a specific distribution).
9. Filled in Balance Table B's invocation counts for all 4 arms (re-queried from `evolution_agent_invocations`).
10. Added agent_invocation_ids to every variant cited in Causal Evidence.
11. Reframed Causal Evidence section: removed all single-example claims, added "observed in N of M" framing for every pattern.
12. Reconciled header total ($2.31 → $2.30 + footnote).
13. Added section-level disclaimer to Causal Evidence: "Patterns described below are observational, not causal."
14. Added Follow-up Idea #4 (Arm D bimodal pattern investigation via execution_detail JSON) and #5 (grounding_enhance prevalence sanity check).

### Iteration 2 (2026-06-30)

Reviewers: Methodology, Statistical Validity, Causal Evidence (re-review of the iter-1-fixed EAR).

Aggregate: min score 4/5, zero critical gaps, 19 minor issues distributed across the 6 sections.

**Fixes applied in iteration 3 (this version):**

1. **Conjunction-rule type-II inflation** named explicitly in Methodology (it compounds the underpowered status — FAIL is the product of two error sources).
2. **Bonferroni-corrected α = 0.0125 stated explicitly** + Holm-Bonferroni stepdown + BH-FDR all called out by name. All four observed p exceed Bonferroni-corrected α by 50–80×.
3. **Exact MW promoted to "canonical reference for headline p-values"** in Methodology (not just buried in Queries & Results).
4. **Rank-biserial r 95% bootstrap CIs added** to all four comparisons. All CIs span r=0 → cannot reject "no stochastic dominance" at n=8.
5. **CI WIDTH emphasized in Finding #1 and #2** as the primary inferential output ("the experiment cannot distinguish 'true effect smaller than ~40 Elo' from 'no effect'").
6. **"Not evidence of equivalence" stated inline at Finding #1** (not just in the disclaimer).
7. **Asymmetric power note**: A-vs-D and B-vs-D have wider HL CIs (~90 Elo) than A-vs-B and A-vs-C (~75 Elo); the non-rejections involving Arm D are flagged as most fragile.
8. **Percentile bootstrap variant specified** explicitly in Methodology (vs BCa or studentized; trade-off noted).
9. **Mechanism-flag legend added** to Causal Evidence section opener (defines "proposed but not verified" vs "observed-not-explained").
10. **Arm C bimodal table** completed: rows 3, 4, 5 backfilled with real variant_ids + Elos + agent_invocation_ids (no more "(not queried)" / "approx" placeholders).
11. **Arm D bimodal table** completed: all 10 rows now carry agent_invocation_id.
12. **Finding #5 single-pair anecdote** restated with "N of M" framing: "across 8 of 8 Arm-C runs, top recombine lands either above 1284 (1 of 8 runs) or 1245–1248 (7 of 8 runs)".
13. **n=8 unimodal-vs-bimodal alternative caveat** added to Arm D bimodal pattern: "1 outlier + 9 tight" at n=10 is also consistent with unimodal high-variance.
14. **Cross-check phrasing** unified to "max divergence 0.046" throughout (no more "within 0.05" mix).

### Iteration 3 (2026-06-30)

Reviewers: Methodology, Statistical Validity, Causal Evidence (re-review of the iter-2-fixed EAR).

Aggregate: Methodology 5/5/5/5/5/5 (zero critical, 6 minor); Statistical Validity 5/5/5/5/5/5 (zero critical, 5 minor); Causal Evidence 5/5/5/5/4/5 (zero critical, 3 minor — 2 internal inconsistencies between Finding #5 and Causal Evidence section's N-of-M counts, 1 mechanism-flag mislabeling). Total min score 4 due to Causal Evidence inconsistencies.

**Fixes applied in iteration 4 (this version):**
1. **Finding #5 N-of-M corrected**: was "1 of 8 above 1284 / 7 of 8 in 1245–1248" (wrong — Arm C actually has 3 of 8 above 1284, 3 of 8 in 1245–1248, 2 of 8 below 1245). Restated as three-cluster framing.
2. **Arm D bimodal framing rewritten** (iter-4 first attempt had "tight cluster between 1206 and 1249" but that was contradicted by 1295.00 and 1325.22 in the listed values; iter-4 second pass repaired to three-cluster framing matching Arm C: 5 of 8 in 1206–1249, 2 of 8 in 1295–1325, 1 of 8 outlier at 1376.53).
3. **Arm C mechanism flag relabeled** from "observed-not-explained" to "proposed but not verified" — the section DID offer a candidate mechanism (gpt-5-mini coordinator quality lever), which is by the legend a "proposed" flag.
4. **Throughput-asymmetry pattern flag added**: was untagged in iter-3; tagged as "observed-not-explained at the per-variant level" (agent-level structural mechanism known, per-variant Elo consequences not).
5. **Holm-Bonferroni and BH-FDR wording tightened**: the iter-3 phrasing conflated step direction and per-rank threshold. Restated with explicit rank-i critical values.
6. **Adversarial Review Log structural cleanup**: iter-2 fixes 4-14 were orphaned under the iter-2 review header instead of remaining under the iter-1 header. Renumbered + relocated.

### Iteration 4 (2026-06-30)

Reviewers: Methodology, Statistical Validity, Causal Evidence (re-review of the iter-3-fixed EAR).

Aggregate: M 5/5/5/5/4/5; SV 5/5/5/5/4/5; CE 5/5/5/5/4/5. All 3 reviewers independently flagged the same regression — the iter-3 Arm D bimodal framing "tight cluster between 1206 and 1249" contradicted by listed values 1295.00 and 1325.22 in the same group. Total min score 4.

**Fixes applied in iteration 5 (this version):**
1. **Arm D three-cluster framing**: per-run top_elos restated as 5 of 8 low (1206–1249), 2 of 8 mid (1295–1325), 1 of 8 outlier (1376.53). Within-cluster spreads (43.11, 30.22) smaller than between-cluster gaps (45.60 low→mid; 51.31 mid→outlier). Matches the Arm C three-cluster framing pattern.
2. **Finding #2 CI widths corrected**: A-vs-B ~75 Elo, A-vs-C ~48 Elo (was incorrectly stated as ~75 in iter-3), A-vs-D ~92 Elo, B-vs-D ~95 Elo.
3. **Per-run vs variant-level distinction** clarified in Arm D Causal Evidence section: top-10 recombine variants table is variant-level (10 rows across all 8 runs, more than 1 row per run); the three-cluster framing applies to per-run top_elo (n=8).
4. **Coincidence note added** to Methodology multiplicity section: Bonferroni and the rank-1 thresholds of Holm and BH all coincide at α/m = 0.0125 by construction for any m at rank 1; the three corrections diverge at higher ranks.
5. **Iter-4 fix-log entry** for the Arm D framing now describes both the first attempt (1206-1249, wrong) and the iter-5 second-pass repair (three-cluster matching Arm C).
6. **Gap arithmetic refined post-reviewer-flag**: the iter-5 first draft said "51 Elo gap between the low and mid clusters" but actual is 45.60 (1295.00 − 1249.40); restated as "~46 Elo low→mid gap and ~51 Elo mid→outlier gap" with explicit arithmetic.
