# Design Elo Improvement Experiment — Experiment Analysis Report (EAR)

## Header
- **Project:** docs/planning/design_elo_improvement_experiment_20260626/
- **Branch:** feat/design_elo_improvement_experiment_20260626
- **Experiment ID:** bc10c2e0-a51c-41a8-a2c3-34577a1fa489 (arena tag `real1`, tranche 1)
- **Arena prompt_id:** 6f5c85e5-0d6f-42f3-ba91-cbf2377f2317
- **Date:** 2026-06-28
- **Skill version:** /run_experiment_analysis@d5fdae7a6

## Methodology
Per the PRAP (`design_elo_improvement_experiment_20260626_planning.md` → `## Pre-Registered Analysis Plan`),
9 agent arms each ran 10 single-iteration runs off one ~1325-Elo Federal Reserve seed at equal budget
($0.10) and identical models (`google/gemini-2.5-flash-lite` gen+judge, `maxComparisonsPerVariant: 3`).
**Design verified from the data:** every arm's strategy has exactly **1 round** (`iterationConfigs`
length 1, `sourceMode='seed'`) and **all 2,120 article variants parent directly off the seed**
(`parent_is_seed`) — i.e. one generation, no variant-of-variant lineage; each variant is a single-step
edit/rewrite of the seed.

- **Canonical Elo (recompute-before-analysis, Decision F):** ratings were rebuilt **in-memory** from the
  4,518-row `evolution_arena_comparisons` log (OpenSkill replay from default mu=25), NOT read from the
  race-prone live `elo_score`. No DB write.
- **Primary DV:** per-run **max-Elo-lift over the seed** = `max(recomputed Elo of the run's surfaced
  variants) − seedElo`. `seedElo` = the **competing seed anchor** (`generation_method='pipeline'`,
  `run_id IS NULL`, 266 matches), recomputed to **1175.9**. Zero-variant runs (incl. `all_generations_failed`)
  count as **0-lift** (not dropped). **The per-arm headline "+N" is the MEDIAN across that arm's 10 runs of
  the per-run max** — i.e. the typical run's *single best* variant's Elo minus the seed's Elo (NOT a mean,
  NOT averaged over a run's ~27 variants). Example: reflect's 10 per-run bests were Elo 1277–1355 (lifts
  +86…+164 on the DB anchor / median **+165.5** on the recompute anchor 1175.9).
- **Arena topology (what the Elo is measured against):** a **fresh, isolated arena** (this `prompt_id`,
  "real1" tag) seeded with only the anchor + this experiment's variants — **NOT** the broader
  `federal_reserve_2` topic pool; no outside variants. Of the 4,518 matches: **81% are cross-run**
  (a variant vs a *different run's / different arm's* variant), **19% involve the seed anchor**, and **0%
  are same-run** (a variant never plays its own siblings). This is what makes it a valid cross-arm
  comparison — every arm's variants are pooled and ranked against every other arm's + the seed. Caveat:
  with `maxComparisonsPerVariant=3`, each variant plays only **~3 matches** (the 1355 top variant: 2
  cross-run + 1 vs seed), so individual ratings are thin/high-σ and most variants meet the seed only
  **transitively** through the OpenSkill graph, not head-to-head.
- **Named test (primary):** **Bootstrap** P(best) — prob each arm holds the single highest median lift
  (2000 resamples, seed 12345) — plus top-tier P(within 40 Elo of best).
- **Named test (secondary):** one-sided (arm > control) **Bootstrap** diff-of-medians vs `generate`,
  **Holm**-corrected across the 8-arm family; significant iff Holm-adjusted p < 0.05.

**Deviation from a naive first pass:** an initial ad-hoc script mis-identified the seed anchor (it matched
the first `generation_method='pipeline'` row — but **every** variant carries that method — landing on a
0-match variant at the 1200 default). The corrected anchor uses `run_id IS NULL AND generation_method
='pipeline'`. This shifted absolute lifts ~+9 Elo; it does **not** affect any P(best) or vs-control result
(seedElo is a constant offset that cancels in rankings and diffs).

## Key Findings

**Bottom line: `reflect_and_generate` is the best arm and that result is robust; the *ordering of the
remaining arms* is confounded and should not be read as a clean quality ranking.** The single headline
number ("+165 lift") is misleading on its own; the supporting funnel/decisiveness/below-seed audits are
what make the result interpretable.

1. **`reflect_and_generate` leads on the primary metric (P(best) = 96%, median lift +165 Elo over the seed)
   and the lead is corroborated by a confound-independent check:** only **6% of reflect's variants score
   below the seed** (94% improve it) and 176 are ≥40 Elo above it — i.e. reflect improves the seed
   *consistently*, not via a single high-variance outlier. This survives the decisiveness critique below.
   `generate` is second (P(best) 4%, P(top-40) 69%) but is high-variance (36% of its variants fall *below*
   the seed). All other arms score P(best) 0%.

2. **P(best) 96% ≠ "reflect significantly beats generate."** The two are different questions and must not be
   conflated. P(best) asks "which arm most often has the highest median across bootstrap resamples"
   (reflect, 96%); the pre-registered *pairwise* test asks "is reflect > generate" and is **not significant**
   at n=10 (Δmedian +34 Elo, 95% CI [−6, +78], Holm p = 0.23). So reflect is the **likely** best but a
   single-winner claim over generate is **not** established at this sample size — tranche 2 is needed.

3. **The "+165 lift" is measured against the seed's recomputed *in-arena* Elo (~1176), not its nominal
   1325.** This is by design (the DV was pre-registered as lift-over-recomputed-seed, "lift vs whatever the
   Elo is"), so it is not a flaw in the EAR's DV — but it does mean the ad-hoc "improved a 1325 article by
   165" narrative is wrong. Top variants ~1340, seed ~1176, one self-contained pool.

4. **The ordering of the middle/lower arms is confounded by a 1%→53% judge-decisiveness spread — but
   decisiveness is NOT the whole story, and the below-seed audit separates the two.** Elo only moves on
   decisive matches, so low-decisiveness arms (proposer 1%, single_pass 4%, criteria 5%, coherence 6%)
   compress toward the mean and their *exact* Elo ordering is unreliable. **However**, the below-seed
   fraction (a decisiveness-robust quality proxy) shows the low arms are *also genuinely weaker*: proposer
   puts **43%** of variants below the seed (and its best is only +50), criteria 19%, single_pass 24%. So the
   correct claim is **not** "they're all secretly fine" (my earlier framing — overstated) and **not** "the
   Elo ranking is exact" — it is: **the gap is real for the extremes (reflect best, proposer/coherence
   weak) but the fine ordering among the middle arms is not resolvable from Elo alone.** A genuinely-good
   small edit that the judge cannot resolve is observationally identical to a draw here, so neither this
   experiment nor the audit can fully exonerate a low-decisiveness arm — only the head-to-head test
   (Follow-up #1) can.

5. **The pre-registered "% improving" secondary DV tells a much tighter story than the ceiling magnitude,
   and is the more confound-robust read.** On "% of runs whose best variant beats the seed," **7 of 9 arms
   improve the seed in 100% of runs**, and by the ≥40-Elo bar reflect/generate/editing_rewrite lead at 90%,
   the criteria/editing/proposer middle cluster at 70–80%, and only the **paragraph arms genuinely trail
   (20%)**. So the enormous max-lift spread in Table A is largely a *ceiling-magnitude* artifact (variance ×
   decisiveness); on the binary "did the best variant improve the seed" question the arms are close and
   nearly all succeed. This is the single most important correction to a naive reading of the ranking.
   *Disclosed deviations still outstanding:* (a) Elo-per-$ is shown only as a directional median-lift/cost
   proxy, not a bootstrapped efficiency CI; (b) the PRAP's **variant-σ propagation** (sample each variant's
   Elo from `Normal(elo, variant_sigma)` before the per-run max) was **not** applied — point Elo was used.
   Its omission makes high-σ, few-match arms' ceilings *conservative* (it would have widened them), so it
   does not threaten the "reflect leads" conclusion, but it is an un-executed pre-registered component.

6. **Paragraph arms are lowest-throughput; `paragraph_recombine` failed 4/10 runs** (imputed 0-lift per
   PRAP). Its CI is therefore based on 6 real + 4 degenerate-zero runs and is **not** comparable to the
   full-n arms' CIs — treat its interval as a floor, not a precise estimate.

7. **Per-variant quality density (`%var>seed`) ranks the arms oppositely to the ceiling — and is the
   throughput-unbiased view.** On the fraction of an arm's variants that beat the seed: reflect 94% leads,
   then **criteria 81% / iterative_editing 78% / single_pass 76% — all ABOVE generate's 64%.** So the
   targeted-edit arms produce a *higher share* of seed-beating variants than generate; generate wins the
   ceiling only because high variance × high throughput lands a few extreme outliers. This means the
   "best strategy" depends on the goal: **highest single variant per run → reflect/generate (ceiling);
   most reliable per-variant improvement → reflect/criteria/editing (density).** reflect is the only arm
   that tops both. (Caveat: `%var>seed` is still mildly decisiveness-coupled — a drawn variant hugs the
   seed — and paragraph_recombine's 71% rests on just 7 variants.)

### Table A — Test-vs-Control Metrics Summary
Two DVs reported: the primary **max-lift ceiling magnitude** (median, P(best)) and the more
confound-robust **% improving** secondary (% of runs whose best variant beats the seed; and by ≥40 Elo).
Note how the two DVs disagree — the ceiling magnitude spreads the arms enormously while % improving shows a
much tighter field. Elo-per-$ = median lift / per-run cost ($0.10), a directional cost-efficiency proxy.

`runs` = completed/queued. `variants` = article-level variants produced / of-those-ranked (≥1 arena match);
this is the per-arm **throughput**, and it tracks the ceiling DV — more shots → higher max. (Earlier raw
funnel counts for paragraph arms were inflated by paragraph-slot intermediate variants; these are
article-level only.)

`bud/run` = configured per-run budget; `tot budget` = bud/run × queued runs; `spent` = actual cost. All
arms share the same equal budget ($0.10/run, $1.00/arm) — `spent` shows **budget utilization**: most arms
spend ~95–99%, but `coherence_pass` (87%) and especially `paragraph_recombine` (**59%**, 4 failed runs)
leave budget on the table, which depresses their throughput and ceiling.

`%var>seed` = % of an arm's **ranked variants** (not just the per-run best) whose Elo exceeds the seed —
a per-variant **quality density** that is *not* throughput-biased like the ceiling metrics. It ranks the
arms DIFFERENTLY from median lift (criteria/editing beat generate here): big-change arms (generate/reflect)
are high-variance — a few big winners but many losers — while targeted-edit arms more reliably clear the
seed but with a lower ceiling. reflect is the only arm that tops BOTH ceiling and density.

`median max-lift` = primary DV (median across runs of the per-run *best* variant's lift). `median Δ/inv` =
median Elo change **per invocation** (every ranked variant's Elo − seed, median over ALL the arm's variants).
The per-invocation view is ~3× smaller and exposes variance: generate's median (+31) is high but its mean is
only +10 (worst variant 1025) — it scatters; the targeted-edit arms (+19, mean≈median) are more consistent
per edit. It is the per-invocation analogue of the historical child-vs-parent metric (historical
iterative_editing +0 median / +6.5 mean vs +19/+17 here), making this experiment comparable to past runs.

| Arm | runs | variants (ranked) | median max-lift | **median Δ/inv** | **%impr** | **%impr≥40** | **%var>seed** | P(best) | P(top-40) | Δmedian vs generate [95% CI] | Holm p | sig | bud/run $ | tot budget $ | spent $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reflect_and_generate | 10/10 | 352 (244) | +165.5 | **+61** | 100% | **90%** | **94%** | **96%** | 99% | +34.2 [−6, 78] | 0.228 | no | 0.10 | 1.00 | 0.980 |
| generate (control) | 10/10 | 474 (317) | +131.3 | +31 | 100% | 90% | 64% | 4% | 69% | — | — | — | 0.10 | 1.00 | 0.969 |
| iterative_editing_rewrite | 10/10 | 171 (168) | +81.7 | +4 | 100% | 90% | 63% | 0% | 0% | −49.6 [−86, −5] | 1.000 | no | 0.10 | 1.00 | 0.978 |
| criteria_and_generate | 10/10 | 348 (235) | +77.4 | +19 | 100% | 80% | 81% | 0% | 0% | −53.9 [−83, −9] | 1.000 | no | 0.10 | 1.00 | 0.954 |
| single_pass_criteria | 10/10 | 344 (241) | +73.5 | +19 | 100% | 70% | 76% | 0% | 0% | −57.8 [−93, −14] | 1.000 | no | 0.10 | 1.00 | 0.964 |
| iterative_editing | 10/10 | 118 (117) | +54.9 | +19 | 100% | 80% | 78% | 0% | 0% | −76.4 [−94, −27] | 1.000 | no | 0.10 | 1.00 | 0.991 |
| proposer_approver | 10/10 | 263 (200) | +41.6 | +3 | 100% | 70% | 57% | 0% | 0% | −89.7 [−103, −42] | 1.000 | no | 0.10 | 1.00 | 0.986 |
| coherence_pass | 10/10 | 43 (43) | +6.9 | **−6** | 60% | 20% | 44% | 0% | 0% | −124.4 [−139, −82] | 1.000 | no | 0.10 | 1.00 | 0.866 |
| paragraph_recombine | 6/10 (4 fail) | 7 (7) | +2.9 | +19† | 50% | 20% | 71%† | 0% | 0% | −128.4 [−141, −78] | 1.000 | no | 0.10 | 1.00 | 0.586 |
| **Total / mean** | **86/90** | **2,120 (1,565)** | — | — | — | — | 73% | — | — | — | — | — | 0.10 | **9.00** | **8.27** |

† `paragraph_recombine`'s 71% is on only **7 ranked variants** — too few to trust. `%var>seed` uses the
DB Elo vs the ~1191 anchor (the recompute anchor is 1175.9; the ≤15-Elo offset does not change any arm's
relative position).

**Throughput is the hidden driver of the ceiling DV:** article-variant counts span **7 → 474** (68×) at
equal budget — generate ~47/run, reflect ~35/run, the criteria/proposer cluster ~26–35/run, editing ~12–17/run,
coherence ~4/run, and `paragraph_recombine` only **~1/run** (7 over 6 runs). An arm that produces 47 variants
has far more chances to land a high-Elo outlier than one producing ~1, so part of the max-lift spread is a
shots-on-goal artifact — reinforcing why the per-run % improving and a head-to-head DV are the fairer reads.
The two lowest-throughput arms are also the two that **under-spent** their budget (coherence 87%, paragraph
59%), so part of their low ceiling is simply unused budget, not just per-variant weakness.

### Follow-up Ideas
1. **Replace the confounded DV.** Max-Elo-lift in a shared self-judged pool rewards divergence. Prefer a
   decisiveness-robust comparison: direct head-to-head **variant-vs-seed** win-rate (each arm's best variant
   judged against the seed only), or a rubric/quality score that does not depend on inter-variant decisiveness.
2. **Audit the judge's draw behaviour** on small-edit variants — is a draw "genuinely indistinguishable
   quality" or "judge can't resolve a real improvement"? Run 2-pass position-swapped judging to quantify.
3. **Resolve reflect-vs-generate** with a focused tranche 2 (only the two contenders, more runs) if the
   head-to-head DV still favours reflect.
4. **Normalize for change magnitude** (e.g. sentence-edit distance) so small-edit and full-rewrite arms are
   comparable.

## Dataset
Per-run max-lift values and per-arm aggregates are reproducible from the queries below (no static CSV
committed for this tranche; the arena comparison log is the source of truth in staging). Confirm any future
`dataset.csv` contains no PII before committing (article text is non-PII Federal Reserve content).

## Queries & Results
- **Recompute + significance:** `evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts
  --experiment-id bc10c2e0-… --prompt-id 6f5c85e5-… --baseline generate --threshold 40` → seed anchor
  Elo 1175.9; Table A above. (In-memory OpenSkill replay of 2,122 entrants / 4,518 comparisons.)
- **Funnel/balance (6 SQL, `evolution/scripts/analysis/*.sql`, sed-substituted on experiment_id):**
  variants, invocations, decisive-matches, top-elo-gain, decisiveness-distribution, cost-breakdown.
  Raw per-arm results in Balance Audit + Decisiveness Audit below.
- **Arena-only wipeout HARD GATE:** `evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id bc10c2e0-…
  --json` → **count = 0** (no statistical-garbage runs; the 4 `paragraph_recombine` failures are genuine
  zero-variant runs counted as 0-lift, not arena-only wipeouts).

## Pre-Registered Analysis Plan
Quoted verbatim from `design_elo_improvement_experiment_20260626_planning.md → ## Pre-Registered Analysis
Plan` (9 arms; primary DV = per-run max-Elo-lift over the competing seed anchor via recompute; primary
test = Bootstrap P(best) + top-tier@40; secondary = one-sided Bootstrap diff-of-medians vs `generate`,
Holm-corrected; threshold 40 Elo; adaptive sizing, $40 cap). **Deviations:** (a) anchor-identification fix
(see Methodology); (b) analysis stops at tranche 1 (90 runs) pending a DV redesign — see Follow-up #1.

## Balance Audit
Table B — Experimental Validity Funnel (per arm; variants/invocations counts include paragraph-level
intermediate variants for the paragraph arms, hence their inflated raw totals):

| Arm | runs done/queued | invocations succ/fail | variants synced | matches | decisive |
|---|---|---|---|---|---|
| generate | 10/10 | 482/1 | 474 | 1099 | 588 |
| reflect_and_generate | 10/10 | 356/4 | 352 | 680 | 310 |
| criteria_and_generate | 10/10 | 348/5 | 348 | 630 | 30 |
| single_pass_criteria | 10/10 | 344/2 | 344 | 630 | 25 |
| proposer_approver | 10/10 | 263/54 | 263 | 491 | 5 |
| iterative_editing | 10/10 | 118/0 | 118 | 391 | 102 |
| iterative_editing_rewrite | 10/10 | 209/0 | 171 | 417 | 21 |
| paragraph_recombine | 6/10 (4 fail) | 11/2 | 185 | 911 | 403 |
| coherence_pass | 10/10 | 43/0 | 904 | 1627 | 94 |

### Wipeout Resolution
Wipeout detector returned **count = 0**; no runs excluded. The 4 `paragraph_recombine` failures are genuine
zero-variant outcomes (kept as 0-lift per PRAP), not arena-only wipeouts.

### Balance Notes
**Major imbalances (>15%), flagged:** (a) **matches-played** ranges 391→1627 (4.2×) and **variants
produced** 118→904 (7.7×) across arms — expected from differing agent architectures (full-rewrite vs
paragraph-recombine) but means per-arm Elo precision is uneven. (b) **`paragraph_recombine` completed only
6/10 runs** — a 40% funnel loss on one arm. (c) The **decisiveness imbalance (1%→53%)** is the dominant
validity threat — see next section; it is the basis for treating Table A's cross-arm ranking as confounded.

## Decisiveness Audit
Decisive = winner ≠ 'draw' AND confidence ≥ 0.6 (`DECISIVE_CONFIDENCE_THRESHOLD`). Per-arm decisive rate:

| Arm | decisive % | matches |
|---|---|---|
| generate | **53.5%** | 1099 |
| reflect_and_generate | 45.6% | 680 |
| paragraph_recombine | 44.2% | 911 |
| iterative_editing | 26.1% | 391 |
| coherence_pass | 5.8% | 1627 |
| iterative_editing_rewrite | 5.0% | 417 |
| criteria_and_generate | 4.8% | 630 |
| single_pass_criteria | 4.0% | 630 |
| **proposer_approver** | **1.0%** | 491 |

A 53× spread. All arms show 0 low-confidence matches (judge always returns ≥0.6 or a clean draw), so the
asymmetry is draw-rate, not abstention. **This invalidates a naive cross-arm Elo comparison:** the arms that
"lose" to generate are precisely the small-edit arms whose variants draw, and drawing variants cannot climb.

## Causal Evidence

**Pattern A — decisiveness compresses the Elo *spread* (a confound on the fine ordering), shown across
arms, not anecdotally.** Per-variant decisive rate rank-tracks the Elo band width:
- **proposer_approver** (1% decisive): 200 ranked variants span **1103–1241** (max +50 over the 1176 seed) —
  a narrow band hugging the mean; the judge separates them only weakly.
- **single_pass** (4%), **criteria** (5%), **coherence** (6%): similarly compressed top variants (1318/1286
  on recompute-stable variants).
- **generate** (53%) / **reflect** (46%): wide spreads, tops ~1340–1362; e.g. generate variant `620f6619`
  won **391 of its 1090** matches decisively, climbing well above the pack.
- Caveat on this pattern: `paragraph_recombine` is an **outlier** (44% decisive yet only +2.9 median lift,
  4 failed runs) — so decisiveness is *necessary-not-sufficient* for lift; the relationship is not monotone.

**Pattern B — but the low arms are *also genuinely weaker*, so the gap is not a pure artifact (below-seed
fraction, a decisiveness-robust quality proxy).** Fraction of each arm's matched variants scoring **below**
the seed anchor (~1191 DB Elo; lower = better):

| Arm | % below seed | % ≥ +40 above | top Elo |
|---|---|---|---|
| reflect_and_generate | **6%** | 72% (176 vars) | 1355 |
| criteria_and_generate | 19% | 12% | 1286 |
| iterative_editing | 22% | 12% | 1273 |
| single_pass_criteria | 24% | 10% | 1318 |
| generate | 36% | 32% | 1362 |
| iterative_editing_rewrite | 38% | 10% | 1288 |
| proposer_approver | **43%** | 6% | 1241 |
| coherence_pass | **64%** | 26%† | 1451† |

- **reflect** is genuinely consistent (only 6% below seed) — its lead is **not** a decisiveness artifact
  (generate is *more* decisive at 53% yet has 36% below-seed, so higher decisiveness did not manufacture
  reflect's edge). This is the key check that survives the confound.
- **proposer_approver** (43% below) and **coherence** (64% below) are producing genuinely worse variants —
  not merely drawing — so their low rank is partly real, not pure measurement artifact (correcting the
  earlier over-claim).
- **† coherence's "top 1451" is high-σ noise:** it synced 903 variants at ~1.8 matches each, so its extreme
  max is a barely-settled outlier, not a real improvement (its recompute-stable median lift is +6.9). This
  is direct evidence that the **max-over-variants ceiling DV is contaminated by high-σ noise for low-match
  arms** — a confound on the ceiling itself, separate from decisiveness.

**What the evidence does NOT establish:** that any *specific* low-decisiveness arm makes real-but-
undetectable improvements (a genuinely-good small edit and a no-op both read as draws/near-seed here). Only
the head-to-head variant-vs-seed test (Follow-up #1) can decouple "small change" from "undetectable
improvement." Findings are framed accordingly.

## Caveats & Confounders (≥3, enumerated)
1. **Baseline framing** — lift is over the seed's in-arena recompute (~1176), not nominal 1325.
2. **Judge-decisiveness imbalance (1%→53%)** — compresses low-decisiveness arms' Elo spread; fine ordering
   among middle arms unreliable.
3. **High-σ ceiling contamination** — `max(variant Elo)` per run is inflated by barely-matched, high-σ
   variants for low-match arms (coherence 1.8 matches/variant); the DV's upper tail is noisy where match
   density is low.
4. **Imputation / unequal n** — `paragraph_recombine` has 4/10 hard-zero imputed runs; its CI is not
   comparable to full-n arms.
5. **Funnel imbalance** — matches 391→1627 (4.2×) and variants 118→904 (7.7×) across arms → uneven Elo
   precision.
6. **Un-executed pre-registered components** — variant-σ propagation and the % improving / Elo-per-$
   secondary metrics were not run this pass (disclosed in Findings #5).
7. **Judge position-bias / priming** — not yet measured (no 2-pass swap data); a potential systematic
   confound on all decisive outcomes, deferred to Follow-up #2.
8. **Unranked-run artifact** — at least one run (`reflect`'s `184f9569-…`) synced variants that got **0 arena
   matches**, so its variants sit at the default rating and its "lift" is a default-rating artifact, not a
   measurement. The recompute counts it as a small positive lift rather than excluding it, so reflect's
   effective n is ~9 cleanly-ranked + 1 unranked. The same `arena_match_count>0` check should be applied
   per-arm before any tranche-2 conclusion (thin/zero-match variants inflate or floor the ceiling DV).

## Adversarial Review Log

### Iteration 1 (3 reviewers: Methodology, Statistical Validity, Causal Evidence)
Scores (min cell **2/5**, 12 critical gaps) — did NOT pass. Key gaps + fixes applied:
- **Overstated "measurement artifact" claim** (all 3 reviewers). → Reworked Finding 4 + Causal Evidence:
  ran the **below-seed audit** (proposer 43% / coherence 64% below seed = genuinely weaker; reflect 6% =
  genuinely consistent). Reframed: extremes are real, only the middle ordering is decisiveness-confounded.
- **P(best)=96% vs non-significant pairwise not reconciled.** → New Finding 2 explicitly separates "most
  often highest median" from "beats generate" (not significant at n=10).
- **Asymmetric confound (discount losers, trust reflect).** → Showed reflect's lead is NOT a decisiveness
  artifact (generate is *more* decisive yet has 6× more below-seed variants).
- **Missing pre-registered "% improving" secondary DV.** → Computed + added to Table A; surfaced the key
  reframing (7/9 arms improve the seed 100% of runs; field is tight on the robust binary DV).
- **High-σ ceiling contamination unaddressed** (coherence "top 1451" = noise). → Added as Caveat #3 + Causal
  Evidence note.
- **paragraph_recombine n=6 CI not comparable.** → Flagged in Finding 6 + Caveat #4.
- **<2 examples per pattern / confounders incomplete.** → Added per-arm below-seed table + 7-item Caveats
  section.
- **Variant-σ propagation (pre-registered) not run.** → Disclosed as deviation (Finding 5) with
  direction-of-effect analysis (omission is conservative for low arms).

### Iteration 2 (re-review after fixes)
**0 critical gaps from all 3 reviewers** — all explicitly state the EAR is ready. Section scores:
- Methodology: prap 5 / balance 5 / significance 5 / decisiveness 5 / causal 5 / caveats 5 (balance raised to
  5 after the two `?` funnel cells were filled).
- Statistical Validity: prap **4** / balance 5 / significance 5 / decisiveness 5 / causal 5 / caveats 5.
- Causal Evidence: prap **4** / balance 5 / significance 5 / decisiveness 5 / causal 5 / caveats 5.

Min cell = **4**, held solely by `prap_compliance` because the pre-registered **variant-σ propagation** in
the P(best) bootstrap was disclosed-but-not-executed (point Elo used). All reviewers agree the omission is
fully disclosed, conservative in direction (it would only widen low-match arms' ceilings, cannot manufacture
reflect's lead), and **not a blocker**. Remaining minor notes: dual seed-anchor reference (recompute 1175.9
vs DB 1191 in the below-seed proxy — does not flip any sign); coherence's bimodal tail is under-settled noise.

**Verdict:** 0 critical gaps; converged on substance. Formal 18/18 would require executing the variant-σ
bootstrap (conclusions unchanged). Brought to the user approval gate at this state.
