# Design Elo Improvement Experiment Research

<!-- Research findings for designing a rigorous, budget-aware staging experiment that measures which
     evolution agent type / strategy most effectively improves the Elo of a single ~1325-Elo seed
     article from the "Federal Reserve 2" arena. -->

## Problem Statement
Help design a robust experiment to measure which type of agent/strategy is the most effective at improving Elo for a 1325-Elo seed article from "Federal Reserve 2". The experiment must account for budget and confidence intervals, create a new Arena Topic seeded with just this single article, and be rigorous enough that we can both (a) confirm each agent worked as intended and (b) draw statistically valid conclusions about relative effectiveness.

## Requirements (from GH Issue #NNN)
Design a robust experiment accounting for budget & confidence intervals that can help assess which strategies and agent types are the most effective at improving up on a 1325 elo variant from Federal Reserve 2 on stage. We should create a new Arena Topic with just this single seed and make sure our design is very rigorous. Plan on doing careful analysis to make sure each of our agents are working as intended and that we are drawing the right conclusions.

## High Level Summary

**Goal.** Compare candidate evolution agents/strategies (the "arms") on their ability to lift a single fixed seed article above its current ~1325 Elo, with proper confidence intervals and budget accounting, and with per-agent sanity checks that each agent actually did its job.

**Key design facts surfaced by research:**

1. **The seed already exists in "Federal Reserve 2"** (`prompt_id = a546b7e9-f066-403d-9589-f5e0d2c9fa4f`, 2675 synced variants, arena max Elo ~1442). There is a *cluster* of variants near 1325 Elo, not one canonical one. Candidate seeds (all `generation_method='pipeline'`):
   - `da03b016-bad8-4089-8af8-6acbd1cbfb48` — Elo 1324.8, sigma 5.39, 4 matches ("A Living History and Practical Guide")
   - `538bfbc9-5c17-458e-bfde-c4ce6c76dab3` — Elo 1325.3, sigma 5.01, 5 matches ("Anchoring Main Street's Economy")
   - `93a9ac9d-5849-4294-9ccc-4281b8371c4d` — Elo 1325.4, sigma 5.49, 4 matches ("Architect of American Economic Stability")
   - **Caveat:** these "1325" ratings rest on only 3–6 matches → sigma 5–6 (OpenSkill) ≈ **80–96 Elo-scale uncertainty (±)**. The 1325 label is *noisy*. The experiment must NOT treat 1325 as a precise baseline; it must re-rate the seed in a controlled fresh arena.

2. **The right design is "new Arena Topic, single seed, copied seed as a fixed reference variant, N replicate runs per arm, all arms sharing the same arena."** This isolates the agent effect and lets every generated variant be Elo-compared head-to-head against the *same* seed and against each other.

3. **There are ~8 distinct candidate agent arms** (see §3). They span cheap single-shot (GFPA, criteria-single-pass), moderate (iterative editing, paragraph-recombine), and expensive (proposer-approver, paragraph+coherence). Cost per run ranges ~$0.005–$0.35.

4. **Rating is OpenSkill (Weng-Lin Bayesian)** exposed as `{elo, uncertainty}`. Pairwise matches judged by an LLM (default Qwen-2.5-7B) with **2-pass A/B order reversal** to mitigate position bias. Uncertainty shrinks per match; convergence threshold is `uncertainty < 72` Elo-scale (sigma < 4.5). **Confidence intervals exist at two levels**: per-variant (`elo ± 1.96·uncertainty`) and aggregate-across-runs (`bootstrapMeanCI`). The dominant noise at the experiment level is **cross-run variance**, so replicate runs (not just more matches) are what buy us tight conclusions.

5. **Infrastructure already supports this.** `evolution_experiments` groups N runs × M strategies against one prompt; the `manual_run_experiment` skill scaffolds a dated seed script, enforces production cost tracking, waits for completion, runs `/analysis`, and opens a PR. The minicomputer systemd runner (60s timer, `claim_evolution_run` FIFO + `FOR UPDATE SKIP LOCKED`) auto-claims pending non-test runs; a full 1-gen + 1-rank run takes ~2–4 min.

6. **Known failure modes that would corrupt the experiment** (must be actively monitored): 402/429 **arena-only wipeouts** (0 variants / 0 cost — OpenRouter credit/`max_tokens`), cost-tracking gaps (use `evolution_agent_invocations.cost_usd` / `evolution_metrics`, not raw `llmCallTracking`), and structured-output failures on cheap models. Each arm needs a per-invocation `success=true` + `variant_count>0` health gate before its Elo data is admitted to analysis.

**Open design questions for /planning + /plan-review** (see planning doc): which arms to include given budget; how many replicate runs per arm for the target power/CI; how to fairly equalize budget across cheap vs expensive arms (equal $/run vs equal variants/run vs equal wall-clock); whether the dependent variable is `max_elo`, `winner_elo`, or `eloAttrDelta` (improvement over seed); and the exact statistical test + pre-registered decision rule.

---

## 1. Rating, Arena & Confidence Intervals (the measurement instrument)

- **Model.** OpenSkill / Weng-Lin Bayesian, encapsulated in `computeRatings.ts`. Public surface is `Rating {elo, uncertainty}`; DB persists legacy `mu`/`sigma` columns converted via `dbToRating`/`ratingToDb`. Defaults: new variant starts `elo 1200, uncertainty ≈ 133.33` (sigma 400/3 → ×16 wait: uncertainty 133 = sigma 8.33×16). Convergence "settled" at `uncertainty < 72` (sigma < 4.5).
- **Match judging.** Pairwise LLM judge (default Qwen-2.5-7B, ~100% decisive, ~1.7s). **Temperature 0** on judge calls. **2-pass A/B order reversal** (forward A/B + reverse B/A in parallel) → aggregated to a confidence in [0,1]; a match with `confidence < 0.3` is a draw (no Elo update). Order-invariant SHA-256 comparison cache (LRU 500) avoids recompute.
- **Ranking pipeline** (per run): Phase 1 triage (~5 calibration opponents, early-exit when decisive) → Phase 2 Swiss fine-ranking (Bradley-Terry pairing `pWin = 1/(1+exp(-(eloA-eloB)/BETA_ELO))`, `BETA_ELO≈188.6`; budget tiers cap comparisons at 40 / 25 / 15 by budget spent; up to 20 rounds; stops on convergence/budget).
- **Two CI levels:**
  - **Per-variant:** `ci_lower/upper = elo ± 1.96·uncertainty`, stored in `evolution_metrics`. Shrinks with match count (no closed form; ~20–30 decisive matches to go from 133 → <72).
  - **Aggregate (this experiment's main instrument):** `bootstrapMeanCI()` resamples *across runs*. Cross-run variance dominates → **replicate runs are the lever** for tight conclusions, not just more matches per variant.
- **Improvement-over-parent metric.** `eloAttrDelta:<agentName>:<dimension>` = mean (child Elo − parent Elo) across invocations, with sample-SD uncertainty + 95% CI when n≥2, plus a histogram (`eloAttrDeltaHist:...`). Caveat in docs: bootstrap treats child+parent Elo as independent though they share a reference frame → CI is **conservative** (true CI typically narrower).
- **Noise/bias controls available:** 2-pass order reversal; temp-0 judge; draw on low confidence; comparison cache; optional multi-judge ensemble (`EVOLUTION_JUDGE_ESCALATION_ENABLED`, default off). **Not controlled by default:** run-order randomization (we must randomize arm execution order ourselves), transitivity violations (inherent to match-based Elo; Swiss similar-rating pairing mitigates).

## 2. Persisted dependent variables (candidate outcome metrics)

Run-level (`evolution_metrics`, `entity_type='run'`): `winner_elo` (+ uncertainty, ci_lower/upper), `max_elo`, `median_elo`, `p90_elo`, `variant_count`, `total_matches`, `decisive_rate`, `cost`, `generation_cost`, `ranking_cost`, `seed_cost`, and (paragraph agents) `cost_estimation_error_pct`.
Variant-level (`evolution_variants`): `elo_score`, `mu`, `sigma`, `arena_match_count`, `cost_usd`, `is_winner`, `parent_variant_ids`, `generation_method`.
Attribution: `eloAttrDelta:<agent>:<dim>`, `eloAttrDeltaHist:...`.

**Likely primary DV:** improvement over the *fixed seed* — best generated variant's Elo minus the seed's Elo **measured in the same fresh arena** (so the noisy historical 1325 doesn't contaminate). Secondary DVs: cost-per-Elo-point, decisive_rate, convergence speed, fraction of variants that beat the seed.

## 3. Candidate arms (agent types / strategies)

| # | Agent (config value) | Transformation | LLM calls/variant | Median cost | Class |
|---|---|---|---|---|---|
| 1 | **GFPA** `generate` | One of 24 tactics rewrites parent → 1 variant | 1 + ranking | cheap | baseline |
| 2 | **Reflect+Generate** `reflect_and_generate` | LLM ranks all 24 tactics for the parent, then GFPA | 2 + ranking | cheap | |
| 3 | **Criteria (legacy)** `criteria_and_generate` | Score parent vs rubric, suggest fixes for weakest-K, GFPA-apply | 2 + ranking | cheap | |
| 4 | **Criteria single-pass+guardrails** `single_pass_evaluate_criteria_and_generate` | Same + length/redundancy/flow guardrails; high-Elo(>1300) branch = surgical-edits-only | 2 + ranking | cheap | H1 |
| 5 | **Proposer-Approver criteria** `proposer_approver_criteria_generate` | Eval→propose CriticMarkup→forward-approve→mirror-approve→apply only (accept,reject) | ~4 + ranking | expensive | H2 |
| 6 | **Iterative editing** `iterative_editing` | N propose-review-apply cycles on full article (free cost, but ranking dominates) | 2/cycle + ranking | moderate→exp | |
| 7 | **Paragraph recombine** `paragraph_recombine` | Decompose→per-slot rewrites (distinct directives+temp ladder)→per-slot judge→reassemble | many small | ~$0.005 (cap $0.05) | cheap |
| 8 | **Paragraph + coherence pass** `paragraph_recombine_with_coherence_pass` | Isolated slot rewrites (no new content) → editing coherence pass over the splice | many small + cycles | ~$0.012–0.02 (cap $0.10) | moderate |

Notes that matter for fairness: most arms are configured as **strategies** (`evolution_strategies`, deduped by config hash). For a clean comparison, hold `generationModel`, `judgeModel`, temperature, criteria set, weakestK, ranking depth (`maxComparisonsPerVariant`) constant across arms; vary only `agentType`. The high-Elo seed (1325) is exactly the regime where docs report agents *struggle* (criteria single-pass: 100% lift on parents <1150 collapsing to ~20% on ≥1250), so effect sizes may be small → reinforces the need for replicates + tight CIs.

## 4. Seeding a single-seed Arena Topic

Two seed paths:
- **Explanation-based** (`evolution_runs.explanation_id`): seed text read from main-app `explanations`; seed not a competitor, only generation source. No arena entry loading.
- **Prompt-based** (`evolution_runs.prompt_id`): `generateSeedArticle()` makes a fresh seed (2 LLM calls, tracked as `seed_cost`); `loadArenaEntries(promptId)` loads prior synced variants as pre-rated competitors.

For this experiment we want a **NEW prompt** (new Arena Topic) whose only seeded content is a *copy of the chosen 1325 variant's text*, inserted as a fixed reference variant so every arm's output is judged against the identical baseline in an arena uncontaminated by the 2675 existing Federal-Reserve-2 variants. Mechanics to confirm in /research-deep: how to insert a seed variant that participates in ranking as a fixed anchor (vs. the default "seed excluded from pool since 2026-04-15"), or whether to register the seed as an arena entry with `synced_to_arena=true` and a pinned rating. **This is the #1 implementation question to resolve before building.**

## 5. Budget mechanics & execution (ops)

- **Three budget layers:** per-run (`budget_cap_usd`, default $1, throws `BudgetExceededError`), per-iteration (`budgetPercent` sums to 100, `IterationBudgetExceededError`), global daily/monthly (`LLMSpendingGate`, default $25/day staging). Reserve-before-spend with 1.3× margin; cost attributed per-agent via `AgentCostScope.getOwnSpent()` (authoritative, no sibling bleed).
- **Cost/run estimate:** seed gen ~$0.01–0.05; 1 generate iteration (6–9 agents) ~$0.12–0.25; 1 swiss iteration ~$0.03–0.08; **total ~$0.20–0.35** for cheap arms (use 1.5× margin). Paragraph arms much cheaper per variant. Wizard projector can under-estimate ~50% for paragraph agents → budget conservatively.
- **Execution:** minicomputer systemd timer every 60s → `processRunQueue.ts` → `claim_evolution_run` (FIFO, `FOR UPDATE SKIP LOCKED`, `EVOLUTION_MAX_CONCURRENT_RUNS=5`). Non-test strategies auto-claimed; `[TEST]/[E2E]/[TEST_EVO]`/`*-<digits>-*` strategies are test-gated and need targeted claim. **Minicomputer does not auto-pull main** — must `git pull --ff-only` after relevant merges before queueing (see memory `project_minicomputer_no_auto_pull`).
- **Existing tooling:** `manual_run_experiment` skill (scaffolds dated seed script under `evolution/scripts/experiments/`, enforces prod cost tracking, waits, triggers `/analysis`, opens PR); `evolution_experiments` entity + `/admin/evolution/start-experiment` wizard; run/experiment/variant admin detail pages for inspection.

## 6. Failure modes to guard against (so conclusions are valid)

| Failure | Fingerprint | Guard |
|---|---|---|
| 402/429 arena-only wipeout | `variant_count=0 AND cost≈0`, generate invocations >0 | check OpenRouter balance; ensure `EVOLUTION_MAX_OUTPUT_TOKENS=4096` on minicomputer; `detectArenaOnlyWipeouts.ts` |
| Cost-tracking gap | per-invocation costs don't sum to run cost; cost=0 w/ variants | use `evolution_agent_invocations.cost_usd` + `evolution_metrics`, not raw `llmCallTracking` |
| Structured-output parse fail (cheap models) | `structured_output_parse_failure`, ties→confidence 0 | prefer robust judge model; discard corrupted runs from analysis |
| Cost under-estimate (paragraph) | actual ≫ projected, budget exhausted mid-run | 1.5× budget margin; watch first runs |
| Run-order confounds | arms run sequentially → arena drift | randomize/interleave arm execution order |

Per-arm "agent worked as intended" gate before admitting Elo data: `success=true` on all invocations, `variant_count>0`, matches recorded in `evolution_arena_comparisons`, cost within 1.5× projection, no `structured_output_parse_failure`.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Evolution Docs (all 27 read via Explore agents)
- evolution/docs/README.md, architecture.md, data_model.md, entities.md
- evolution/docs/agents/overview.md, strategies_and_experiments.md
- evolution/docs/arena.md, rating_and_comparison.md, evolution_metrics.md, metrics.md, implicit_rubric_weights.md
- evolution/docs/criteria_agents.md, editing_agents.md, paragraph_recombine.md, paragraph_recombine_with_coherence_pass.md, multi_iteration_strategies.md, curriculum.md, prompt_editor.md, variant_lineage.md
- evolution/docs/cost_optimization.md, minicomputer_deployment.md, logging.md, reference.md, visualization.md, evolution_metrics.md
- evolution/docs/planning/multi_iteration_strategy_support_evolution_20260415/...

## Code Files Read
- (none yet — research phase used docs + read-only staging queries. Code-level confirmation of seed-as-fixed-anchor mechanics is the first /research-deep task; key files: `evolution/src/lib/pipeline/claimAndExecuteRun.ts`, `runIterationLoop.ts`, `findOrCreateStrategy.ts`, `evolution/scripts/processRunQueue.ts`, `evolution/scripts/experiments/`.)

## Staging Queries Run (read-only)
- Confirmed `Federal Reserve 2` = `a546b7e9-f066-403d-9589-f5e0d2c9fa4f` (2675 synced variants, max Elo 1442).
- Identified ~1325 seed candidates `da03b016…`, `538bfbc9…`, `93a9ac9d…` — all low match-count (3–6), sigma 5–6 → noisy baseline.
