# Self-Critique Agent Performance — Federal Reserve 2 Seed (10-arm append)

## Header
- **Analysis name:** self-critique-agent-perf-federal-reserve-2-20260701
- **Project:** docs/planning/analyze_performance_self_critique_agent_20260630/
- **Branch:** feat/analyze_performance_self_critique_agent_20260630
- **Date:** 2026-07-01
- **Source research doc:** docs/planning/analyze_performance_self_critique_agent_20260630/analyze_performance_self_critique_agent_20260630_research.md
- **Working EAR (full rigor):** docs/planning/analyze_performance_self_critique_agent_20260630/EAR.md
- **Experiment:** staging `bc10c2e0-a51c-41a8-a2c3-34577a1fa489` (name `ELOEXP agent comparison fed reserve 20260626 real1`), arena prompt `6f5c85e5-0d6f-42f3-ba91-cbf2377f2317`
- **New strategy ID:** `6c7f7349-a4f1-421e-9999-0c063f4b1e60` (config hash `v2:cddae8f1e…`)
- **Sister analysis (base for direct comparison):** [`docs/analysis/elo-agent-comparison-federal-reserve-2-20260628/`](../elo-agent-comparison-federal-reserve-2-20260628/)

## Methodology

10 runs of the new `self_critique_revise` arm were appended to the sister experiment `bc10c2e0` on arena `6f5c85e5` (same isolated Federal Reserve arena, same pinned seed anchor at Elo 1175.9 recompute / ~1191 live-DB) using identical models, temperature, budget, and iteration structure as the 9-agent sister comparison. Each run is a single-iteration off-seed strategy: `{ agentType: 'self_critique_revise', sourceMode: 'seed', budgetPercent: 100 }`, model `google/gemini-2.5-flash-lite` for both generation and judging, `generationTemperature: 1`, `budgetUsd: 0.10`, `maxComparisonsPerVariant: 3`. This isolates the treatment axis to `agentType`.

**Pre-registered analysis plan (excerpt).**
- Primary contrast: `self_critique_revise` vs `generate` — Bootstrap **P(best)** across all 10 arms + Bootstrap one-sided diff-of-medians, Holm-corrected across 9 vs-`generate` tests, α=0.05, min effect +40 Elo.
- Secondary contrast: `self_critique_revise` vs `reflect_and_generate` — descriptive-only (n≈44/arm needed for a formal verdict on plausible wrapper-vs-wrapper effect sizes; out of scope).
- **PASS** ⇔ median max-lift/run ≥ +131 AND Holm-p < 0.10 AND Δ vs `generate` ≥ +40 Elo. **FAIL** ⇔ median < +40 OR (Holm-p ≥ 0.10 AND Δ ≤ 0). Otherwise INCONCLUSIVE → tranche-2 recommendation.

**Bootstrap protocol** (from `evolution/src/lib/metrics/abComparison.ts`): 10,000 resamples per contrast; resample unit = per-run max-Elo-lift (10 values per arm, matches primary DV); seeded RNG via `createSeededRng(experiment_id)` for reproducibility; 95% two-sided percentile CI construction. The one-sided Holm-corrected p is the primary significance decision variable.

**Multiplicity structure — disclosure of post-hoc append.** The sister analysis used an 8-family Holm at 4,518 matches. This analysis pre-registered the 10th arm before appending; both frames are computed at the 5,266-match cutoff against a 9-family Holm. **No verdict from the sister analysis flipped under recomputation** — `reflect_and_generate` Δ vs generate stays +34.2 [-6, +78]; Holm-p moved 0.228 → 0.257 (the +$0.03 bump reflects the 9-family correction, not any data shift). All 8 originally-negative arms retain Holm-p = 1.000.

**Anchor convention.** `top_elo`, `med_elo`, `top_elo_Δ_vs_seed`, `med max-lift/run`, and `%var>seed` use the **recompute anchor (1175.9)** produced by deterministic replay of `evolution_arena_comparisons`. `med Δ/inv` and `mean Δ/inv` use the **live-DB anchor (~1191)** — this preserves comparability to the sister EAR's historical child-vs-parent metric and to pre-initiative runs. The ≤15-Elo offset does not change rankings.

**Deviations from the plan.** One PRAP balance-metric violation:
- `total_spent_usd = $0.831` for self_critique_revise, below the pre-registered $0.90-$1.00 range (7% shortfall). Cause: the 11% invocation failure rate (see Finding 7) leaves the reflection LLM cost paid but the inner GFPA generation cost not incurred → mid-invocation aborts → budget cap never reached. Does NOT invalidate the FAIL verdict: the CI half-width is ~29 Elo and even a fully-realized +8% throughput bump could not move the point estimate past 0.

All 10 runs completed with `status='completed'`. Wipeout-detector delta on new run IDs = 0.

## Key Findings

**Cutoff snapshot:** 5,266 comparisons across 100 runs at 2026-07-01. `self_critique_revise` marginal spend $0.83 (83% of $1.00 planned).

### Table A — Test-vs-Control Metrics Summary

Seed anchor Elo = 1175.9 (recompute; live-DB anchor ~1191 used for `med Δ/inv` / `mean Δ/inv`). All arms n=10 runs.

| Arm | runs (c/q) | article variants (ranked) | top_elo | med_elo | top_elo_Δ_vs_seed | med max-lift/run | **med Δ/inv** | mean Δ/inv | mean−med | **%var>seed** | %impr | **%impr≥40** | P(best) | P(top40) | Δ vs gen [95% CI] | Holm-p | budget/run | total_budget | total_spent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reflect_and_generate | 10/10 | 352 (244) | 1341.4 | 1263.5 | +165.5 | +165.5 | **+61.0** | +62.9 | +1.9 (tight) | 94% | 100% | 90% | **96%** | 100% | +34.2 [-6, 78] | 0.257 | $0.10 | $1.00 | $0.980 |
| generate (baseline) | 10/10 | 474 (317) | 1307.2 | 1220.6 | +131.3 | +131.3 | +31.1 | +9.7 | **-21.4 (LEFT skew)** | 64% | 100% | 90% | 4% | 67% | — (baseline) | — | $0.10 | $1.00 | $0.969 |
| **self_critique_revise** ⭐ | 10/10 | **250** (250) | 1329.3 | 1247.9 | +153.4 | **+102.3** | **+8.1** | **+29.8** | **+21.7 (RIGHT skew)** | 88% | 100% | **100%** ⭐ | 0% | 11% | -29.0 [-42, 16] | 1.000 | $0.10 | $1.00 | **$0.831** |
| criteria_and_generate | 10/10 | 348 (235) | 1253.3 | 1198.8 | +77.4 | +77.4 | +18.9 | +18.0 | -0.8 | 81% | 100% | 80% | 0% | 0% | -53.9 [-83, -9] | 1.000 | $0.10 | $1.00 | $0.954 |
| iterative_editing_rewrite | 10/10 | 171 (168) | 1251.0 | 1197.5 | +75.1 | +75.1 | +3.7 | +3.1 | -0.6 | 63% | 100% | 90% | 0% | 1% | -56.2 [-86, -8] | 1.000 | $0.10 | $1.00 | $0.978 |
| single_pass_criteria | 10/10 | 344 (241) | 1249.4 | 1200.9 | +73.5 | +73.5 | +19.1 | +15.2 | -3.8 | 76% | 100% | 70% | 0% | 1% | -57.8 [-93, -14] | 1.000 | $0.10 | $1.00 | $0.964 |
| iterative_editing | 10/10 | 118 (117) | 1230.8 | 1195.1 | +54.9 | +54.9 | +6.5 | +14.3 | +7.8 | 78% | 100% | 80% | 0% | 0% | -76.4 [-94, -27] | 1.000 | $0.10 | $1.00 | $0.991 |
| proposer_approver | 10/10 | 263 (200) | 1217.5 | 1198.8 | +41.6 | +41.6 | +3.1 | +2.9 | -0.2 | 57% | 100% | 70% | 0% | 0% | -89.7 [-103, -42] | 1.000 | $0.10 | $1.00 | $0.986 |
| paragraph_recombine_coherence | 10/10 | 43 (43) | 1182.8 | 1157.0 | +6.9 | +6.9 | **-5.8** | -0.9 | +4.9 | 44% | 60% | 20% | 0% | 0% | -124.4 [-139, -82] | 1.000 | $0.10 | $1.00 | $0.866 |
| paragraph_recombine | 6/10 (4 fail) | 7 (7) | 1178.8 | 1128.1 | +2.9 | +2.9 | +19.2 | +6.5 | -12.6 | 71% | 50% | 20% | 0% | 0% | -128.4 [-141, -78] | 1.000 | $0.10 | $1.00 | $0.586 |
| **Total** | **96/100** | **2,370 (1,805)** | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | **$10.00** | **$9.10** |

**Legend.**
- **variants (ranked)** = article variants (`variant_kind='article'`) with `arena_match_count ≥ 1`. Paragraph slot variants excluded.
- **med max-lift/run** = median across the arm's 10 runs of `max(Elo of the run's variants) − seed_Elo`. Primary DV.
- **med Δ/inv** = median across ALL of an arm's ranked article variants of `variant_Elo − seed_Elo` (live-DB anchor). Per-invocation quality density.
- **mean Δ/inv** = arithmetic mean cross-check. `mean − median` reveals distribution SKEW.
- **%var>seed** = share of an arm's ranked variants with Elo > seed anchor.
- **Δ vs gen** = one-sided Bootstrap difference-of-medians against `generate`, 95% two-sided CI, Holm-corrected p (one-sided, primary decision variable).

### Numbered findings

1. **`self_critique_revise` FAILS the primary contrast vs `generate` under the pre-registered PRAP.** Median max-lift/run = **+102.3** (below `generate`'s +131.3 by -29.0 Elo). Holm-corrected one-sided p = 1.000. Δ 95% CI = **[-42, +16]** — includes zero. FAIL condition `Holm-p ≥ 0.10 AND Δ ≤ 0` triggers cleanly. The pre-registered one-sided test was designed for ~80% power to detect a +40 Elo effect at α=0.05; the observed data satisfies the FAIL condition, so the hypothesis "self-critique's reflection premium buys real Elo gains vs a plain-GFPA baseline" is not supported at this sample size and design.

2. **`self_critique_revise` is the ONLY arm with 100% of runs meaningfully improving the seed (≥+40 Elo).** `reflect_and_generate` and `generate` tie at 90%; the criteria/editing middle sits at 70-80%; paragraph arms at 20%. Every self_critique run's best variant scored between 1285.3 and 1329.3 Elo — a tight [+109, +153] Elo lift range vs seed 1175.9. Reliability is a real feature. **Mechanism is an open question** — sampled parseError cases (see Finding 7) are LLM output truncations, not semantic filtering. Alternative explanations for the floor: (a) free-form reflection scope-latitude producing consistently useful revisions, (b) chance at n=10, (c) structural property of the reflection-then-rewrite decomposition. Left for tranche 2.

3. **Ceiling is lower than baseline because throughput is lower.** Self_critique produced 250 article variants at $0.83 spend (avg 25/run); `generate` produced 474 variants at $0.97 spend (avg 47/run — ~90% more variants per dollar). The max-lift DV is throughput-sensitive; per-variant density and reliability rank self_critique highly (%var>seed = 88%, third overall among article-level arms) even while the ceiling is lower.

4. **Cost-per-improver ($0.28) is 2.5× higher than `reflect_and_generate` ($0.11).** The reflection LLM call adds ~15% overhead per variant attempt; combined with lower throughput and lower ceiling, self_critique's economic efficiency is worst among the top three arms. Very sample-sensitive (self_critique had only 3 improvers by the parent-Elo definition) — treat as directional, not precise.

5. **Vs `reflect_and_generate` (secondary, descriptive-only): self_critique lags by -63 Elo on median max-lift** (+102.3 vs +165.5). No formal verdict. Free-form reflection did NOT beat constrained-tactic reflection on this article at this sample size.

6. **`changeKind` labels cluster heavily around "Mode shift" (~80% of invocations) but underlying `plan` bodies are diverse.** 5/5 sampled plans with clustered "Mode shift" labels targeted concretely distinct tactics (analogies, narrative scene-setting, jargon reduction, title replacement, tone rework). The clustering is prompt-anchor artifact — the reflection prompt enumerates "Mode shifts (e.g. abstract → concrete, theoretical → practical, dense → conversational, formal → narrative)" and the reflector regurgitates that vocabulary. `getAttributionDimension` breakdowns will be noisy.

7. **11% invocation failure rate — root-caused to reflector OUTPUT TRUNCATION, not "bad plans."** 31/282 self_critique_revise invocations returned `SelfCritiqueParseError`. Sampled 2 (`2c042a32-a41f-494f-9188-a2059ce99511`, `cdd798d1-7dcf-44bf-843b-15116ef2f1e2`) — both show well-formed `ChangeKind:` + `Summary:` blocks followed by output-length termination before `Plan:`. Comparison rates: reflect_and_generate 1.1%, generate 0.2%, iterative_editing 2.8%, paragraph_recombine 15%. **Actionable follow-up: raise the reflection output cap from 600 → 800-1000 tokens** — likely to reduce the failure rate and boost effective throughput without materially changing per-invocation cost (~$0.0002 per additional 100 tokens at gemini-2.5-flash-lite pricing).

8. **Judge decisiveness (27.4%) mid-range.** Well below generate (53.7%) and reflect_and_generate (45.6%). Under OpenSkill, a TIE outcome updates both variants' means toward each other (partial shrinkage toward the prior). Arms with more TIEs (self_critique 73% vs generate 46%) see their top variants pulled toward the seed anchor, compressing the observed ceiling. Direction of confounding: self_critique's -29 Elo Δ vs generate is a *conservative* estimate. Robustness check (re-Elo on decisive-only matches) left for tranche 2.

9. **Best self_critique variant (Elo 1329.3, `14b0e150-14ec-45c1-a6e4-9f91183289fb`)** used changeKind "Mode shift (dense → conversational and theoretical → practical)". Best variants across the arm sit in a narrow 1285-1329 Elo band — the reflection reliably lands in the top-tier but never breaks through it.

10. **Median-vs-mean per-variant skew reveals fundamentally different distribution shapes** (new column `med Δ/inv` in Table A). Three patterns:
    - **`reflect_and_generate`: tight, near-normal** — median +61.0, mean +62.9 (Δ ≈ +1.9). Consistent per-variant quality.
    - **`generate`: LEFT skew** — median +31.1, mean +9.7 (median > mean by -21.4). Typical variant is decent, but a tail of poor variants drags mean down. Wins ceiling via scatter-shot variance.
    - **`self_critique_revise`: RIGHT skew** — median **+8.1**, mean **+29.8** (median < mean by +21.7). Typical variant is only marginally above seed; a small tail of high-Elo variants pulls mean up. **The reliability floor is at the RUN level, NOT the INVOCATION level.**

    Combined with 100% %impr≥40 (Finding 2), this suggests: reflection guarantees SOME good variant per run but doesn't guarantee HIGH per-variant density. If the goal is "many high-quality variants per invocation," self_critique underperforms `generate` (median +8 vs +31); if the goal is "at least one high-quality variant per run," self_critique matches or beats the other top arms.

### Follow-up Ideas

1. **Tranche 2 at n=20 (+$1)** — Δ CI [-42, +16] straddles zero at n=10; another 10 runs would tighten to ~±25 Elo. Could confirm or overturn the FAIL. Discretionary since PRAP FAIL fired.
2. **Raise reflection output cap to 800-1000 tokens** (per Finding 7) to reduce the 11% truncation-driven failure rate.
3. **Test self_critique with a high-Elo seed (> 1300 threshold).** The `SELF_CRITIQUE_HIGH_ELO_THRESHOLD` context note is 1300 and our seed sits at 1176 in-arena — the "surgical edits historically win on high-Elo articles" hint never fired.
4. **Test on broader prompt sets.** All findings are Federal Reserve. Self_critique's reliability floor may generalize; ceiling shortfall may be article-specific.
5. **Fix `changeKind` clustering via prompt engineering.** Remove the enumerated "Mode shifts" example — test whether the reflector still converges (real signal) or diversifies (label artifact).
6. **Robustness check on decisiveness confound.** Re-Elo restricted to decisive-only matches. Would sharpen the direction argument in Finding 8.

## Dataset

`dataset.csv` — one row per arm × 10 arms. **24 columns** including new `median_delta_per_invocation`, `mean_delta_per_invocation`, and `mean_minus_median` (added 2026-07-01 for distribution-skew visibility). Aggregated only. No PII (article aggregate metrics, no user data). **Confirm dataset.csv contains no PII before committing.**

**Per-arm summary (mirror of dataset.csv):**

Columns: `arm, runs, article variants (ranked), median max-lift/run, med Δ/inv, mean Δ/inv, mean-med skew, %impr, %impr≥40, %var>seed, P(best), Δ vs generate [95% CI], Holm-p, spent ($)`.

See Table A above for the full merged view.

## Queries & Results

All queries recorded in `queries.sql` and were run via `npm run query:staging -- --json "<query>"` against staging (read-only, DB-enforced `readonly_local` role). Key invocations:

- **Recompute + P(best) + Holm + primary DV:** `evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts --experiment-id bc10c2e0-a51c-41a8-a2c3-34577a1fa489 --prompt-id 6f5c85e5-0d6f-42f3-ba91-cbf2377f2317 --baseline generate --threshold 40` → produces the max-lift/run column, P(best), Δ vs generate + CI + Holm-p, decisiveness %.
- **Q1-Q4 (funnel):** `evolution/scripts/analysis/funnel_per_arm_variants.sql`, `funnel_per_arm_invocations.sql`, `funnel_per_arm_decisive_matches.sql`, `funnel_per_arm_top_elo_gain.sql`.
- **Q5 (new — median Δ/inv + mean Δ/inv):** `evolution/scripts/analysis/per_arm_median_delta_per_invocation.sql` (created 2026-07-01, added to `/run_experiment_analysis` skill spec's Step 2 loop as mandatory query #5).
- **Q6-Q7:** `judge_decisiveness_distribution.sql`, `per_arm_cost_breakdown.sql`.
- **Wipeout HARD GATE:** `evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id bc10c2e0-... --json` → `count: 0` at both baseline and post-tranche cutoffs.
- **Causal evidence** — sampled parseError invocations (`2c042a32-…`, `cdd798d1-…`), per-run best Elo, changeKind × plan preview: reproduced in `queries.sql`.
