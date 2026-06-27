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

### Decision F — Concurrency & correct ratings — RESOLVED → live concurrency-safe merge (idea 1) + retained terminal recompute (user, 2026-06-26)
Run all runs CONCURRENTLY, made correct by a root-cause fix to the live merge, with the deterministic recompute retained for reproducibility/validation/repair. Two complementary mechanisms:
- [x] **Idea 1 — concurrency-safe live merge (product code, the primary fix; built in Phase 1c).** Root-cause fix to the `sync_to_arena` write path so concurrent runs produce correct arena-entry ratings **live** — covering our experiment AND fixing the standing production race. Mechanism: at merge time, instead of writing an absolute rating computed from a start-of-run snapshot, **re-read each arena entry's CURRENT rating, re-fold this run's matches onto it, and write under an optimistic CAS guard** (`WHERE mu=$read_mu AND sigma=$read_sigma`; retry on 0-row conflict); make `arena_match_count` **additive** (`= count + delta`). Cheap (only this run's matches → flat as the arena grows), preserves existing online-Elo semantics, lock-free (no `FOR UPDATE`, no advisory lock, no deadlock ordering). Chosen over locking (Options B/C) for elegance + scaling; chosen over per-run full replay (idea 2) which doesn't scale and needs a terminal pass anyway.
- [x] **Terminal recompute — RETAINED but repurposed (`scripts/recompute-arena-elo.ts`).** No longer the *correctness* mechanism (idea 1 owns that); kept for three things: (a) **reproducible analysis numbers** — idea 1's live ratings are order-dependent (online Elo), so a fixed-order (`created_at,id`) replay through the existing `createRating`/`updateRating`/`updateDraw`/`ratingToDb` gives stable, canonical ratings for the comparison; (b) **validation** — cross-check that idea 1's live ratings agree with a clean replay (same arm ranking within tolerance); a mismatch flags an idea-1 bug; (c) **repair** — prompt-agnostic tool to rebuild existing arenas (e.g. FR2) that predate the fix. Seeds entrants from `evolution_variants (synced_to_arena=true AND archived_at IS NULL)`, skips `confidence=0`, draws on `winner='draw' || confidence<0.3`, recounts `arena_match_count`, idempotent.
  - **Flow:** queue all runs → run concurrently (live ratings correct via idea 1) → after queue drains, run the terminal recompute for reproducible analysis numbers + idea-1 validation → `/analysis`.
  - **Tradeoff acknowledged:** idea 1 is a production hot-path change → elevated testing bar (unit + a concurrency integration test + migration-verify if the RPC changes + E2E evolution regression). Worth it: correct-by-construction experiment + fixes a real production bug.
  - Supersedes the "serialize runs" note in Decision A / research KF2.

### Decision G — Pool-accumulation policy — RESOLVED → accumulate, compare at the end (user, 2026-06-26)
- [x] **CHOSEN: let the shared arena accumulate (no archiving between runs); derive the single common Elo scale at the very end via the Decision F recompute.** Accumulation keeps all arms on one densely-anchored Elo scale (the seed + every variant act as shared anchors); archiving would sever cross-run/cross-arm comparability, leaving the seed as the only thin link. Keeping all match data also preserves optionality — the final recompute can produce any rating *view* (full arena, or each arm's top-K + seed). 
  - **Risk + mitigation:** run-order/sparsity (late variants face a bigger pool) → interleave arm execution (round-robin) + a **pilot connectivity check** (confirm the rating graph is well-connected across arms; add a fixed anchor set only if thin).
  - **Operational watch (non-blocking):** each run loads all synced variants at start — fine at ~500–1000; revisit if runs scale 10×.

### Decision B — Budget normalization (what "effectiveness" means)
- [ ] **Option B1 (Recommended): Equal $ budget per run, report BOTH absolute lift and cost-normalized lift (Elo per $).** Fairest single framing; lets cheap arms shine on efficiency and expensive arms on absolute ceiling.
- [ ] **Option B2: Equal variants produced per run.** Controls for sample size but lets expensive arms consume far more budget.
- [ ] **Option B3: Equal wall-clock.** Operationally simplest, statistically muddiest. Rejected.

> **Terminology:** **variant sigma** = the rating uncertainty on a *single variant's* Elo (the codebase's `Rating.uncertainty`; DB column `sigma`) — used inside the P(best) bootstrap. This is the ONLY named "sigma" in the design. (Run-count sizing is adaptive via P(best) — Decision E — so there is deliberately no separate "cross-run sigma" term; run-to-run consistency, if reported, is described in plain language.) Literal `mu`/`sigma` below refer to DB columns.

### Decision C — Primary dependent variable — RESOLVED → ceiling (point-max lift over seed) + variant-sigma-propagating P(best) (user, 2026-06-26)
- [x] **PRIMARY metric (point estimate): per-run max Elo lift over the seed, at equal budget.** `ceiling(R) = max over the variants run R generated of point elo(v)`; `maxLift(R) = ceiling(R) − seedElo`, on the common recomputed scale. **Max is over a run's OWN generated variants only** (filter by `run_id`) — NOT the persisted pooled `max_elo` metric (which includes loaded arena entries from other arms). Plain max over **point** Elos — no sampling, no hard "noise guard" (retired). One value per run → per-arm distribution → **median** headline (mean reported as a cross-check; if they disagree on ranking → skew flag). Matches "keep the winner per fixed budget"; under equal budget an arm's variant *volume* is legitimate value, not a confound.
- [x] **INFERENCE — P(best) / top tier (see #4 sub-decision 1):** bootstrap that (1) **resamples runs** within each arm AND (2) **samples each variant's Elo from `Normal(elo, variant_sigma)`** before taking the per-run max, computes each arm's **median** maxLift in the replicate, and tallies which arm is highest → **P(best) per arm**. Variant-sigma sampling is RETAINED (user) so per-variant rating uncertainty propagates into the confidence, not just run-to-run variance.
  - **Acknowledged tilt (accepted):** sample-then-max tilts slightly upward (Jensen) — credits arms whose ceilings rest on higher variant-sigma (less-settled) variants ("might be best" upside). Pilot checks whether arms differ systematically in variant sigma / match-count; if so, add empirical-Bayes **shrinkage** before the max as a conservative upgrade. The point-estimate metric itself stays point-max (unsampled), so the tilt lives only in the confidence calc.
- [x] **SECONDARY (decompose *why* an arm wins):**
  - **% of runs improving on the seed (run-level reliability, user-requested):** fraction of an arm's runs with `maxLift(R) > 0` — "chance one deployment beats the seed at all," with a CI. Once the minimal effect (#4) is set, also track "% of runs improving by ≥ threshold."
  - mean lift / `eloAttrDelta` (already persisted) — per-attempt quality, count-robust; separates "wins via volume" from "wins because each attempt is strong".
  - fraction of *variants* above the seed (variant-level density — distinct from the run-level reliability metric above).
  - Elo-lift-per-$ — explicit cost efficiency (≈ primary at equal budget; matters if budgets ever differ).
  - variant_count — context/diagnostic.

### Decision H — Significance / analysis spec — RESOLVED (user, 2026-06-26)
- [x] **Comparison structure (sub-decision 1):** PRIMARY = bootstrap **P(best) / top tier** across all 9 arms (Option D). SECONDARY = **vs-baseline** — each of the 8 non-`generate` arms tested against `generate` ("is the added complexity worth it vs the default?").
- [x] **Statistic (sub-decision 2a):** per-arm **median** of per-run maxLift (mean as cross-check). [Decision C]
- [x] **vs-baseline test direction (sub-decision 2c):** **one-sided**, testing arm **>** `generate` (max power to detect improvement, per user). Still **report the full effect-size CI descriptively** so an arm that *underperforms* the baseline stays visible (estimate + CI direction), even though the formal test only targets "better".
- [x] **vs-baseline test mechanism (sub-decision 2b):** bootstrap difference-of-medians (same resampler as the P(best) bootstrap), giving effect size + one-sided p-value.
- [x] **α + multiple-comparison correction (sub-decision 3):** **α = 0.05**, **Holm-Bonferroni** over the 8 vs-baseline tests (family-wise error control, uniformly more powerful than plain Bonferroni). The **P(best) primary needs no correction** — it's one joint procedure, not a family of tests.
- [x] **Minimal meaningful effect size (sub-decision 4):** **~40 Elo (≈ 55% head-to-head win rate), pilot-calibrated.** Used for: (a) "meaningfully improved the seed" (`maxLift ≥ 40`); (b) "meaningfully better than another arm / baseline" (median-lift difference ≥ 40); (c) sizing the #5 power calc. Pre-registered at 40; pilot may adjust given the observed spread (cluster <20 → report "no meaningful differences"; spread 80+ → 40 cleanly separates tiers). Same value for vs-seed and between-arm for now.
- [x] **Threshold ↔ P(best) integration:** P(best) tracks gap/noise (statistical distinguishability), NOT absolute magnitude — so with enough runs a trivial gap can yield high P(best). Guard against that by reporting, alongside strict P(best): **P(arm within `40` Elo of the best)** (practical top-tier membership) + per-arm median max-lift with CIs (raw magnitudes). A "winner" must be both high-P(best) AND ≥ 40 above the runner-up; otherwise report a tied top tier.

### Decision D — Arm set — RESOLVED → clean 9-arm single-iteration-from-seed block (user, 2026-06-26)
- [x] **CHOSEN: all 9 seed-capable agents, each as a single iteration off the seed.** After modifying the two editing agents (Phase 1b), every arm has the **identical structure** — one iteration, `sourceMode='seed'`, 100% budget — differing only in `agentType`. This is the cleanest possible comparison (no warm-up confound). The 9 arms:
  1. `generate` (baseline) · 2. `reflect_and_generate` · 3. `criteria_and_generate` · 4. `single_pass_evaluate_criteria_and_generate` · 5. `proposer_approver_criteria_generate` · 6. `iterative_editing` (Mode A, *modified*) · 7. `iterative_editing_rewrite` (Mode B, *modified*) · 8. `paragraph_recombine` · 9. `paragraph_recombine_with_coherence_pass`
  - **Excluded:** `debate_and_generate` (structurally needs ≥2 pool variants — left untouched per user) and `swiss` (ranking-only, not an improver).
  - Budget permitting, the pilot may trim to the most informative subset; default is all 9.

### Decision E — Sample size — RESOLVED → adaptive P(best) stopping (user, 2026-06-26)
- [x] **CHOSEN: adaptive sequential sizing driven by P(best); no precomputed cross-run sigma.** Run in batches → recompute P(best) after each → **stop** when the top tier resolves OR the cap is hit. Works because the P(best) bootstrap captures run-to-run variability empirically (resamples real runs) and P(best) is a posterior-like quantity, robust to optional stopping (unlike a p-value).
  - **Stopping rule (pre-registered):** stop when **any** of — (1) one arm P(best) > 0.9, stable for 2 consecutive batches; (2) the within-40-of-best set is stable for 2 batches and mutually indistinguishable → co-best tier; (3) **cap reached** → report whatever tier formed (possibly "inconclusive — needs more runs").
  - **Anti-fluke guards:** min-N floor (≥5 runs/arm) before any stop; check every +3 runs/arm (not continuously).
  - **Frequentist secondary stays clean:** the one-sided vs-`generate` tests (Holm) are computed ONCE at the final stopped N — never used as the stopping signal — so optional-stopping inflation doesn't touch them.
  - **Trade accepted:** exact run count isn't known upfront (discovered adaptively, bounded by the cap). Run-to-run consistency reported descriptively, not as a named sigma.
  - **CAP: $40 total budget** (hard termination backstop; if hit without resolution → report the tier as inconclusive / consider trimming arms).
  - **Initial validation batch (lower budget, ~$5 ≈ 1–2 runs/arm), run FIRST:** confirm end-to-end pipeline health — idea-1 concurrency fix, all 9 agents actually running off the seed, QA gates (success/cost/no-wipeout), recompute + connectivity check — *before* committing spend toward the $40 cap. This batch is below the min-N floor, so it's validation only, NOT stopping-eligible. Adaptive P(best) stopping is evaluated only after ≥5 runs/arm. If the initial batch surfaces problems, fix before scaling.

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

### Phase 1c: Concurrency-safe arena merge — idea 1 (product code change, Decision F)
*Goal: make concurrent runs produce correct arena-entry ratings live, so the experiment is correct-by-construction and the standing production race is fixed. Hot-path change → elevated testing bar.*
- [ ] Extract the rating fold into a **pure function** `(matches, startingRatings) → finalRatings` callable at sync time (refactor from `MergeRatingsAgent.ts`, which currently folds from the start-of-run snapshot).
- [ ] In `persistRunResults.syncToArena` + the `sync_to_arena` RPC: for arena entries (the contended shared rows), **re-read current `mu`/`sigma` at merge time**, re-fold this run's matches onto them, and write via an **optimistic CAS** predicate (`WHERE mu=$read_mu AND sigma=$read_sigma`); on 0-row conflict, re-read and retry (bounded retries + small backoff). Make `arena_match_count` **additive** (`= arena_match_count + $delta`). New variants remain plain inserts (uncontended).
- [ ] Backward compatible: single-run / non-overlapping merges behave identically to today; only the concurrent-overlap case changes.
- [ ] `npm run migration:verify` if the RPC signature/body changes (Docker postgres).
- [ ] lint + tsc + build + unit + integration after the change (per CLAUDE.md).
- [ ] **Validation gate:** after Phase 3 pilot, confirm idea-1 live ratings agree with the terminal recompute (same arm ranking within tolerance) before the full run.

### Phase 2: Build the experiment artifact
- [ ] Create the new Arena Topic prompt + insert the seed ONCE (`generation_method='seed'`, `synced_to_arena=true`), per Decision A. (Idempotent / guarded insert.) Keep the two-row anchor as a documented fallback if the pilot shows the seed isn't matched enough.
- [ ] Author a dated seed script under `evolution/scripts/experiments/seedElo<...>Experiment_20260626.ts` cloned from `seedCoherencePassPerformanceExperiment_20260624.ts` (research KF4): generalized `buildConfig` to N arms (config-hash-distinct only on `agentType`; hold-constant set per KF3; criteria arms reuse the existing generic criteria UUIDs from KF7), creates the experiment, queues N runs/arm interleaved at equal `budgetUsd`+`budget_cap_usd`. Cost tracking enforced downstream (do NOT bypass `upsert/create/addRun`). Add README index row.
- [ ] **Build `scripts/recompute-arena-elo.ts` (Decision F):** replays `evolution_arena_comparisons` for the prompt through the existing OpenSkill wrapper to write correct final `mu`/`sigma`/`elo_score`/`arena_match_count`; `--prompt-id` + `--dry-run` diff; deterministic + idempotent; seeds entrants from `evolution_variants (synced_to_arena=true AND archived_at IS NULL)`, skips `confidence=0`, draws on `winner='draw' || confidence<0.3`. Run after the queue drains, before `/analysis`. + unit test (fixed comparison list → deterministic ratings).
- [ ] **Add the small difference-of-means CI wrapper (KF5, corrected — NOT a new test):** a ~10-line helper (e.g. `evolution/src/lib/metrics/abComparison.ts`) reusing the existing bootstrap resampler — resample arm A + arm B per iteration, take `meanA−meanB`, read 2.5/97.5 percentiles (CI excluding 0 ⇒ significant), with Holm correction across arms, seeded via `createSeededRng`. Interim zero-code option: compare existing per-arm `bootstrapMeanCI` intervals for overlap. Elo CIs themselves already exist/persist — no new statistical machinery.
- [ ] Add unit tests: (a) seed-script `buildConfig` — arms differ only in `agentType`, budgets sum, config hashes distinct; (b) the new significance helper — known-input p-values, determinism under fixed seed, correction math.

### Phase 2.5: Ops pre-flight gate (must pass before queueing ANY runs) — Decision #6
- [ ] **Provider credit headroom** — confirm OpenRouter/DeepSeek/OpenAI balances cover ~$40 of evolution spend (prevents the 402 **arena-only wipeout**: runs that "complete" with 0 variants / 0 cost — the #1 known corruptor).
- [ ] **`EVOLUTION_MAX_OUTPUT_TOKENS` set on the minicomputer** (D5 fix; clears the 402 at low balances).
- [ ] **Minicomputer on current code** — it does NOT auto-pull; after the Phase 1b/1c merges, `git -C <minicomputer worktree> pull --ff-only origin main && npm ci` and restart the runner, else it rejects the new agent configs / lacks the idea-1 concurrency fix. ([[project_minicomputer_no_auto_pull]])
- [ ] **Daily LLM cap** ($25/day staging) compatible with pace — the $40 experiment spans ≥2 days, or confirm temporary headroom.
- [ ] **Wipeout detector armed** — `detectArenaOnlyWipeouts.ts` ready to run during/after.

### Phase 3: Initial validation batch + adaptive run (Decision E)
- [ ] **Initial validation batch (~$5, ≈1–2 runs/arm):** queue, let the minicomputer execute concurrently. Verify per-arm QA gate (success=true, cost>0, no wipeout, variants persisted), idea-1 ratings correct (recompute dry-run diff small), and arena connectivity sane. Validation only — NOT stopping-eligible. Fix any issue before scaling.
- [ ] **Adaptive batches:** continue +3 runs/arm at a time toward the min-N floor (≥5/arm), recomputing P(best) each batch. Apply the Decision E stopping rule (clear winner / stable co-best tier / $40 cap). Interleave arm order.

### Phase 4: Analysis (after adaptive stopping)
- [ ] When the Decision E stopping rule fires (or $40 cap), drain the queue, then run `scripts/recompute-arena-elo.ts --prompt-id <arena> --dry-run` → review the diff (should be SMALL since idea 1 keeps live ratings correct — a large diff signals an idea-1 bug) → apply, giving reproducible order-canonical ratings.
- [ ] Run `/analysis` per **Decision C + H**: PRIMARY = per-arm **median** point-max-lift over seed + **P(best)/top tier** and **P(within-40-of-best)** (variant-sigma-propagating bootstrap); SECONDARY = one-sided vs-`generate` diff-of-medians (α=0.05, Holm over 8) computed ONCE at final N, % runs improving on seed, mean cross-check, Elo-per-$, variant_count; report with CIs + per-agent QA evidence; honor the ~40 Elo practical threshold (tied top tier when within it).
- [ ] Write the analysis report to `docs/analysis/<name>/` and link from this project's docs (Artifacts section).

## Testing

### Unit Tests
- [ ] **Idea 1 fold (Phase 1c):** the extracted pure fold fn — folding this run's matches onto an arbitrary starting rating is correct; additive `arena_match_count`; CAS predicate built from the read values. (Colocate with `MergeRatingsAgent`.)
- [ ] `evolution/src/lib/schemas.test.ts` (or colocated) — `canBeFirstIteration` now true for both editing modes; `sourceMode='seed'` valid on an editing iteration; existing pool-mode editing config still validates (backward compat).
- [ ] `evolution/src/lib/pipeline/loop/editingDispatch.test.ts` — first-iteration / `sourceMode='seed'` feeds the seed as the single parent; pool-mode dispatch unchanged.
- [ ] `evolution/scripts/experiments/seedElo<...>Experiment_20260626.test.ts` — config-builder produces arms that differ ONLY in `agentType`; budgets/run-counts correct; config hashes distinct per arm (mirror `seedBundleSplitExperiment.test.ts`). NOTE: confirm the test path is inside the jest glob (recent commit dropped an e2e-tree test jest ignored).
- [ ] `evolution/src/lib/metrics/abComparison.test.ts` — permutation/bootstrap difference-of-means helper: correct p-value on known inputs, deterministic under fixed `createSeededRng`, Holm/Bonferroni correction across K arms.

### Integration Tests
- [ ] **CRITICAL — idea 1 concurrency (Phase 1c):** simulate two runs updating the SAME arena entry (e.g. the seed) with overlapping merges against a real DB; assert the final entry rating + `arena_match_count` reflect BOTH runs' matches (no lost update), and that idea-1 live ratings match a fixed-order recompute of the same comparison log within tolerance. This is the test that proves the race is closed.
- [ ] (If a helper to insert the seed row is added) integration test that the seed row is created + participates in ranking on the new prompt.

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
- [ ] `evolution/docs/rating_and_comparison.md` + `evolution/docs/arena.md` — document the concurrency-safe arena merge (idea 1: re-read + re-fold + CAS, additive match_count) and the `recompute-arena-elo.ts` tool; note the prior last-writer-wins race it replaces.
- [ ] `evolution/docs/editing_agents.md` — document that Mode A/B editing agents can now run as a first iteration off the seed (`sourceMode='seed'`), and the dispatch behavior when the pool is just the seed.
- [ ] `evolution/docs/strategies_and_experiments.md` — add this experiment as a worked example of a single-seed agent comparison (if the pattern is reusable).
- [ ] `evolution/docs/arena.md` — clarify the seed-as-fixed-anchor mechanism if Phase 0 surfaces under-documented behavior.
- [ ] `evolution/docs/rating_and_comparison.md` — note the replicate-runs-vs-matches CI guidance if confirmed.
- [ ] `docs/analysis/<name>/` — new analysis report (created by `/analysis` in Phase 4).

## Review & Discussion
<!-- Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration. -->
