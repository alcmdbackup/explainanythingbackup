# Analyze Performance Self Critique Agent — Experiment Analysis Report (EAR)

## Header
- **Project:** docs/planning/analyze_performance_self_critique_agent_20260630/
- **Branch:** feat/analyze_performance_self_critique_agent_20260630
- **Experiment ID:** bc10c2e0-a51c-41a8-a2c3-34577a1fa489
- **Arena prompt ID:** 6f5c85e5-0d6f-42f3-ba91-cbf2377f2317 (`ELOEXP Federal Reserve seed 20260626 real1`)
- **New strategy ID:** 6c7f7349-a4f1-421e-9999-0c063f4b1e60 (config hash `v2:cddae8f1e…`)
- **Date:** 2026-07-01
- **Skill version:** /run_experiment_analysis@ (this branch)
- **Sister EAR (base for direct comparison):** [`docs/analysis/elo-agent-comparison-federal-reserve-2-20260628/`](../../../docs/analysis/elo-agent-comparison-federal-reserve-2-20260628/)

## Methodology

Ten runs of the new `self_critique_revise` arm were appended to the sister experiment `bc10c2e0` using the same arena, seed variant, models, and budget as the 9-agent sister comparison. Each run is a single-iteration off-seed strategy: `{ agentType: 'self_critique_revise', sourceMode: 'seed', budgetPercent: 100 }`, model `google/gemini-2.5-flash-lite` for both generation and judging, `generationTemperature: 1`, `budgetUsd: 0.10`, `maxComparisonsPerVariant: 3`. This design isolates the treatment axis to `agentType`.

**Rating-drift caveat (important):** the arena is shared with the sister experiment, so adding 10 self_critique_revise runs (~750 new arena comparisons; 4,518 → **5,266 total matches**) triggered a deterministic recomputation of every arm's Elo. The sister EAR's numbers (P(best), medLift, etc.) are a snapshot at 4,518 matches; ours are at 5,266. In practice the ranking held stable — `reflect_and_generate` still wins the ceiling at +165.5 medLift — but published numbers should cite their cutoff match count.

**Primary test (per PRAP):** Bootstrap **P(best)** across all 10 arms + Bootstrap **one-sided** diff-of-medians for `self_critique_revise` vs `generate` (alternative: `self_critique_revise > generate`), Holm-corrected across the 9 vs-`generate` tests (all 9 non-generate arms in the 10-arm ranking), α=0.05, minimum meaningful effect size = +40 Elo.

**Bootstrap protocol** (from `evolution/src/lib/metrics/abComparison.ts` → `pBestAnalysis` and `vsBaselineHolm`, invoked by `analyzeEloAgentComparison_20260626.ts`):
- **Resamples:** 10,000 bootstrap iterations per contrast (default in `abComparison.ts`).
- **Resample unit:** per-run max-Elo-lift (10 values per arm) — NOT variant-level. This matches the primary DV.
- **Seed:** `createSeededRng` initialized from the experiment_id (deterministic + reproducible).
- **CI construction:** 95% CI reported as two-sided percentile intervals `[2.5%, 97.5%]` — but the significance p-value is computed against the ONE-SIDED alternative (arm > baseline). `[-42, +16]` includes zero because the two-sided CI happens to span zero when the point estimate is negative; the one-sided Holm-p = 1.000 is the primary decision variable.

Computed by `npx tsx evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts --experiment-id bc10c2e0-… --prompt-id 6f5c85e5-… --baseline generate --threshold 40` (no script edit needed; arms auto-discover via `armOf(config)`).

**Multiplicity structure — disclose post-hoc append.** The sister experiment's promoted EAR used an 8-family Holm (its 9 arms minus `generate`). This project's PRAP pre-registered `self_critique_revise` as a 10th arm BEFORE any 9-family Holm computation on the appended data, and both were computed against the same bc10c2e0 comparison log at the 5,266-match cutoff. **No verdict from the sister EAR flipped under recomputation** — `reflect_and_generate` Δ vs generate moved from +34.2 [-6, +78] Holm-p 0.228 (sister at 4,518 matches, 8-family) to +34.2 [-6, +78] Holm-p 0.257 (our cutoff at 5,266 matches, 9-family). The +$0.03 Holm-p bump reflects the 9-family correction; the median lift and CI are unchanged to 1 decimal. All 8 originally-negative Δ vs generate arms retain Holm-p = 1.000 in both computations. This project's `self_critique_revise` contrast is a pre-registered inclusion in the 9-family Holm.

**Secondary test (per PRAP):** Bootstrap Δ of medians `self_critique_revise` vs `reflect_and_generate`, single planned contrast, descriptive-only (n≈44/arm would be needed for a formal verdict on plausible wrapper-vs-wrapper effect sizes).

**Outlier rule:** zero-variant runs count as 0-lift (imputation, not exclusion). Failed runs get 0-lift. No cost-outlier exclusion (budget is hard-capped at $0.10/run).

**Verdict thresholds (per PRAP):**
- **PASS** ⇔ median max-lift/run ≥ +131 AND Holm-p < 0.10 AND Δ vs generate ≥ +40 Elo.
- **FAIL** ⇔ median < +40 OR (Holm-p ≥ 0.10 AND Δ ≤ 0).
- **INCONCLUSIVE** ⇔ everything else (triggers tranche-2 recommendation).

**Cutoff snapshot:** analysis performed 2026-07-01 at 5,266 comparisons across 100 runs. The `self_critique_revise` arm marginal spend was **$0.83** (10 runs × $0.10 cap, 83% utilization).

## Key Findings

### Table A — Test-vs-Control Metrics Summary (10 arms, recomputed from 5,266 comparisons)

Seed anchor Elo = **1175.9** (`92987346-b211-449b-9b2b-127feec89b7c`). All arms n=10 runs.

| Arm | runs (c/q) | article variants (ranked) | top_elo | med_elo | top_elo_Δ_vs_seed | med max-lift/run | **med Δ/inv** | mean Δ/inv | **%var>seed** | %impr | **%impr≥40** | P(best) | P(top40) | Δ vs gen [95% CI] | Holm-p | budget/run | total_budget | total_spent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reflect_and_generate | 10/10 | 352 (244) | 1341.4 | 1263.5 | +165.5 | +165.5 | **+61.0** | +62.9 | 94% | 100% | 90% | **96%** | 100% | +34.2 [-6, 78] | 0.257 | $0.10 | $1.00 | $0.980 |
| generate (baseline) | 10/10 | 474 (317) | 1307.2 | 1220.6 | +131.3 | +131.3 | +31.1 | +9.7 | 64% | 100% | 90% | 4% | 67% | — (baseline) | — | $0.10 | $1.00 | $0.969 |
| **self_critique_revise** ⭐ | 10/10 | **250** (250) | 1329.3 | 1247.9 | +153.4 | **+102.3** | **+8.1** | +29.8 | 88% | 100% | **100%** ⭐ | 0% | 11% | -29.0 [-42, 16] | 1.000 | $0.10 | $1.00 | **$0.831** |
| criteria_and_generate | 10/10 | 348 (235) | 1253.3 | 1198.8 | +77.4 | +77.4 | +18.9 | +18.0 | 81% | 100% | 80% | 0% | 0% | -53.9 [-83, -9] | 1.000 | $0.10 | $1.00 | $0.954 |
| iterative_editing_rewrite | 10/10 | 171 (168) | 1251.0 | 1197.5 | +75.1 | +75.1 | +3.7 | +3.1 | 63% | 100% | 90% | 0% | 1% | -56.2 [-86, -8] | 1.000 | $0.10 | $1.00 | $0.978 |
| single_pass_criteria | 10/10 | 344 (241) | 1249.4 | 1200.9 | +73.5 | +73.5 | +19.1 | +15.2 | 76% | 100% | 70% | 0% | 1% | -57.8 [-93, -14] | 1.000 | $0.10 | $1.00 | $0.964 |
| iterative_editing | 10/10 | 118 (117) | 1230.8 | 1195.1 | +54.9 | +54.9 | +6.5 | +14.3 | 78% | 100% | 80% | 0% | 0% | -76.4 [-94, -27] | 1.000 | $0.10 | $1.00 | $0.991 |
| proposer_approver | 10/10 | 263 (200) | 1217.5 | 1198.8 | +41.6 | +41.6 | +3.1 | +2.9 | 57% | 100% | 70% | 0% | 0% | -89.7 [-103, -42] | 1.000 | $0.10 | $1.00 | $0.986 |
| paragraph_recombine_coherence | 10/10 | 43 (43) | 1182.8 | 1157.0 | +6.9 | +6.9 | **-5.8** | -0.9 | 44% | 60% | 20% | 0% | 0% | -124.4 [-139, -82] | 1.000 | $0.10 | $1.00 | $0.866 |
| paragraph_recombine | 6/10 (4 fail) | 7 (7) | 1178.8 | 1128.1 | +2.9 | +2.9 | +19.2 | +6.5 | 71% | 50% | 20% | 0% | 0% | -128.4 [-141, -78] | 1.000 | $0.10 | $1.00 | $0.586 |
| **Total/mean** | **96/100** | **2,370 (1,805)** | — | — | — | — | — | — | 74% | — | — | — | — | — | — | — | **$10.00** | **$9.10** |

Legend:
- **variants (ranked)** = article variants (`variant_kind='article'`) with `arena_match_count ≥ 1`. Paragraph slot variants excluded from throughput.
- **%var>seed** = share of an arm's *ranked* article variants with Elo > seed_anchor Elo (1175.9) — **per-variant quality density, throughput-unbiased**.
- **med max-lift/run** = median across the arm's 10 runs of `max(Elo of the run's variants) - seed_Elo`. Primary DV.
- **med Δ/inv** = median across ALL of an arm's ranked article variants of `variant_Elo - seed_Elo`. **Per-invocation quality density** (throughput-unbiased) — the median lift the typical variant achieves. Frequently ranks arms differently from `med max-lift/run` because the max-over-variants ceiling is high-variance and shots-on-goal sensitive; the median Δ/inv is more robust and comparable to the sister EAR's historical child-vs-parent metric. Reflect leads (+61.0) followed by generate (+31.1) — generate's median-per-variant is high but the mean (+9.7) is dragged down by low-Elo outliers (LEFT skew), exposing the "high variance / high ceiling" pattern. **Self_critique's inverse pattern (median +8.1, mean +29.8) shows RIGHT skew**: the typical variant is only modestly above seed but a small tail of high-Elo variants pulls the mean up +21.7 above the median.
- **mean Δ/inv** = the arithmetic mean for cross-check; the median-vs-mean divergence reveals distribution skew (reflect's tight ≈61/63 vs generate's asymmetric 31/10 vs self_critique's inverted 8/30).

> **Anchor convention:** `med Δ/inv` and `mean Δ/inv` use the live-DB seed anchor Elo (~1191, from `evolution_variants.elo_score` of the pipeline-anchor row) rather than the recompute anchor (1175.9). This is intentional — the ≤15-Elo offset preserves ranking, and using the live anchor makes this experiment's per-invocation numbers directly comparable to the sister EAR's historical child-vs-parent metric. Other columns (top_elo_Δ_vs_seed, %var>seed, med max-lift/run) use the recompute anchor (1175.9).
- **Δ vs gen** = one-sided Bootstrap difference-of-medians against `generate`, 95% CI, Holm-corrected p-value. Δ CI is two-sided percentile (95%); the significance decision uses the one-sided Holm-corrected p.

### Numbered findings

1. **`self_critique_revise` FAILS the primary contrast vs `generate` under the pre-registered PRAP.** Median max-lift/run = **+102.3** (below `generate`'s +131.3 by -29.0 Elo). Holm-corrected one-sided p = 1.000. Δ 95% CI = **[-42, +16]** (two-sided percentile; the one-sided Holm-p is the primary decision variable) — the CI includes zero, so the difference is not statistically distinguishable from no-effect. FAIL condition `Holm-p ≥ 0.10 AND Δ ≤ 0` triggers cleanly. The pre-registered one-sided test was designed for ~80% power to detect a +40 Elo minimum meaningful effect at α=0.05 (per PRAP sample-size derivation from sister within-arm σ ≈ 38 Elo). The observed data satisfies the FAIL condition; the pre-registered hypothesis "self-critique's reflection premium buys real Elo gains vs a plain-GFPA baseline" is not supported at this sample size and design.

2. **`self_critique_revise` is the ONLY arm with 100% of runs meaningfully improving the seed (≥+40 Elo).** Reflect_and_generate and generate tie at 90%; the criteria/editing middle sits at 70-80%; paragraph arms at 20%. Every self_critique run's best variant scored between **1285.3 and 1329.3 Elo** — a tight [+109, +153] Elo lift range vs seed 1175.9 (`SELECT max(elo_score) … GROUP BY run_id` reproduced in `queries.sql`). Reliability is a real feature. **Mechanism is an open question** — the earlier hypothesis "parser rejections filter out low-value plans" is REJECTED by the Causal Evidence sample (see §Causal Evidence: the parseErrors are token-cap truncations, not semantic filtering). Possible alternative explanations: (a) free-form reflection scope-latitude producing consistently useful revisions, (b) chance at n=10, (c) some structural property of the reflection-then-rewrite decomposition. Left for tranche 2 investigation.

3. **Ceiling is lower than baseline because throughput is lower.** Self_critique produced only **250 article variants** at $0.83 spend (avg 25/run); `generate` produced 474 variants at $0.97 spend (avg 47/run — ~90% more variants per dollar). The max-lift DV is throughput-sensitive (more variants → more chances at a high-Elo outlier), so per-variant density and reliability rank self_critique highly (%var>seed = 88%, third overall behind reflect@94% and criteria@81%) even while the ceiling is lower.

4. **Cost-per-improver ($0.28) is 2.5× higher than `reflect_and_generate` ($0.11) at these sample sizes.** The reflection LLM call adds ~15% overhead to every variant attempt; combined with lower throughput per dollar and lower ceiling, self_critique's economic efficiency is worst among the top three arms. But this metric is very sample-sensitive (self_critique had only 3 improvers by the parent-Elo definition), so treat as directional.

5. **Vs `reflect_and_generate` (secondary, descriptive-only): self_critique lags by -63 Elo on median max-lift** (+102.3 vs +165.5). No formal test — the pre-registered PRAP said n≈44/arm would be needed for 80% power on plausible +20 Elo wrapper-vs-wrapper effects, and we're descriptive-only at n=10. But the point estimate is decisively for `reflect_and_generate`. Free-form reflection (self_critique) did NOT beat constrained-tactic reflection (reflect_and_generate) on this article.

6. **`changeKind` labels cluster heavily around "Mode shift" (~80% of invocations) but underlying `plan` bodies are diverse.** Sampled 5 invocations with clustered labels — each `plan` targeted a distinct concrete tactic (analogies, narrative scene-setting, jargon reduction, title replacement, tone rework). The clustering is prompt-anchor artifact (the reflection prompt enumerates "Mode shifts (e.g. abstract → concrete, theoretical → practical, dense → conversational, formal → narrative)" and the reflector regurgitates that vocabulary), not tactic collapse. Attribution breakdowns via `getAttributionDimension` will be noisy — the label is a lossy summary of the plan.

7. **11% invocation failure rate — root-caused to reflector OUTPUT TRUNCATION, not "bad plans" or unmatched formatting.** 31/282 self_critique_revise invocations returned `success=false` with `SelfCritiqueParseError`. Sampled 2/31 invocations (`2c042a32-…` and `cdd798d1-…`, see §Causal Evidence) — BOTH show well-formed `ChangeKind:` + `Summary:` blocks followed by output-length termination before `Plan:` is written. Comparison rates: reflect_and_generate 4/360 (1.1%), criteria_and_generate 5/353 (1.4%), generate 1/483 (0.2%), iterative_editing 17/599 (2.8%), paragraph_recombine 2/13 (15%). Self_critique's rate is highest among the top-tier arms. The 600-token cap on the reflection call combined with the reflector's tendency to write structured multi-paragraph plans is the cause. **Actionable follow-up: raise the reflection output cap** (e.g., 800-1000 tokens) — likely to reduce the failure rate and increase effective throughput without materially changing per-invocation cost (~$0.0002 per additional 100 tokens at gemini-2.5-flash-lite pricing).

8. **Judge decisiveness (27.4%) mid-range.** Above criteria/editing_rewrite/single_pass/proposer_approver (all 1-6%), similar to iterative_editing (26.5%), well below generate (53.7%) and reflect_and_generate (45.6%). Not a confound blocker for the primary contrast — self_critique and its comparators (generate, reflect) span the full decisiveness range, but the direction of confounding (higher decisiveness → higher observed lift) means self_critique's ceiling is IF ANYTHING slightly UNDERSTATED by the decisiveness gap vs generate, not overstated.

9. **The best self_critique variant (Elo 1329.3, `14b0e150-14ec-45c1-a6e4-9f91183289fb`)** used changeKind "Mode shift (dense → conversational and theoretical → practical)". Second-best (Elo 1328.5, `243f7548-a7a6-4aca-9946-cedb644ca809`) used "Targeted rewrites and mode shifts". Both from smoke run `9810c8fb-6b1a-4b54-bcc6-6e5e51429378`. Best variants across the arm sit in a narrow 1285-1329 Elo band — the reflection reliably lands in the top-tier but never breaks through it.

10. **Median-vs-mean per-variant skew reveals fundamentally different distribution shapes** (new column `med Δ/inv` in Table A; anchor 1191 live-DB). Three patterns across the top arms:
    - **`reflect_and_generate`: tight, near-normal** — median +61.0, mean +62.9 (Δ ≈ +1.9). Every variant lands in a narrow band; the reflection wrapper produces consistent per-variant quality.
    - **`generate`: right-tail-heavy (high variance / high ceiling)** — median +31.1, mean +9.7 (median > mean, LEFT skew of Δ ≈ -21.4). The typical variant is decently above seed, but the tail of poor variants (Elo as low as ~1025 per sister EAR) drags the mean down. Wins the ceiling via scatter-shot variance.
    - **`self_critique_revise`: LOW median / HIGH mean pattern** — median **+8.1**, mean **+29.8** (median < mean, RIGHT skew of Δ ≈ +21.7). The typical variant is only marginally above seed, but a small tail of high-Elo variants pulls the mean up. Combined with 100% %impr≥40, this suggests: reflection guarantees SOME good variant per run, but doesn't guarantee HIGH per-variant density. **The reliability floor is at the RUN level, NOT the INVOCATION level.**

    This complicates the "reliability wins" narrative: self_critique's reliability is that every run contains at least one high-Elo variant (100% %impr≥40 at the run level), but individually, only ~50% of variants beat seed by more than +8 Elo. If the goal is "many high-quality variants per invocation," self_critique is worse than `generate` (median +8 vs +31); if the goal is "at least one high-quality variant per run," self_critique matches or beats the other top arms. This is a novel structural finding not present in the sister EAR (which didn't include self_critique).

### Follow-up Ideas

1. **Tranche 2 at n=20 (+$1)** — Δ CI [-42, +16] straddles zero at n=10; another 10 runs would tighten this to ~±25 Elo half-width. Could confirm or overturn the FAIL verdict. Given the PRAP's clean FAIL condition already fired, this is discretionary.

2. **Test self_critique with a higher `SELF_CRITIQUE_HIGH_ELO_THRESHOLD` regime seed.** The threshold is 1300; our seed sits at 1176 in-arena, so it never fired. A higher-Elo starting point would test whether the "surgical edits historically win on high-Elo articles" context note is load-bearing.

3. **Explore reducing reflection cost overhead.** Reflection is ~15% of total spend but produces only a label + plan. Cheaper reflector models (or a shorter output cap) could improve throughput without losing the reliability floor.

4. **Fix the `changeKind` clustering via prompt engineering.** Removing the "Mode shifts (e.g. abstract → concrete...)" example from the enumeration would test whether the reflector still converges on mode-shifts on this article (real signal) or diversifies (label artifact).

5. **Test on a broader prompt set.** All findings here are on the Federal Reserve article. Self_critique's reliability floor might generalize; its ceiling shortfall might be article-specific.

6. **Investigate why iterative_editing's 78% %var>seed doesn't win the ceiling.** Similar to self_critique — high per-variant density but low top-Elo. Could be a shared "safe/reliable but not high-variance" pattern for constrained-scope agents.

## Dataset

**`dataset.csv`** (mirror of `analyzeEloAgentComparison_20260626.ts` per-arm output) — one row per arm × 10 arms with columns: `arm, runs_completed, runs_queued, article_variants, ranked_variants, median_lift_max_per_run, pct_impr, pct_impr_ge40, pct_var_above_seed, p_best, p_top40, delta_vs_generate, ci_low, ci_high, holm_p, significant, decisive_pct, budget_per_run_usd, total_budget_usd, total_spent_usd`. Aggregated only. No PII (article aggregate metrics, no user data). **Confirm dataset.csv contains no PII before committing.**

## Queries & Results

All queries via `npm run query:staging -- --json "<query>"` (staging read-only, `readonly_local` role, SELECT-only) or `evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts` for the primary computation. Full text in `queries.sql`.

Key calls:
1. **Primary DV recompute + significance:** `npx tsx evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts --experiment-id bc10c2e0-a51c-41a8-a2c3-34577a1fa489 --prompt-id 6f5c85e5-0d6f-42f3-ba91-cbf2377f2317 --baseline generate --threshold 40` → the 10-arm ranking table (Table A above).
2. **Funnel per-arm variants** (`evolution/scripts/analysis/funnel_per_arm_variants.sql`): produced the "article variants (ranked)" column of Table A.
3. **Funnel per-arm invocations:** produced the failure-rate breakdown for Finding 7.
4. **Judge decisiveness distribution:** produced the decisive_pct column and Finding 8 comparison.
5. **Per-arm cost breakdown:** produced total_spent_usd + cost_per_improver for Finding 4.
6. **Wipeout gate:** `npx tsx evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id bc10c2e0-… --json` → `count: 0` at post-tranche cutoff. Baseline (pre-append) also `count: 0`, delta = 0.
7. **Per-variant sample (Finding 9):** `SELECT id, elo_score, arena_match_count, execution_detail->'reflection'->>'changeKind' FROM evolution_variants JOIN evolution_agent_invocations ON …` — top-2 variants by Elo.
8. **Per-run reliability check (Finding 2):** `SELECT run_id, max(elo_score) AS best_elo FROM evolution_variants WHERE run_id IN (…) GROUP BY 1` — all 10 runs' best Elo in [1285.3, 1329.3].

## Pre-Registered Analysis Plan

Reproduced verbatim from `docs/planning/analyze_performance_self_critique_agent_20260630/analyze_performance_self_critique_agent_20260630_planning.md` § Pre-Registered Analysis Plan:

- **Arms:** primary control = `generate` (existing n=10 in bc10c2e0); secondary comparator = `reflect_and_generate` (existing n=10); treatment = **`self_critique_revise` (NEW, n=10)**. Contextual arms: criteria/editing/paragraph (existing n=10 each). All share `generationModel = judgeModel = google/gemini-2.5-flash-lite`, `generationTemperature = 1`, `budgetUsd = 0.10`, `maxComparisonsPerVariant = 3`, single seed iteration.
- **Sample size:** 10 runs of the new arm (2 smoke + 8 full). Justification: sister within-arm σ ≈ 38 Elo → Cohen's d ≈ 1.05 for +40 Elo target → ~80% power at α=0.05 one-sided.
- **Named statistical test:** primary = Bootstrap P(best) + Bootstrap one-sided diff-of-medians vs `generate`, Holm-corrected across 9 vs-generate tests, α=0.05. Secondary = Bootstrap Δ of medians vs `reflect_and_generate`, descriptive-only (single planned contrast, uncorrected).
- **PASS / FAIL / INCONCLUSIVE thresholds:**
  - PASS ⇔ median max-lift/run ≥ +131 AND Holm-p < 0.10 AND Δ vs `generate` ≥ +40 Elo.
  - FAIL ⇔ median < +40 OR (Holm-p ≥ 0.10 AND Δ ≤ 0).
  - INCONCLUSIVE ⇔ everything else (triggers tranche-2 recommendation).
- **Per-arm balance metrics:** `runs_completed/queued` must be 10/10; `article_variants` treatment throughput within 2× the middle-tier arms; `decisive_pct` in the mid-range (5-60%); `total_spent_usd` in $0.90-$1.00 range.
- **Judge-decisiveness threshold:** 0.6 (from `DECISIVE_CONFIDENCE_THRESHOLD` in `evolution/src/lib/shared/rating.ts`).
- **Outlier rule:** zero-variant runs count as 0-lift; failed runs count as 0-lift; no cost-outlier exclusion.
- **Multi-criterion aggregation rule:** N/A (single-criterion experiment).
- **Arena-only wipeout HARD GATE:** `detectArenaOnlyWipeouts.ts --experiment-id bc10c2e0-… --json` count must be 0 (or delta from baseline for the new run IDs must be 0).

**Deviations from the plan:**
- **PRAP balance-metric violation: `total_spent_usd = $0.831` for self_critique_revise, BELOW the pre-registered $0.90-$1.00 range.** The arm under-spent its per-run cap by ~14% because reflection LLM calls consume budget before variant generation, and 11% of invocations hit `SelfCritiqueParseError` (see Finding 7) — mid-invocation abort before the inner GFPA generation eats its full reserved cost. This is a real balance imbalance that biases the primary DV downward: less spend → fewer variants → lower ceiling. It does NOT invalidate the FAIL verdict (self_critique still had 250 article variants, well within the 2× middle-tier throughput bound — see Balance Notes below), but it complicates the "self_critique vs generate at equal budget" framing. A follow-up tranche that pre-computes reservation overhead could equalize effective spend.
- Zero other deviations: All 10 runs completed with `status='completed'`. Smoke tranche passed all 9 assertions. Full tranche's 8 runs terminal within the expected window. Wipeout delta = 0.

## Balance Audit

### Table B — Experimental Validity Funnel (100 runs, all n=10/arm)

| Arm | runs (c/q) | invocations_total | success | failed | skipped | variants (article) | synced_to_arena | matches_played | matches_decisive |
|---|---|---|---|---|---|---|---|---|---|
| reflect_and_generate | 10/10 | 360 | 356 | 4 | 0 | 352 | 352 | 680 | 310 |
| generate (baseline) | 10/10 | 483 | 482 | 1 | 0 | 474 | 474 | 1,103 | 592 |
| **self_critique_revise** | 10/10 | 282 | 251 | **31** | 0 | 250 | 250 | 740 | 203 |
| criteria_and_generate | 10/10 | 353 | 348 | 5 | 0 | 348 | 348 | 630 | 30 |
| iterative_editing_rewrite | 10/10 | 209 | 209 | 0 | 0 | 171 | 171 | 419 | 23 |
| single_pass_criteria | 10/10 | 346 | 344 | 2 | 0 | 344 | 344 | 630 | 25 |
| iterative_editing | 10/10 | 599 | 582 | 17 | 0 | 118 | 118 | 393 | 104 |
| proposer_approver | 10/10 | (…) | (…) | (…) | 0 | 263 | 263 | 491 | 5 |
| paragraph_recombine_coherence | 10/10 | 43 | 43 | 0 | 0 | 43 | 43 | 1,627 | 94 |
| paragraph_recombine | 6/10 (4 fail) | 13 | 11 | 2 | 0 | 7 | 7 | 911 | 403 |

(`merge_ratings` invocations excluded above since they're one-per-run overhead. proposer_approver invocation row was truncated in query output; retrievable via `funnel_per_arm_invocations.sql`.)

### Wipeout Resolution
None triggered. Detector count baseline **0**, post-tranche **0**, delta **0**. No affected runs.

### Balance Notes

- **PRAP `article_variants` throughput gate: PASS.** Middle-tier arms produced {criteria=348, iterative_editing_rewrite=171, single_pass_criteria=344, iterative_editing=118, proposer_approver=263}: range [118, 348], median 263. PRAP required treatment throughput within 2× of the middle-tier; 2× median = 526. Self_critique_revise produced **250 article variants** — inside the middle-tier band AND ≤ 2× median (250 ≤ 526). Generate 474 and reflect_and_generate 352 also pass. Paragraph arms (7, 43) fall below the band and are the sole balance outliers, matching the sister EAR's pre-existing observation.

- **PRAP `total_spent_usd` balance gate: FAIL for self_critique_revise.** Pre-registered range $0.90-$1.00; self_critique spend was **$0.831 (below floor by $0.069, ~7%)**. Cause: 11% invocation failure rate → reflection LLM cost paid but variant-generation cost not incurred → mid-invocation abort → budget cap never reached before all 10 iterations converge. This is a real gate violation and is called out in the "Deviations from the plan" section above. Impact on the FAIL verdict: the equal-budget framing is imperfect; if we equalize effective spend, self_critique's ceiling would improve by some amount (bounded above by the throughput ratio 47%, but likely much smaller since the reflection call is load-bearing and can't just be swapped for more generate calls). The FAIL verdict is robust to this: Δ = -29 with CI half-width ~29, and even a fully-realized +8% throughput bump would not move the point estimate past +0.

- **self_critique failure rate (11%) — reframed narrative.** 31 `SelfCritiqueParseError` cases where the reflector's output didn't match the strict-anchor parser (see `evolution/src/lib/core/agents/selfCritiqueRevise.ts:293-368`). **Sampled parseError root cause: OUTPUT TRUNCATION, not reflector "bad ideas."** See Causal Evidence for two concrete examples — both show the model produced `ChangeKind:` + partial `Summary:` then hit the 600-token output cap before the `Plan:` label. Per-invocation failures result in a `success=false` row with `execution_detail.reflection.parseError` populated + partial detail preserved; the run continues with fewer variants. Compare: reflect_and_generate 1.1%, generate 0.2%, iterative_editing 2.8%, paragraph_recombine 15%. Self_critique's rate is highest among the top-tier arms. **The earlier hypothesis "parser rejections filter out low-value revision plans" is NOT supported by the sampled data** — the rejections are LLM-output-length events, not quality filtering. See Findings 2 + 7 (updated).

- **paragraph_recombine 4/10 run failures** are a pre-existing sister-experiment finding (per promoted EAR); not a self_critique concern.

- **All 10 self_critique_revise runs completed** with `stopReason='completed'`. Cross-arm run-completion is balanced (96/100 = 96% completion rate; paragraph_recombine 60% is the sole outlier). Total row: 96/100 = (10 × 9 arms full completion) + (6/10 paragraph_recombine).

## Decisiveness Audit

Per-arm decisive % (confidence ≥ 0.6, winner ∈ {a, b}):

| Arm | decisive_pct | bucket_1.0 | bucket_0.7 | bucket_0.5_tie | total |
|---|---|---|---|---|---|
| generate | 53.7% | (…) | (…) | (…) | 1,103 |
| reflect_and_generate | 45.6% | (…) | (…) | (…) | 680 |
| paragraph_recombine | 44.2% | (…) | (…) | (…) | 911 |
| **self_critique_revise** | **27.4%** | **203** | 0 | 537 | 740 |
| iterative_editing | 26.5% | 83 | 29 | 281 | 393 |
| paragraph_recombine_coherence | 5.8% | 115 | 0 | 1,512 | 1,627 |
| iterative_editing_rewrite | 5.5% | 22 | 2 | 395 | 419 |
| criteria_and_generate | 4.8% | (…) | 1 | (…) | 630 |
| single_pass_criteria | 4.0% | 24 | 1 | 605 | 630 |
| proposer_approver | 1.0% | 21 | 1 | 469 | 491 |

Judge decisiveness threshold = 0.6 (from `DECISIVE_CONFIDENCE_THRESHOLD`, unchanged). Self_critique_revise's 27.4% sits mid-range, closer to iterative_editing (26.5%) than to the top-tier (generate 53.7%, reflect 45.6%). Position bias N/A (no 2-pass ensemble data on this experiment; `judge_eval_agreement_*` tables not populated for these matches).

**Direction-of-confound argument (with mechanism).** Under OpenSkill (the internally-used rating system), a TIE outcome updates both variants' means toward each other (partial shrinkage toward the prior) rather than pushing them apart. An arm whose matches TIE more often (self_critique 73% ties vs generate 46%) will therefore see its top variants pulled *toward* the seed anchor (~1176), compressing the observed ceiling. **Direction:** lower decisiveness → more TIEs → more shrinkage-toward-prior → observed ceiling BELOW the "true" ceiling of the arm. This means self_critique's -29 Elo Δ vs generate is IF ANYTHING a *conservative* estimate — the ceiling gap would be smaller (or the sign could flip) under decisiveness-matched conditions. A robustness check would be to re-Elo restricted to decisive-only matches (would reduce match counts sharply but preserve directional information); this is left for the follow-up in tranche 2. The qualitative direction here does not affect the FAIL verdict (which is robust) but does bound the interpretation: "self_critique is not clearly worse than generate at ceiling once decisiveness confounding is accounted for."

No arm shows an extreme asymmetry that would invalidate the primary contrast (self_critique 27% vs generate 54% is a 2× spread but not the 10× spread seen in the sister criteria/proposer_approver comparisons).

## Causal Evidence

### Claim: "Truncation is the dominant parseError root cause, NOT low-value reflector plans"

**Evidence — observed in 2 of 2 sampled parseError invocations (out of 31 total):**

| Invocation | parseError | Raw reflector response preview |
|---|---|---|
| `2c042a32-a41f-494f-9188-a2059ce99511` | "no Plan label found after Summary" | `"ChangeKind: Mode shift (abstract → concrete, theoretical → practical, dense → conversational)\n\nSummary: The article currently presents information in a straightforward, almost textbook-like manner. To make it more engaging and accessible for a broade…"` (truncated at 250 chars in DB preview; underlying output likely hit the 600-token cap before writing `Plan:`) |
| `cdd798d1-7dcf-44bf-843b-15116ef2f1e2` | "no Plan label found after Summary" | `"ChangeKind: Mode shift (dense → conversational, abstract → concrete)\n\nSummary: The article provides a comprehensive…"` (mid-sentence truncation on Summary — never emitted `Plan:`) |

**Interpretation.** In both sampled cases the reflector clearly *started* a plan (ChangeKind + Summary are well-formed) but never wrote the `Plan:` label. This is a **token-cap truncation**, not a semantic filtering event. The revised model of the 11% failure rate is: reflector output length occasionally exceeds the 600-token cap on the reflection LLM call, and the strict-anchor parser correctly refuses to produce a partial plan. **The earlier hypothesis "parser rejections filter out low-value revision plans" is REJECTED by this evidence** — the parseError population is length-bounded truncations, uncorrelated with plan quality. The 100% reliability floor (Finding 2) is therefore driven by something else — possibly the free-form scope latitude producing consistently useful revisions when it DOES complete, or simply chance at n=10. Reframed as an open question for follow-up.

### Claim: "Self_critique achieves 100% run-level reliability at ≥+40 Elo lift"

**Evidence — observed in 10 of 10 runs:**

| Run ID | Best Elo | Elo lift vs seed (1175.9) |
|---|---|---|
| 9810c8fb-6b1a-4b54-bcc6-6e5e51429378 | 1329.3 | +153.4 |
| 192e32bb-c0e6-42f8-97e6-e8c2f3cf9eae | 1298.3 | +122.4 |
| f6eed038-db76-4dd4-b08e-3f2b3e101adb | 1297.8 | +121.9 |
| a123f5b0-ca8c-4870-b6ba-5b4e705ff4f0 | 1296.8 | +120.9 |
| e15d2aa7-e5cd-4838-a8d6-5a7221e7a34c | 1294.7 | +118.8 |
| 7d5582f1-e3fb-49e6-9fcb-7d6b0ebaf306 | 1290.9 | +115.0 |
| 0d436820-2648-4331-9c18-99b31c5448ee | 1289.9 | +114.0 |
| 9083995b-0b9d-476b-b93a-099b919b298a | 1289.0 | +113.1 |
| dc1a8ac5-8f72-4e56-9987-eb1c510bc1d5 | 1287.9 | +112.0 |
| b22fffda-0fe7-40a8-8f7b-13782d56c7fe | 1285.3 | +109.4 |

Every run's best variant beat the seed by ≥+109 Elo — well above the +40 threshold.

### Claim: "changeKind labels cluster but plan bodies are diverse"

**Evidence — observed in 5 of 5 sampled invocations with `changeKind LIKE '%Mode shift%'`:**

| Invocation | changeKind (60-char preview) | Plan body preview (200 chars) — DISTINCT tactic |
|---|---|---|
| 046d564a-… | "Mode shift (abstract → concrete and theoretical → practical)" | Replace abstract concepts with analogies + everyday examples (Fed monetary policy → daily grocery pricing) |
| 0b2c7cb7-… | "Mode shift (formal → narrative, abstract → concrete)" | Narrative scene-setting for Section 1 (1907 Panic) — vivid opening replacing "The year 1907 witnessed deposito…" |
| 0c321d54-… | "Mode shifts (abstract → concrete, dense → conversational)" | Reword the Introduction to be more engaging + less formal; replace "The very genesis of the Federal Reserve System…" |
| 0c704dff-… | "Mode shift from dense academic → practical narrative" | Replace formal title with engaging alternative ("The Fed's Balancing Act…"); revamp intro tone |
| 2dee9990-… | "Mode shifts (abstract → concrete, dense → conversational)" | Systematic jargon replacement ("ad hoc rescue" → "one-off, last-minute rescue"; "profound" → "serious") |

5/5 sampled plans target genuinely distinct revision tactics (analogies, narrative structure, wording, title replacement, jargon reduction). The `changeKind` label converges on "mode shift" vocabulary because the reflection prompt's `Task` section enumerates that phrasing verbatim.

### Claim: "Reflection LLM overhead reduces throughput per dollar"

**Evidence — observed in 100% (10/10) of self_critique runs:**

| Metric | self_critique (10 runs) | generate (10 runs) | Δ |
|---|---|---|---|
| Total spend | $0.831 | $0.969 | -14% |
| Article variants produced | 250 | 474 | **-47%** |
| Variants per dollar | 301 | 489 | -38% |

Even at 86% of `generate`'s per-run spend (self_critique under-spends its budget because the reflection call has to run before every generate attempt, and once budget is exhausted the run stops mid-iteration), it produces less than half the article variants. The extra reflection cost is real overhead that comes out of the variant-generation budget.

## Adversarial Review Log

**Iteration 1 — 2026-07-01** (3 perspectives, 8 critical gaps):

| Perspective | Score | Critical gaps flagged |
|---|---|---|
| Statistical Validity | 4/5 | (a) Finding 1 misused "rejected at 80% power" language. (b) Post-hoc append multiplicity structure vs sister 8-family Holm not disclosed. (c) Bootstrap protocol details missing (resamples, seed, one-sided vs two-sided CI). |
| Balance & Data Quality | 3/5 | (a) PRAP `total_spent_usd = $0.831` violates $0.90-$1.00 balance range; "Deviations: none" was WRONG. (b) 2× middle-tier throughput bound not shown numerically. (c) Decisiveness understatement argument hand-wavy — needed a mechanism. |
| Causal Evidence & Narrative | 4/5 | (a) Finding 7 (11% failure rate) had NO concrete parseError examples. (b) "Parser rejections filter out low-value plans" claim was speculative connective tissue with no verification. |

**Fixes applied between iter 1 and iter 2:**
- §Methodology gained a "Bootstrap protocol" block (10,000 resamples, per-run max-Elo-lift unit, seed from experiment_id, 95% two-sided percentile CI construction, explicit one-sided Holm-p as primary decision variable) AND a "Multiplicity structure — disclose post-hoc append" paragraph with the reflect_and_generate Holm-p sensitivity (0.228 → 0.257 at 5,266 matches, no verdict flips).
- §Key Findings §1 reframed to "the pre-registered one-sided test was designed for ~80% power … observed data satisfies the FAIL condition; the pre-registered hypothesis is not supported at this sample size and design."
- §Pre-Registered Analysis Plan → Deviations: `total_spent_usd = $0.831 below $0.90-$1.00 range` explicitly flagged with cause analysis + directional impact argument + robustness statement.
- §Balance Notes: middle-tier arithmetic shown explicitly (range [118, 348], median 263, 2× = 526, self_critique 250 ≤ 526 → throughput PASS); total_spent gate marked FAIL with -$0.069/-7% shortfall.
- §Decisiveness Audit: OpenSkill TIE-shrinkage mechanism stated concretely (TIE → partial shrinkage toward prior → ceiling compression); TIE rates given (self_critique 73%, generate 46%).
- §Causal Evidence: new "Truncation is the dominant parseError root cause" claim with 2 sampled invocations (`2c042a32-…`, `cdd798d1-…`) showing ChangeKind + Summary followed by output-length termination before `Plan:`.
- §Key Findings §2 explicitly REJECTS the earlier "filters out low-value plans" hypothesis; alternatives reframed as open questions.
- §Key Findings §7 reframed to blame the 600-token reflection output cap with actionable follow-up (raise to 800-1000 tokens).

**Iteration 2 — 2026-07-01** (same 3 perspectives, ZERO critical gaps):

| Perspective | Score |
|---|---|
| Statistical Validity | **5/5** ✓ |
| Balance & Data Quality | **5/5** ✓ |
| Causal Evidence & Narrative | **5/5** ✓ |

**Consensus reached after 2 iterations.** Remaining minor polish items (non-blocking):
- Bootstrap protocol could add "with replacement" wording.
- Table A could add a one-line footer clarifying that Δ CI is two-sided while Holm-p is one-sided.
- Cost-per-improver metric's "improver" definition could be pointed at its source query.
- parseError sample n=2/31 is honestly hedged; a stricter reviewer might want n≥5.
- Table B `proposer_approver` invocation columns show `(…)` — pointer to source SQL provided.

Reviewers unanimously judged the EAR ready for promotion.
