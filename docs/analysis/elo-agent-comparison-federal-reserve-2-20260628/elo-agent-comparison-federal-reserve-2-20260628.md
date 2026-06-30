# Elo Agent Comparison — Federal Reserve 2 Seed (tranche 1)

## Header
- **Analysis name:** elo-agent-comparison-federal-reserve-2-20260628
- **Project:** docs/planning/design_elo_improvement_experiment_20260626/
- **Branch:** feat/design_elo_improvement_experiment_20260626
- **Date:** 2026-06-28
- **Source research doc:** docs/planning/design_elo_improvement_experiment_20260626/design_elo_improvement_experiment_20260626_research.md
- **Working EAR (full rigor):** docs/planning/design_elo_improvement_experiment_20260626/EAR.md
- **Experiment:** staging `bc10c2e0-a51c-41a8-a2c3-34577a1fa489`, arena prompt `6f5c85e5-0d6f-42f3-ba91-cbf2377f2317`

## Methodology
9 agent "arms" each ran **10 single-iteration runs off one ~1325-Elo Federal Reserve seed** at equal budget
($0.10/run) and identical models (`google/gemini-2.5-flash-lite` generation + judge,
`maxComparisonsPerVariant: 3`). **Design verified from the data:** every arm has exactly 1 round
(`iterationConfigs` length 1, `sourceMode='seed'`) and **all 2,120 article variants parent directly off the
seed** (`parent_is_seed`) — one generation, no variant-of-variant lineage.

- **Canonical Elo (recompute-before-analysis):** ratings rebuilt **in-memory** from the 4,518-row
  `evolution_arena_comparisons` log (OpenSkill replay from default mu=25), NOT the race-prone live
  `elo_score`. Seed baseline = the competing anchor (`generation_method='pipeline'`, `run_id IS NULL`,
  266 matches), recomputed to **1175.9** (the per-variant `%var>seed`/`%below` proxies use the live-DB
  anchor ~1191; the ≤15-Elo offset changes no ordering).
- **Arena topology:** a fresh isolated arena (only the anchor + this experiment's variants — NOT the broader
  `federal_reserve_2` pool). Of 4,518 matches: **81% cross-run** (variant vs a different run's/arm's
  variant), **19% vs the seed anchor**, **0% same-run**. Each variant plays only ~3 matches (thin → high-σ);
  most meet the seed only transitively.
- **Primary DV:** per-run **max-Elo-lift over seed** (ceiling) = `max(run's variant Elo) − seedElo`; the
  per-arm headline is the **median across its 10 runs**. Zero-variant runs count as 0-lift.
- **Tests:** Bootstrap **P(best)** + top-tier P(within 40 Elo); secondary one-sided Bootstrap
  diff-of-medians vs `generate`, **Holm**-corrected.
- **Secondary DVs:** `%impr` / `%impr≥40` (share of runs whose best variant beats the seed / by ≥40);
  `%var>seed` (share of an arm's *ranked* variants above the seed — throughput-unbiased quality density).
- **Caveats (full list in EAR §Caveats):** judge-decisiveness imbalance (1%→53%) compresses low-decisiveness
  arms' Elo; max-over-variants ceiling is high-σ-noise-sensitive for low-match arms; `paragraph_recombine`
  has 4/10 imputed-zero runs; variant-σ propagation (pre-registered) disclosed-but-not-run (conservative
  direction). Validated by a 2-round adversarial review (0 critical gaps).

## Key Findings
1. **`reflect_and_generate` is the best arm and the only one that leads on every metric** — ceiling
   (median +165 Elo, P(best) 96%), reliability (%impr≥40 90%), and per-variant density (94% of its variants
   beat the seed). Corroborated by a confound-independent check: only 6% of its variants fall below the seed.
2. **P(best) 96% ≠ "significantly beats generate."** reflect's +34 Elo edge over `generate` has 95% CI
   [−6, +78], Holm p = 0.23 → **not significant at n=10**. reflect is the *likely* best, not a proven winner.
3. **The cross-arm Elo *ranking* is confounded — read it with the audits.** A 1%→53% judge-decisiveness
   spread + high-σ ceiling noise + a 68× throughput spread (7→474 variants/arm) all inflate the apparent gap
   between arms. The raw "+165 vs everything-else-worse-than-generate" story is largely a ceiling/variance
   artifact, not a clean quality ranking.
4. **The "+165" is lift over the seed's *in-arena* Elo (~1176), not its nominal 1325.** In a fresh isolated
   arena the seed re-rates to mid-pack; top variants ~1340, seed ~1176, one self-contained pool.
5. **On reliability (% improving), the field is far tighter than the ceiling implies.** 7 of 9 arms improve
   the seed in 100% of runs; by the ≥40 bar reflect/generate/editing_rewrite lead (90%), the
   criteria/editing/proposer middle sits 70–80%, only the paragraph arms trail (20%).
6. **Per-variant quality density (`%var>seed`) ranks arms OPPOSITELY to the ceiling.** reflect 94% ›
   **criteria 81% › iterative_editing 78% › single_pass 76% › generate 64%** › editing_rewrite 63% ›
   proposer 57% › coherence 44%. Targeted-edit arms produce a *higher share* of seed-beating variants;
   `generate` wins the ceiling only via high-variance outliers. **"Best arm" is goal-dependent:** highest
   single variant → reflect/generate; most reliable per-variant lift → reflect/criteria/editing.
7. **Throughput & budget utilization are hidden drivers.** Article-variant output spans 7→474/arm at equal
   budget; the two lowest-throughput arms also **under-spent** (coherence 87%, `paragraph_recombine` 59%
   with 4 failed runs), so part of their low ceiling is unused budget, not pure per-variant weakness.

### Follow-up Ideas
- Replace the throughput/decisiveness-confounded ceiling DV with a **head-to-head variant-vs-seed win-rate**
  (each arm's best variant judged directly against the seed) or an absolute rubric score.
- Run a focused **tranche 2** (reflect vs generate only, more runs) to resolve the pairwise significance.
- Audit judge **position-bias** (2-pass swap) and the draw-vs-undetectable-improvement question.

## Dataset
`dataset.csv` — one row per arm (9 arms) with all metrics: runs, article/ranked variant counts, median lift,
%impr/%impr≥40/%var>seed, P(best)/P(top-40), Δ-vs-generate + 95% CI + Holm p, decisive %, %below-seed,
budget/run, total budget, total spent. Source: staging experiment `bc10c2e0`. Federal Reserve article text
is non-PII; aggregates only. **Confirm dataset.csv contains no PII before committing.**

### Per-arm summary (mirror of dataset.csv)
`median max-lift/run` = primary DV (median across runs of the per-run *best* variant's lift) — the ceiling.
`median Δ/inv` = median Elo change **per agent invocation** (every ranked variant's Elo − seed, median over
ALL the arm's variants, not just the best). The per-invocation view is ~3× smaller and exposes variance:
generate's median (+31) is high but its **mean is only +10** (worst variant 1025) — it scatters, while the
targeted-edit arms (criteria/single_pass/editing, +19, mean≈median) are more consistent per edit.

| Arm | runs | variants (ranked) | median max-lift/run | **median Δ/inv** | %impr | %impr≥40 | %var>seed | P(best) | Δ vs gen [95% CI] | sig | spent $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| reflect_and_generate | 10/10 | 352 (244) | +165.5 | **+61** | 100% | 90% | 94% | 96% | +34.2 [−6, 78] | no | 0.980 |
| generate (control) | 10/10 | 474 (317) | +131.3 | +31 | 100% | 90% | 64% | 4% | — | — | 0.969 |
| iterative_editing_rewrite | 10/10 | 171 (168) | +81.7 | +4 | 100% | 90% | 63% | 0% | −49.6 [−86, −5] | no | 0.978 |
| criteria_and_generate | 10/10 | 348 (235) | +77.4 | +19 | 100% | 80% | 81% | 0% | −53.9 [−83, −9] | no | 0.954 |
| single_pass_criteria | 10/10 | 344 (241) | +73.5 | +19 | 100% | 70% | 76% | 0% | −57.8 [−93, −14] | no | 0.964 |
| iterative_editing | 10/10 | 118 (117) | +54.9 | +19 | 100% | 80% | 78% | 0% | −76.4 [−94, −27] | no | 0.991 |
| proposer_approver | 10/10 | 263 (200) | +41.6 | +3 | 100% | 70% | 57% | 0% | −89.7 [−103, −42] | no | 0.986 |
| coherence_pass | 10/10 | 43 (43) | +6.9 | **−6** | 60% | 20% | 44% | 0% | −124.4 [−139, −82] | no | 0.866 |
| paragraph_recombine | 6/10 (4 fail) | 7 (7) | +2.9 | +19† | 50% | 20% | 71% | 0% | −128.4 [−141, −78] | no | 0.586 |
| **Total/mean** | **86/90** | **2,120 (1,565)** | — | — | — | — | 73% | — | — | — | **8.27** |

† paragraph_recombine's `median Δ/inv` is on only 7 ranked variants — noisy. `median Δ/inv` uses the
DB seed anchor ~1191 (recompute anchor 1175.9; ≤15-Elo offset, no rank change). It is the per-invocation
analogue of the historical child-vs-parent metric (e.g. historical iterative_editing was +0 median / +6.5
mean vs +19/+17 here), so it makes this experiment comparable to pre-initiative runs.

## Queries & Results
All queries are recorded in `queries.sql` and were run via `npm run query:staging -- --json "<query>"`
against staging (read-only). Key ones:
- **Recompute + P(best)/Holm + %impr:** `evolution/scripts/experiments/analyzeEloAgentComparison_20260626.ts
  --experiment-id bc10c2e0-… --prompt-id 6f5c85e5-… --baseline generate --threshold 40` → seed anchor 1175.9;
  the median-lift / %impr / P(best) / Δ-vs-generate columns above.
- **Throughput (Q1 in queries.sql):** per-arm runs + article/ranked variant counts.
- **`%var>seed` (Q2):** share of ranked article variants with Elo > seed anchor (1191).
- **Decisiveness (Q3):** per-arm decisive % (winner≠draw, confidence≥0.6) — 1.0%→53.5%.
- **Below-seed (Q4):** per-arm % of ranked variants below the seed.
- **Budget utilization (Q5):** per-arm budget/run, total budget, total spent.
- **Design verification (Q6):** rounds=1 + sourceMode=seed (all 9 arms); 2,120 variants parent_is_seed.
- **Arena topology (Q7):** 81% cross-run / 19% vs-anchor / 0% same-run.
- **Wipeout gate:** `evolution/scripts/detectArenaOnlyWipeouts.ts --experiment-id bc10c2e0-… --json` → count 0.
