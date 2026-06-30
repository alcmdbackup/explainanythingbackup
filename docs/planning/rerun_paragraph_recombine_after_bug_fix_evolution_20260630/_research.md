# rerun_paragraph_recombine_after_bug_fix Research

## Problem Statement

PR #1323 (merged 2026-06-30 13:26 UTC) fixed a critical data-leakage bug in
`ParagraphRecombineWithCoherencePassAgent`: `processSlot` was passing
`` `${slot.paragraphIndex}` `` (a bare digit `"0"`, `"1"`, …) to
`upsertSlotTopic` instead of the parent variant's UUID. `formatSlotTopicName`
then produced GLOBAL topic names like `[para] 0.P1`, `[para] 1.P2`, … that
every paragraph_recombine_with_coherence_pass run across the project shared.
Per the PR body, run `9c3fa513-9ab4-4bbc-be20-c38e561cb505` ranked rewrites
against contaminated foreign winners (e.g. `[para] 0.P1` had 4 in-run variants
vs 401 from OTHER admin runs).

**Implication**: all prior staging A/Bs on `paragraph_recombine_with_coherence_pass`
have polluted Elo signals — the slot-level winners they picked were biased
toward the historical population mean, not toward the in-run parent. The
project's task is to **re-validate the recombine system** now that the bug is
fixed.

The sibling agent `paragraph_recombine` (sequential, with coordinator) was NOT
affected — its `processSlot` always passed `parentVariantId` correctly (per
PR #1323 body's "Comparison" section pointing to `ParagraphRecombineAgent.ts:692`).

## Requirements (from user request, 2026-06-30)

> Summary: "We recently fixed a bug in PR 1323 where paragraph recombine was
> pulling from incorrect paragraph pools. Please re-test the different things."
>
> Description: "Please use recent strategies run on Federal Reserve 2 to test
> the effectiveness of paragraph recombine on top 3 variants from run. Test
> out coherence pass vs. not, and having a stronger coordinator model, and
> having a stronger coherence pass model. Use experiment analysis skill to
> analyze, it should be present on most recent remote main"

Resolved via AskUserQuestion (2026-06-30): **both** agents in scope (4-arm mix).

## High Level Summary

**Result**: None of the four pre-registered Mann-Whitney comparisons reject
the null at α=0.05 (exact p = 0.6454 / 0.7209 / 0.9591 / 1.0000 for A-vs-B
/ A-vs-C / A-vs-D / B-vs-D). The much-larger median deltas in Table A
(−31 to −36 Elo) overstate the true central shift; the more-defensible
Hodges-Lehmann shift estimator places every cross-arm shift in the [−4, +0.1]
Elo range with 95% bootstrap CIs spanning ~40 Elo in each direction.
Rank-biserial r ≤ 0.156 across all comparisons (small effect). **No causal
language is justified by the formal tests**: every "Arm X is better/worse
than Arm Y" reading is a *non-rejection of the null*, not evidence of effect.
The experiment is underpowered (n=8 → ~60% power, rule-of-thumb) for
definitive non-effect declarations.

**Observational findings** (descriptions of what happened, not causal claims):
the experiment's single highest variant (Elo 1376.53) came from Arm D's
`paragraph_recombine_with_coherence_pass` agent — NOT from a generate-phase
tactic. In Arms A, B, C the per-arm top variant came from the iter-0
`grounding_enhance` tactic. Arms C and D show bimodal recombine output (one
outlier-high + many near-seed) vs Arms A's tighter cluster.

The post-#1323 Coherence-Pass-Baseline → Coherence-Pass-OFF comparison
(Arms A vs B) is the most-important pairwise reading of the experiment.
Hodges-Lehmann shift A-vs-B = −3.41 Elo (95% CI [−39.34, +35.66]). At n=8
this CI cannot distinguish "CP enabled and CP disabled are essentially the
same on FR2" from "CP has a meaningful effect that this experiment didn't
detect". The prior bug-affected CoherencePassEnabled A/B's conclusion is
neither confirmed nor refuted by this re-validation; a higher-N follow-up
is the recommended next step.

## Key Findings

1. **None of the four pre-registered Mann-Whitney comparisons reject the
   null at α=0.05.** Exact p: A-vs-B 0.6454, A-vs-C 0.7209, A-vs-D 0.9591,
   B-vs-D 1.0000. Zero of three pre-registered hypothesized lifts supported.
2. **All point estimates of central shift place Arm A at or above the
   other arms, but the effect sizes are SMALL and the bootstrap CIs span
   both directions.** Hodges-Lehmann shifts: A-vs-B −3.41 (95% CI
   [−39.34, +35.66]), A-vs-C −2.02 [−40.44, +7.44], A-vs-D −2.57 [−43.65,
   +48.01], B-vs-D +0.08 [−41.12, +53.50]. Rank-biserial |r| ≤ 0.156. The
   much-larger median deltas in Table A overstate the central shift.
3. **The experiment's single highest variant (Elo 1376.53) came from Arm D's
   `paragraph_recombine_with_coherence_pass` agent — NOT from a seed-phase
   tactic.** Concrete: variant `c67580a0-…` (run `92a0a822-…`). In Arms A, B,
   C the per-arm top variant came from the iter-0 `grounding_enhance` tactic
   instead. "Seed-phase ≥ recombine" pattern holds in 3 of 4 arms, reverses
   in Arm D.
4. **Arm D shows bimodal/high-variance recombine output (observational
   only).** Top 5 recombine variants in Arm D: 1376.53 / 1248.62 / 1246.61
   / 1244.66 / 1236.87 — a 128 Elo gap between #1 and #2. Arms A/B show
   tighter clusters. Not a causal claim — could reflect sampling noise.
5. **Arm C shows the same bimodal recombine pattern at lower amplitude**
   (observational): top recombine 1284.11, then 1247.80, then ≤1247.65.
   Arm C's higher judge-decisive rate (31.8% vs ~18%) did not translate
   to higher article-level Elo, but the sample is too small to declare
   either direction.
6. **Variant-throughput asymmetry confounds top_elo** (observational): Arm B
   produced 2.4× Arm C's article variants (358 vs 150). The max-of-sample
   metric is mechanically larger for larger samples; Mann-Whitney on top_elo
   does NOT correct for this. Absent a properly throughput-corrected metric,
   B-vs-C top-Elo gaps cannot be read causally.

EAR location: `docs/planning/rerun_paragraph_recombine_after_bug_fix_evolution_20260630/EAR.md`.

## Promoted Analyses

- docs/analysis/rerun-paragraph-recombine-after-bug-fix-20260630/

## Documents Read

- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/project_workflow.md`
- `evolution/docs/paragraph_recombine.md`
- `evolution/docs/paragraph_recombine_with_coherence_pass.md`
- `evolution/docs/strategies_and_experiments.md`
- `.claude/skills/manual_run_experiment/SKILL.md`
- `.claude/commands/run_experiment_analysis.md` (origin/main version)

## Code Files Read

- `evolution/scripts/experiments/seedCoherencePassEnabledExperiment_20260627.ts`
  — closest existing template (2-arm CP-On vs CP-Off on federal_reserve_2)
- `evolution/scripts/experiments/README.md` — experiment-script index
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts`
  (lines 268–280) — `coordinatorModel` reads from `(ctx.config as { coordinatorModel?: string })`
- `src/config/modelRegistry.ts` — picked "stronger" model candidates

## Bug summary (PR #1323)

**File**: `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.ts`

**Before**:
```ts
upsertSlotTopic(ctx.db, 'paragraph', `${slot.paragraphIndex}`, ...)
// → topic names like "[para] 0.P1", "[para] 1.P2" — GLOBAL across all runs
```

**After**:
```ts
upsertSlotTopic(ctx.db, 'paragraph', parentVariantId, ...)
// → topic names like "[para] 395f1409.P1" — per-parent, isolated per submission
```

`ParagraphRecombineAgent.ts:692` (the sequential sibling) was always correct.

## Baseline strategies on federal_reserve_2 (queried 2026-06-30)

Three most-recent COMPLETED strategies on prompt `a546b7e9-…`:

| strategy_id | name | agent_type | coherencePassEnabled | mode |
|---|---|---|---|---|
| `fe314a1e-4894-4765-9162-8bf51c827dbc` | Strategy 7a494f (lite, 2it) | paragraph_recombine_with_coherence_pass | TRUE (default) | mode_b (default) |
| `0cd27136-b14a-408a-b7f6-635983c66bb6` | Strategy 66f213 (lite, 2it) | paragraph_recombine_with_coherence_pass | FALSE | n/a |
| `5a9b7f72-38fe-4e3d-a2cc-696dba3dd506` | Strategy 4fe185 (lite, 2it) | paragraph_recombine_with_coherence_pass | TRUE | mode_a (pinned) |

All three use `google/gemini-2.5-flash-lite` for both generationModel + judgeModel.
All three queue 2 iterations: a `generate` seed iteration (budgetPercent 30) then
a `paragraph_recombine_with_coherence_pass` pool iteration with
`qualityCutoff: {topN, 3}`, `budgetPercent 70`, `maxDispatches 5`,
`rewritesPerParagraph 5`, `maxComparisonsPerParagraph 8`, `coherencePassMaxCycles 2`,
`coherencePassLengthCapRatio 1.10`.

Total budget per run = $0.10. Bug-affected window for `fe314a1e` + `5a9b7f72`
runs was the entire history pre-#1323-merge (today 13:26 UTC).

## Knob inventory (per evolution docs)

### `paragraph_recombine` (sequential, the one with a coordinator):
- `coordinatorModel?: string` — Phase A planning LLM (default = `generationModel`)
- `paragraphRewriteModel?: string` — Phase B per-paragraph rewrite model
  (default = `generationModel`)
- `generationModel`, `judgeModel` — base

### `paragraph_recombine_with_coherence_pass` (Phase A/B/C):
- `coherencePassEnabled?: boolean` (default `true`)
- `coherencePassProposerModel?: string` (default = `generationModel`)
- `coherencePassApproverModel?: string` (default = `judgeModel`)
- `coherencePassEditingMode?: 'mode_a' | 'mode_b'` (default `'mode_b'`)
- `coherencePassLengthCapRatio?: number` (default `1.10`)
- `coherencePassMaxCycles?: number` (default `2`)

## "Stronger" model picks

Default across all baselines: `google/gemini-2.5-flash-lite`
(input $0.10/1M, output $0.40/1M, no thinking, supportsJsonSchema=true).

**"Stronger" choice (uniform across roles)**: `gpt-5-mini`
(input $0.25/1M, output $2.00/1M, no thinking, schema-enforced JSON via
direct OpenAI provider). 2.5× input + 5× output pricing of the baseline.

Picked because `evolution/src/lib/schemas.ts:1107-1113` explicitly documents
the coordinator-model upgrade path: *"flash-lite (default) → gpt-5-mini
(safe lift) → claude-sonnet-4 (premium)"*. The "safe lift" recommendation
came out of `investigate_sequential_paragraph_recombine_performance_20260615`'s
Phase 4d staging analysis. Using `gpt-5-mini` for Arm C (sequential
coordinator) means we're testing the exact upgrade the agent doc recommends.

For Arm D, using the SAME `gpt-5-mini` for both `coherencePassProposerModel`
and `coherencePassApproverModel` keeps the cross-arm comparison clean: each
"stronger" knob changes EXACTLY ONE role from gemini-flash-lite to gpt-5-mini.

Per-run budget cap ($0.10 totalBudgetUsd + `perInvocationCapUsd: 0.10` with
0.85× pre-coherence-pass gate at $0.085) will arrest runaway spend even if
gpt-5-mini emits long outputs.

(Rejected: `gpt-4.1-mini` — doc explicitly recommends gpt-5-mini for this
role over gpt-4.1; `gpt-4.1` proper — too expensive for 4-arm coverage;
`claude-sonnet-4` — `maxTemperature: 1.0` limits the per-paragraph rewrite
ladder used in Phase A.)

## Open questions resolved at research time

1. **Which agent to test?** → Both. (User confirmed via AskUserQuestion.)
2. **What does "coordinator" mean?** → The Phase A coordinator in
   `paragraph_recombine` (the sequential sibling), governed by the
   `coordinatorModel` field on `StrategyConfig`.
3. **What does "coherence pass model" mean?** → Both the
   `coherencePassProposerModel` (Mode B article rewriter) and
   `coherencePassApproverModel` (judge) in `paragraph_recombine_with_coherence_pass`.
4. **Why federal_reserve_2?** → It's the staging-only prompt used in all
   3 recent coherence-pass A/Bs (CoherencePassPerf 2026-06-24,
   CoherencePassMode 2026-06-26, CoherencePassEnabled 2026-06-27).
   Re-using it makes the new bug-fix-validated runs directly comparable
   to the pre-fix historical Elos.
5. **Top 3 from run?** → `qualityCutoff: {mode: 'topN', value: 3}` on the
   recombine iteration's pool. Exactly the same shape as the existing
   `Strategy 7a494f` baseline.

## Pre-existing data we can lean on (with caveats)

`CoherencePassEnabled A/B (federal_reserve_2)` experiment (whatever its id was)
ran 8 runs/arm CP-On vs CP-Off ~3 days ago (2026-06-27). That data is
**bug-affected** for the CP-On arm (which actually engaged the contaminated
slot topics during Phase A's per-slot ranking) — Arm A of the new experiment
should land different absolute Elos. CP-Off arm's data should be roughly
re-confirmable since Phase A still ran on isolated rewrites; the only thing
that changes is whether per-slot rankings drew from contaminated foreign topics.

> **Adversarial note**: Arm B (paragraph_recombine_with_coherence_pass with
> coherencePassEnabled=false) STILL goes through Phase A per-slot ranking, so
> Arm B was also bug-affected pre-#1323. Both Arms A and B are getting
> re-validated, not just Arm A.
