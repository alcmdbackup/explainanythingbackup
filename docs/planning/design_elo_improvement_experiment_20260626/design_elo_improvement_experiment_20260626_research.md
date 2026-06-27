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

## Key Findings (code-level — Phase 0 /research, RESOLVED)

> **CORRECTIONS (post user-review, verified on staging 2026-06-26):** Three of the findings below were overstated and are corrected inline:
> - **Baseline precision doesn't matter.** The goal is a generally-higher-quality variant; ±some Elo on the seed is irrelevant. A fresh arena is for **isolation** (so FR2's 2675 variants don't dominate matchmaking), NOT to "re-rate the noisy 1325." (Supersedes the noisy-baseline framing in High Level Summary.)
> - **Seeds DO compete and get a real Elo on the leaderboard.** The FR2 seed (`26ab2327…`) shows Elo 1104.6, sigma 4.61, **21 matches / 21 comparison rows** — a settled, leaderboard-visible rating. The `excludeId` exclusion only stops the seed from being re-pulled as a generation *parent* within a run; it does not stop the seed from being rated. **⇒ The "two-row anchor trick" in KF1 is over-engineered and demoted to a fallback** — default is to insert the seed ONCE and let it compete; confirm in the pilot.
> - **No two-sample test isn't really a gap.** Per-variant/per-run Elo CIs already exist and are persisted; a between-arm comparison is a ~10-line wrapper over the existing bootstrap resampler (or just compare existing CIs). See corrected KF5.

**KF1 — Seeding a single-seed arena (default: insert once; two-row variant is a fallback).**
*Default mechanism (recommended):* create the new `evolution_prompts` row and insert the copied 1325 article ONCE as a `generation_method='seed'` row with `synced_to_arena=true`. It will be ranked and appear on the leaderboard with its own Elo (confirmed: seeds accumulate matches — FR2 seed has 21). Every run rewrites this fixed text; variants are rated in the shared, isolated arena and we compare arms by their variants' Elos. Pilot will confirm the single seed accumulates matches under current code.
*Fallback (only if pilot shows the seed isn't being matched enough):* additionally insert a second `generation_method='pipeline'` anchor copy (`synced_to_arena=true`, pinned mu/sigma) so it's force-loaded as a `fromArena` competitor. Original detail retained below for reference.

**KF1-detail (original, now fallback) — the two-row mechanic.**
- For a prompt-based run, `resolveContent` (`buildRunContext.ts:308–335`) looks for an existing arena seed: `evolution_variants WHERE prompt_id=? AND synced_to_arena=true AND generation_method='seed' AND archived_at IS NULL ORDER BY elo_score DESC LIMIT 1`. If present, its `variant_content` becomes the fixed seed source text and **LLM seed generation is skipped**.
- BUT `loadArenaEntries(promptId, db, seedVariantRow.id)` is called with `excludeId = the seed row` (`buildRunContext.ts:563–575`) → the `generation_method='seed'` row is **excluded from the competitor pool**. So a lone seed row is only generation source, never a ranked opponent.
- **Therefore, to make the seed a fixed competitor every variant must beat, pre-insert TWO rows for the new prompt:**
  1. **Anchor competitor** — `generation_method='pipeline'`, `synced_to_arena=true`, `archived_at=NULL`, `variant_content=<copied 1325 article>`, and `mu`/`sigma`/`elo_score` copied from the source variant. `loadArenaEntries` loads it as a `fromArena` rated competitor (ratings via `dbToRating(mu,sigma)`, `buildRunContext.ts:164–180`). Arena entries DO participate in ranking (`runIterationLoop.ts:460–461`); they're excluded only as candidate *parents* in pool-mode.
  2. **Seed source** — `generation_method='seed'`, same content → pins the generation source so each run rewrites the identical 1325 text instead of an LLM-generated fresh seed.
- **Ratings are pinned, not reset** — write the source variant's exact `mu`/`sigma` onto the anchor row.

**KF2 — Cross-run accumulation + the concurrency caveat (corrected).**
- `evolution_arena_comparisons` rows (written only by `MergeRatingsAgent`, plain INSERTs) **always persist and are never overwritten or lost** — confirmed. Ratings are recomputable from them at any time.
- **Concurrency caveat (corrected from "clobber"):** the only race is on the *summary rating snapshot* written back to an arena entry row — `sync_to_arena` does a plain `SET mu/sigma/elo_score = new value` (last-writer-wins) and `arena_match_count` is a racy read-modify-write. So under concurrent runs the entry-row's **displayed rating number** can be stale/undercounted, but **no match data is lost**. Mitigation is cheap: run the arms **serially**, OR recompute each variant's Elo from the preserved comparison rows at analysis time. Not a blocker.
- **Pool grows every run** (each run's variants get `synced_to_arena=true`; no topK cap). After many runs, new variants compete against the whole accumulated pool. This is fine for our question — we measure each variant's Elo within the shared arena and compare arms. `prompt_id` filtering guarantees zero contamination from *other* prompts; optional `archived_at` between rounds only if we want a pure vs-seed-only head-to-head.

**KF3 — Config surface for "arms differ only in agentType".**
- `StrategyConfig` (`evolution/src/lib/schemas.ts:1037+`); the whole config is hashed after normalization (`findOrCreateStrategy.ts` `hashStrategyConfig` → `v2:`+sha256). `FIELD_GATES` strips agent-irrelevant fields, so changing only `agentType` yields a distinct strategy. Good.
- **Ranking is inline/automatic** (`rankNewVariant`/`rankSingleVariant`) — **no trailing `swiss` iteration needed**; depth controlled by `maxComparisonsPerVariant` (default 15).
- **First-iteration constraint** (`canBeFirstIteration`, `schemas.ts:712`): only `generate`, `reflect_and_generate`, the 3 criteria agents, and the 2 paragraph agents may be iteration 1. **`iterative_editing`/`iterative_editing_rewrite`, `debate_and_generate`, `swiss` CANNOT be first** → those arms need a shared identical `generate` warm-up iteration. ⇒ Clean single-iteration comparison is only literal across the first-iteration-capable agents; editing/debate arms form a **separate comparison block** sharing the same warm-up.
- **Hold constant across arms:** `generationModel`, `judgeModel`, `generationTemperature`, `budgetUsd` + per-run `budget_cap_usd`, `maxComparisonsPerVariant`, iteration shape (count, budgetPercent, sourceMode). Per-agent required knobs (criteria need `criteriaIds`+`weakestK`; paragraph agents have their own knobs) are set minimally + identically within each agent family.
- **No agent env kill-switch is default-OFF** in this code (incl. proposer-approver) — leave env at defaults and pin fields explicitly so a toggle can't perturb an arm.

**KF4 — Experiment wiring + seed-script template.**
- `manageExperiments.ts`: `createExperiment(name, promptId, db)` (one shared `prompt_id`) → `addRunToExperiment(expId, {strategy_id, budget_cap_usd}, db)` × runsPerArm (interleave arms). Auto-completes via RPC `complete_experiment_if_done` when all runs finish.
- Clone `evolution/scripts/experiments/seedCoherencePassPerformanceExperiment_20260624.ts`: constants (PROMPT_ID, EXPERIMENT_NAME, BUDGET) → `buildConfig(arm)` → `buildDb('staging')` (`.env.local` + service role) → `seedStrategy` (config-hash collision guard → `upsertStrategy`) → `main()` (dry-run default, `--apply` writes). Generalize `buildConfig` to N arms. **Cost tracking is enforced downstream** (`trackedEvolutionProvider.ts:78` `requireTracking:true`, fail-closed) as long as we route through `upsertStrategy/createExperiment/addRunToExperiment` — never raw inserts or mocks. Orchestrated end-to-end by the `manual_run_experiment` skill (scaffold → wait → `/analysis` → PR).

**KF5 — Dependent variables exist; significance test does NOT (the one thing we must build).**
- Run-level DVs persisted in `evolution_metrics` (entity_type='run', columns `value`/`sigma`/`ci_lower`/`ci_upper`/`n`; uncertainty column is named **`sigma`**): `winner_elo`, `max_elo`, `median_elo`, `p90_elo`, `variant_count`, `total_matches`, `decisive_rate`, `cost`. Per-agent lift: `eloAttrDelta:<agent>:<dim>` = mean(child−parent Elo), persisted at run/strategy/experiment levels — **emitted by default** (kill switch `EVOLUTION_EMIT_ATTRIBUTION_METRICS=false`; 1750 experiment-level rows already exist on staging). Its CI is a deliberately conservative normal-approx (`±1.96·SD/√n`).
- Reusable stat helpers (`evolution/src/lib/metrics/experimentMetrics.ts`): `bootstrapMeanCI` (mean CI, propagates per-variant rating uncertainty via Box-Muller), `bootstrapPercentileCI` (p90/median CI across runs), `aggregateAvg` (n≥3 SE CI), `createSeededRng` (deterministic).
- **CORRECTED (not really a gap):** Elo CIs already exist and are persisted (per-variant + per-run `sigma`/`ci_lower`/`ci_upper`; single-group bootstrap CIs). The ONLY missing piece is a CI on the **difference between two arms' means**, and that is a **~10-line wrapper** that reuses the existing bootstrap resample loop (resample arm A + arm B per iteration, take `meanA−meanB`, read 2.5/97.5 percentiles; CI excluding 0 ⇒ significant) with `createSeededRng` for determinism + a Holm correction across arms. Zero-code interim option: compare the existing per-arm `bootstrapMeanCI` intervals for overlap (statistically weaker but valid). So this is a trivial wrapper, not new statistical machinery.

**KF6 — Per-agent QA gates (so a broken agent isn't mistaken for an ineffective one).**
- `evolution_agent_invocations` (`success`, `skipped`, `cost_usd`, `agent_name`, `error_message`, `execution_detail`): admit an arm's data only if every invocation `success=true`, `cost_usd>0`, no `error_message`.
- `evolution/scripts/detectArenaOnlyWipeouts.ts` `isArenaOnlyWipeout`: fingerprint = generation attempted (>0 generate invocations) AND 0 variants AND 0 cost AND finished "healthy-looking" (402/credit wipeout). Run per arm as a hard gate.
- Manual: read ≥1 variant/arm to confirm the transformation actually occurred.

**KF7 — Concrete staging facts captured.**
- Usable generic criteria (UUIDs): clarity `55a7ba56…`, depth `e532ac82…`, engagement `d18c3316…`, point_of_view `226aa0f0…`, sentence_variety `e39adb7e…`, structure `7e646847…`, stylistic_accuracy `a982f02f…`. (Ignore `TESTEVO-*` rows.) No FR-specific criteria needed.
- Seed candidates (mu/sigma to pin): `538bfbc9…` (mu 32.834, sigma 5.010, elo 1325.3, 5 matches, 9004 chars) — **most-settled, recommended anchor**; `93a9ac9d…` (mu 32.834, sigma 5.490, 8214 chars); `da03b016…` (mu 32.803, sigma 5.392, 7375 chars). All real full articles.

## Open Questions (for /planning + /plan-review)

1. **Serialize vs parallelize runs?** — RESOLVED (user, 2026-06-26): run **concurrently**, made correct by **idea 1** — a concurrency-safe live merge (re-read current arena rating + re-fold this run's matches + optimistic CAS; additive match_count) that fixes the `sync_to_arena` race at the source (covers the experiment AND production). The deterministic `scripts/recompute-arena-elo.ts` is **retained** for reproducible analysis numbers, idea-1 validation, and repairing existing arenas (e.g. FR2). Chosen over locking (B/C) and over per-run full replay (idea 2). See planning Decision F + Phase 1c.
2. **Pool-accumulation policy** — RESOLVED (user, 2026-06-26): **accumulate** (no archiving); compute the single common Elo scale at the end via the Decision F recompute. Accumulation gives a densely-anchored common scale; mitigate run-order/sparsity by interleaving arms + a pilot connectivity check. See planning Decision G.
3. **Arm partition** — RESOLVED (user, 2026-06-26): modify the two editing agents to run off the seed (Phase 1b) so all **9** seed-capable agents share one single-iteration structure. `debate_and_generate` excluded (left untouched); `swiss` out of scope. No warm-up confound.
4. **Primary DV** — RESOLVED (user, 2026-06-26): **ceiling = per-run max over the run's OWN variants' point Elos, lift over seed, at equal budget** (matches "keep the winner"); no hard noise guard. **Inference = bootstrap P(best)/top tier** (sub-decision 1, Option D) that resamples runs AND samples each variant Elo from `Normal(elo, variant_sigma)` (variant-sigma retained per user; mild Jensen tilt accepted, shrinkage pilot-gated). Secondary lens: each arm vs `generate` baseline. Secondaries: mean/`eloAttrDelta`, P(beat seed), Elo-per-$, variant_count. See planning Decision C + #4 notes.
5. **Significance test spec** — RESOLVED (user, 2026-06-26; planning Decision H): primary = bootstrap **P(best)/top tier** (no correction); secondary = **one-sided** vs-`generate` bootstrap diff-of-medians, **α=0.05 + Holm** over 8 tests; statistic = **median** per-run max-lift; minimal effect **~40 Elo** (pilot-calibrated) + **P(within 40 of best)** for practical top-tier.
6. **Run count** — RESOLVED (user, 2026-06-26; planning Decision E): **adaptive P(best) stopping** — run in batches, recompute P(best), stop when the top tier resolves (min-N floor + 2-batch stability) or the cap is hit. No precomputed cross-run sigma (the bootstrap captures run-to-run variability empirically); only **variant sigma** remains as a named term. Cap still to set (termination backstop). Cost ≈ runs × ~$0.10–0.30 (within $25/day staging cap).
7. **Provider headroom / ops pre-flight** — RESOLVED (user, 2026-06-26; planning Phase 2.5 gate): pre-flight checklist before any runs — provider credit for ~$40, `EVOLUTION_MAX_OUTPUT_TOKENS` set, minicomputer pulled current main + restarted, daily-cap pace, wipeout detector armed.

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

## Code Files Read (Phase 0 /research, via agents)
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — seed resolution (`resolveContent`) + `loadArenaEntries` (`excludeId`, `dbToRating`).
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — orchestration + seed persist.
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — pool/ranking, arena-entry participation, agent-type dispatch + env kill-switches.
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — `syncToArena` (`newEntries`/`arenaUpdates`), `complete_experiment_if_done`, attribution-metric emission.
- `evolution/src/lib/core/agents/MergeRatingsAgent.ts` — sole writer of `evolution_arena_comparisons`.
- `evolution/src/lib/schemas.ts` — `StrategyConfig`/`IterationConfig` Zod, `iterationAgentTypeEnum`, `canBeFirstIteration`, `evolution_criteria` schema.
- `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` — config hashing, normalization, `FIELD_GATES`, `upsertStrategy`.
- `evolution/src/lib/pipeline/manageExperiments.ts` — `createExperiment`, `addRunToExperiment`.
- `evolution/src/lib/metrics/experimentMetrics.ts` — `bootstrapMeanCI`, `bootstrapPercentileCI`, `computeEloAttributionMetrics`, `createSeededRng`.
- `evolution/src/lib/metrics/computations/{finalization,propagation}.ts` + `core/metricCatalog.ts` — run-level DV computation.
- `evolution/src/lib/pipeline/infra/trackedEvolutionProvider.ts` — `requireTracking:true` fail-closed cost tracking.
- `evolution/scripts/experiments/seedCoherencePassPerformanceExperiment_20260624.ts` + `evolution/scripts/seedBundleSplitExperiment.ts` (+ `.test.ts`) — seed-script template.
- `evolution/scripts/seedSampleCriteria.ts` — generic criteria seeding.
- `evolution/scripts/detectArenaOnlyWipeouts.ts` — `isArenaOnlyWipeout` QA gate.
- `.claude/skills/manual_run_experiment/SKILL.md`, `.claude/commands/analysis.md` — experiment + analysis orchestration contracts.

## Staging Queries Run (read-only)
- Confirmed `Federal Reserve 2` = `a546b7e9-f066-403d-9589-f5e0d2c9fa4f` (2675 synced variants, max Elo 1442).
- Identified ~1325 seed candidates `da03b016…`, `538bfbc9…`, `93a9ac9d…` — all low match-count (3–6), sigma 5–6 → noisy baseline.
