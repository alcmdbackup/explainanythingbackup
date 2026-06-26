# Design Elo Improvement Experiment Plan

<!-- Implementation plan for designing + running a rigorous, budget-aware staging experiment that
     ranks evolution agent types/strategies by their effectiveness at improving a single ~1325-Elo
     seed article from "Federal Reserve 2", with proper confidence intervals and per-agent QA. -->

## Background
Help design a robust experiment to measure which type of agent/strategy is the most effective at improving Elo for a 1325-Elo seed article from "Federal Reserve 2". The experiment must account for budget and confidence intervals, create a new Arena Topic seeded with just this single article, and be rigorous enough that we can both (a) confirm each agent worked as intended and (b) draw statistically valid conclusions about relative effectiveness.

## Requirements (from GH Issue #NNN)
Design a robust experiment accounting for budget & confidence intervals that can help assess which strategies and agent types are the most effective at improving up on a 1325 elo variant from Federal Reserve 2 on stage. We should create a new Arena Topic with just this single seed and make sure our design is very rigorous. Plan on doing careful analysis to make sure each of our agents are working as intended and that we are drawing the right conclusions.

## Problem
We want to know which evolution agent/strategy best improves a *specific, already-good* (≈1325 Elo) article. Three things make a naive A/B insufficient: (1) the historical 1325 rating is noisy — it rests on only 3–6 matches (sigma 5–6 ≈ ±80–96 Elo), so it cannot be the precise baseline; (2) at this high-Elo regime documented agent lift is small and sometimes negative, so effect sizes are near the noise floor and require replicates + bootstrap CIs; (3) cost varies ~70× across arms, so "effectiveness" must be defined against an explicit budget normalization or we'll just reward expensive arms. The design must control all of this and gate on per-agent health so a 402-wipeout or cost-tracking gap can't masquerade as "this agent is bad".

## Options Considered

### Decision A — Arena / baseline construction — RESOLVED → A1 (simplified per user review + staging verification)
- [x] **Option A1 (CHOSEN): New Arena Topic, seed inserted ONCE.** New `evolution_prompts` row + insert the copied 1325 article ONCE as `generation_method='seed'`, `synced_to_arena=true`. Verified that seeds genuinely compete and get a leaderboard Elo (FR2 seed `26ab2327…` = 1104.6, sigma 4.61, 21 matches), so no special "anchor" machinery is needed by default. The **only** reason for a fresh arena is **isolation** — keeping FR2's 2675 existing variants out of matchmaking so we cleanly measure improvement on *this* seed; the absolute baseline Elo is irrelevant (we care about generally-higher quality, not preserving 1325).
  - *Fallback (only if the pilot shows the single seed isn't matched enough):* also insert a `generation_method='pipeline'` anchor copy with pinned mu/sigma to force it into the competitor pool (research KF1-detail).
  - *Operational note (KF2, corrected):* match data is never lost; only the entry-row's summary rating races under concurrency. Mitigate cheaply by running arms **serially** or recomputing Elo from comparison rows at analysis. Pool accumulation across runs is acceptable — we read each variant's own Elo.
- [ ] **Option A2: Reuse existing Federal Reserve 2 arena.** Cheapest, but 2675 existing variants (max 1442) dominate matchmaking; new variants get compared against unrelated lineages, not the seed → confounds the "improve THIS article" question. Rejected unless A1 mechanics prove infeasible.
- [ ] **Option A3: New arena, seed only as generation source (not a competitor).** Measure each arm's variants' Elo within the new arena and compare arms to each other; infer seed baseline by also generating a "null/identity" arm. More moving parts; weaker direct "beat the seed" readout.

### Decision F — Concurrency & correct ratings — RESOLVED → parallel runs + post-hoc recompute (user, 2026-06-26)
- [x] **CHOSEN: run all runs CONCURRENTLY, then rebuild correct ratings from the durable match log before analysis.** The `sync_to_arena` race only corrupts *cached* mu/sigma/match_count on shared arena rows; the `evolution_arena_comparisons` match log is durable and stores enough (`entry_a`, `entry_b`, `winner`, `confidence`, `created_at`) to replay. Investigation confirmed no replay infra exists today and the rejected alternatives (lock/additive RPC, advisory-lock-the-merge) rewrite the global production rating-write path (high blast radius). 
  - **New code:** `scripts/recompute-arena-elo.ts` (~80–120 LoC, `--prompt-id`, `--dry-run` before/after diff). Replays comparisons in `ORDER BY created_at, id` through the existing `createRating`/`updateRating`/`updateDraw`/`ratingToDb`; seeds entrants from `evolution_variants` (`synced_to_arena=true AND archived_at IS NULL`); skips `confidence=0`, treats `winner='draw' || confidence<0.3` as draw; recounts `arena_match_count`; idempotent. No migration, no hot-path change.
  - **Flow:** queue all runs → wait for queue drain → run recompute → `/analysis`.
  - **Caveat (benign):** concurrency may make per-run *matchmaking* slightly less efficient (stale ratings → suboptimal pairings) but never changes match *outcomes* (LLM judges actual text); the replay corrects all final ratings. Supersedes the "serialize runs" note in Decision A / research KF2.

### Decision B — Budget normalization (what "effectiveness" means)
- [ ] **Option B1 (Recommended): Equal $ budget per run, report BOTH absolute lift and cost-normalized lift (Elo per $).** Fairest single framing; lets cheap arms shine on efficiency and expensive arms on absolute ceiling.
- [ ] **Option B2: Equal variants produced per run.** Controls for sample size but lets expensive arms consume far more budget.
- [ ] **Option B3: Equal wall-clock.** Operationally simplest, statistically muddiest. Rejected.

### Decision C — Primary dependent variable
- [ ] **Option C1 (Recommended): Best-variant Elo lift over the fixed seed, measured in the fresh arena**, aggregated across replicate runs with bootstrap 95% CI.
- [ ] **Option C2: `eloAttrDelta` (mean child−parent).** Good secondary/diagnostic; conservative CI per docs.
- [ ] **Option C3: Fraction of variants beating the seed.** Robust, intuitive secondary.

### Decision D — Arm set — RESOLVED → clean 9-arm single-iteration-from-seed block (user, 2026-06-26)
- [x] **CHOSEN: all 9 seed-capable agents, each as a single iteration off the seed.** After modifying the two editing agents (Phase 1b), every arm has the **identical structure** — one iteration, `sourceMode='seed'`, 100% budget — differing only in `agentType`. This is the cleanest possible comparison (no warm-up confound). The 9 arms:
  1. `generate` (baseline) · 2. `reflect_and_generate` · 3. `criteria_and_generate` · 4. `single_pass_evaluate_criteria_and_generate` · 5. `proposer_approver_criteria_generate` · 6. `iterative_editing` (Mode A, *modified*) · 7. `iterative_editing_rewrite` (Mode B, *modified*) · 8. `paragraph_recombine` · 9. `paragraph_recombine_with_coherence_pass`
  - **Excluded:** `debate_and_generate` (structurally needs ≥2 pool variants — left untouched per user) and `swiss` (ranking-only, not an improver).
  - Budget permitting, the pilot may trim to the most informative subset; default is all 9.

### Decision E — Sample size / power
- [ ] **Option E1 (Recommended): pilot first (2–3 runs/arm) to estimate cross-run SD, then size the full run count for ~80% power at a pre-registered minimal effect (e.g. ≥ +30 Elo) with multiplicity correction.**
- [ ] **Option E2: Fixed N=8 runs/arm** (rule-of-thumb from docs) without pilot. Simpler, riskier on power.

## Phased Execution Plan

### Phase 0: Deep research / mechanics confirmation (code-level)
- [ ] Confirm the **seed-as-fixed-anchor** mechanism in code: can a copied seed variant participate in ranking as a pinned reference in a new prompt? Read `claimAndExecuteRun.ts`, `runIterationLoop.ts`, `loadArenaEntries`, arena sync path. Resolve Decision A.
- [ ] Confirm how an **experiment** pins one `prompt_id` across multiple strategy arms and how `addRunToExperiment` sets budget/strategy. Read `experimentActionsV2.ts`, `ExperimentEntity.ts`.
- [ ] Confirm exact **strategy config surface** to hold constant across arms (model, judge, temperature, criteria set, weakestK, `maxComparisonsPerVariant`) and which single field flips `agentType`. Read `findOrCreateStrategy.ts`, pipeline `types.ts`.
- [ ] Verify minicomputer is on current code + has `EVOLUTION_MAX_OUTPUT_TOKENS` set; confirm OpenRouter/provider credit headroom for the planned spend.

### Phase 1: Finalize design + pre-registration
- [ ] Pick the single seed variant (from `da03b016` / `538bfbc9` / `93a9ac9d`) and record its text + a content hash.
- [ ] Lock arms (Decision D), budget normalization (B), primary+secondary DVs (C), and the analysis/decision rule (E) into this doc as a **pre-registered protocol** (hypotheses, primary DV, test, α with correction, minimal effect size, exclusion rules).
- [ ] Define the **per-agent QA gate** (success rate, variant_count>0, matches recorded, cost within 1.5× projection, no parse failures, manual read of ≥1 variant/arm to confirm the transformation actually happened).

### Phase 1b: Enable editing agents to run off the seed (product code change)
*Goal: make `iterative_editing` (Mode A) and `iterative_editing_rewrite` (Mode B) valid as a first iteration sourcing the seed directly, so all 9 arms share one structure. Debate is intentionally NOT touched; swiss out of scope.*
- [ ] `evolution/src/lib/schemas.ts` — add `iterative_editing` + `iterative_editing_rewrite` to `canBeFirstIteration()` (currently excluded at L712–720). Extend `sourceMode` validity (and its doc comment at L782) to editing iterations so `sourceMode='seed'` is accepted.
- [ ] `evolution/src/lib/pipeline/loop/editingDispatch.ts` + `runIterationLoop.ts` editing branch — when the editing iteration is first / `sourceMode='seed'`, feed the **seed** as the single parent instead of selecting from the pool via `resolveEditingDispatchRuntime`/`editingEligibilityCutoff`. Confirm the post-edit ranking path works when the pool is just the seed/arena entry (the edited variant ranks against the seed).
- [ ] Verify the projector/cost-estimation path (`projectDispatchPlan.ts`) handles a first-iteration editing dispatch (pool size 1) without a divide-by-zero / empty-pool gate fail.
- [ ] Keep the change behind the existing `EDITING_AGENTS_ENABLED` switch semantics; do not alter Mode A/B behavior when sourced from the pool (backward compatible).
- [ ] Run lint + tsc + build + unit tests after the change (per CLAUDE.md).

### Phase 2: Build the experiment artifact
- [ ] Create the new Arena Topic prompt + insert the seed ONCE (`generation_method='seed'`, `synced_to_arena=true`), per Decision A. (Idempotent / guarded insert.) Keep the two-row anchor as a documented fallback if the pilot shows the seed isn't matched enough.
- [ ] Author a dated seed script under `evolution/scripts/experiments/seedElo<...>Experiment_20260626.ts` cloned from `seedCoherencePassPerformanceExperiment_20260624.ts` (research KF4): generalized `buildConfig` to N arms (config-hash-distinct only on `agentType`; hold-constant set per KF3; criteria arms reuse the existing generic criteria UUIDs from KF7), creates the experiment, queues N runs/arm interleaved at equal `budgetUsd`+`budget_cap_usd`. Cost tracking enforced downstream (do NOT bypass `upsert/create/addRun`). Add README index row.
- [ ] **Build `scripts/recompute-arena-elo.ts` (Decision F):** replays `evolution_arena_comparisons` for the prompt through the existing OpenSkill wrapper to write correct final `mu`/`sigma`/`elo_score`/`arena_match_count`; `--prompt-id` + `--dry-run` diff; deterministic + idempotent; seeds entrants from `evolution_variants (synced_to_arena=true AND archived_at IS NULL)`, skips `confidence=0`, draws on `winner='draw' || confidence<0.3`. Run after the queue drains, before `/analysis`. + unit test (fixed comparison list → deterministic ratings).
- [ ] **Add the small difference-of-means CI wrapper (KF5, corrected — NOT a new test):** a ~10-line helper (e.g. `evolution/src/lib/metrics/abComparison.ts`) reusing the existing bootstrap resampler — resample arm A + arm B per iteration, take `meanA−meanB`, read 2.5/97.5 percentiles (CI excluding 0 ⇒ significant), with Holm correction across arms, seeded via `createSeededRng`. Interim zero-code option: compare existing per-arm `bootstrapMeanCI` intervals for overlap. Elo CIs themselves already exist/persist — no new statistical machinery.
- [ ] Add unit tests: (a) seed-script `buildConfig` — arms differ only in `agentType`, budgets sum, config hashes distinct; (b) the new significance helper — known-input p-values, determinism under fixed seed, correction math.

### Phase 3: Pilot
- [ ] Queue 2–3 runs/arm; let the minicomputer execute. Verify QA gate passes for every run; estimate per-arm cross-run SD and actual cost/run.
- [ ] Size the full run count from pilot SD (Decision E1). Adjust budget if cost diverged > 1.5×.

### Phase 4: Full run + analysis
- [ ] Queue the sized run counts (interleave arm order). Runs execute **concurrently** (Decision F). Monitor for wipeouts/cost gaps.
- [ ] After the queue drains, run `scripts/recompute-arena-elo.ts --prompt-id <arena> --dry-run`, review the diff, then apply — so analysis reads correct, race-free final ratings.
- [ ] Run `/analysis`: per-arm best-variant Elo lift (bootstrap 95% CI), Elo-per-$, fraction beating seed, decisive_rate, convergence; apply the pre-registered test + multiplicity correction; report winners with CIs and the per-agent QA evidence.
- [ ] Write the analysis report to `docs/analysis/<name>/` and link from this project's docs (Artifacts section).

## Testing

### Unit Tests
- [ ] `evolution/src/lib/schemas.test.ts` (or colocated) — `canBeFirstIteration` now true for both editing modes; `sourceMode='seed'` valid on an editing iteration; existing pool-mode editing config still validates (backward compat).
- [ ] `evolution/src/lib/pipeline/loop/editingDispatch.test.ts` — first-iteration / `sourceMode='seed'` feeds the seed as the single parent; pool-mode dispatch unchanged.
- [ ] `evolution/scripts/experiments/seedElo<...>Experiment_20260626.test.ts` — config-builder produces arms that differ ONLY in `agentType`; budgets/run-counts correct; config hashes distinct per arm (mirror `seedBundleSplitExperiment.test.ts`). NOTE: confirm the test path is inside the jest glob (recent commit dropped an e2e-tree test jest ignored).
- [ ] `evolution/src/lib/metrics/abComparison.test.ts` — permutation/bootstrap difference-of-means helper: correct p-value on known inputs, deterministic under fixed `createSeededRng`, Holm/Bonferroni correction across K arms.

### Integration Tests
- [ ] (If a helper to insert the two seed rows is added) integration test against staging schema that the anchor row is loaded as a `fromArena` competitor and the seed-source row pins generation text. Otherwise N/A (experiment is data/ops + one stats helper, not broad new product code).

### E2E Tests
- [ ] N/A unless new admin UI is added. If the experiment surfaces in `/admin/evolution/experiments`, a smoke check that the experiment + arms render (likely covered by existing `@evolution` specs).

### Manual Verification
- [ ] Read ≥1 produced variant per arm and confirm the agent's transformation actually occurred (e.g. paragraph-recombine reassembled slots; proposer-approver applied selective edits).
- [ ] Confirm the seed anchor's fresh-arena Elo is stable across pilot runs (sanity of the baseline).

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A (no UI change expected). If admin experiment view is used for inspection, manual screenshot of the experiment detail page suffices.

### B) Automated Tests
- [ ] `npm run test:unit -- seedElo` (seed-script config-builder test).
- [ ] Read-only staging verification queries (run health, cost reconciliation, Elo extraction) captured in the `/analysis` report.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/editing_agents.md` — document that Mode A/B editing agents can now run as a first iteration off the seed (`sourceMode='seed'`), and the dispatch behavior when the pool is just the seed.
- [ ] `evolution/docs/strategies_and_experiments.md` — add this experiment as a worked example of a single-seed agent comparison (if the pattern is reusable).
- [ ] `evolution/docs/arena.md` — clarify the seed-as-fixed-anchor mechanism if Phase 0 surfaces under-documented behavior.
- [ ] `evolution/docs/rating_and_comparison.md` — note the replicate-runs-vs-matches CI guidance if confirmed.
- [ ] `docs/analysis/<name>/` — new analysis report (created by `/analysis` in Phase 4).

## Review & Discussion
<!-- Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration. -->
