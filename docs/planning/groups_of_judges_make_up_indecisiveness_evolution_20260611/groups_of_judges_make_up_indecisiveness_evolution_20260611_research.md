# Groups Of Judges Make Up Indecisiveness Research

## Problem Statement
Help me figure out how to combine together multiple judges in case a single judge is indecisive on a given paragraph or article.

## Requirements (from GH Issue #NNN)
- Look at judge lab results and come up with proposals that can be experimentally tested/validated.
- Utilize judge lab infrastructure if possible.
- Want things that are cheap as possible but still help to get decisive outcomes from weaker judges put together.
- Also suggest other useful judge optimization tactics that can help improve accuracy & decisiveness if any.

## High Level Summary

The evolution arena ranks text variants via a **single LLM judge per comparison**, run as a
**2-pass A/B reversal** (forward A-then-B, reverse B-then-A) folded into a confidence score
(`aggregateWinners`): both passes agree -> 1.0; one TIE -> 0.7; passes disagree (A vs B) ->
**0.5 forced TIE**; one parse-null -> 0.3; both null -> 0.0. A match is **decisive** when
`confidence > 0.6`, a **draw** when `confidence < 0.3`. **There is no ensemble / voting /
escalation / per-judge cost tracking today.** **Judge Lab already exists** as a read-only
batch-measurement harness (freeze a test set -> sweep model x temp x reasoning x rubric ->
per-kind decisive-rate leaderboard) and **stores enough per-call data to simulate ensembles
entirely offline** (`forward_winner`, `reverse_winner`, `winner`, `confidence`, `repeat_index`,
`pair_label`, `pair_kind`, `expected_winner` [large-gap only], `gap_kind`, `cost_usd`).

I mined the existing Judge Lab data on **dev** (123 runs, 12,580 calls, 11 test sets) and ran
**offline ensemble simulations on real recorded verdicts**. The headline result: **two
fundamentally different failure regimes**, and the cheapest fix differs between them.

### Finding 1 - Indecisiveness is severe and worst on paragraphs
Per-model decisive rate (`confidence>0.6`), across all recorded calls:

| Model | Article decisive | Paragraph decisive | cost/decisive (para) |
|---|---|---|---|
| gpt-4.1 | 0.90 | - | - |
| deepseek-v4-pro | 0.87 | **0.32** | $0.00062 |
| gpt-5.2 | 0.83 | - | - |
| gpt-4.1-mini | 0.65 | - | - |
| deepseek-chat | 0.63 | 0.40 | $0.00006 |
| gpt-4o-mini | 0.63 | 0.35 | $0.00048 |
| deepseek-v4-flash | 0.29 | 0.52 | $0.00009 |
| qwen-2.5-7b-instruct | 0.49 | 0.46 | $0.00011 |
| gpt-4.1-nano | 0.04 | 0.53 | $0.00021 |
| google/gemini-2.5-flash | - | **0.21** | $0.00298 |

Paragraph confidence is **bimodal**: 51% of calls land at exactly 0.5 (passes disagree),
48% at 1.0, ~1% at 0.7, ~0.1% at 0.3. **Almost no parse failures** - paragraph indecisiveness
is ~entirely cross-pass position-bias disagreement.

### Finding 2 - On paragraphs, STRONGER models are LESS decisive (and 30x the cost)
gemini-2.5-flash 0.21 and deepseek-v4-pro 0.32 are *worse* than cheap gpt-4.1-nano 0.53 /
deepseek-v4-flash 0.52. **=> "just escalate paragraphs to a stronger judge" is contradicted by
the data.** On articles the opposite holds (stronger genuinely helps).

### Finding 3 - Paragraph position bias is DETERMINISTIC => repeats/self-consistency are useless
On a 40-repeat deepseek-v4-flash paragraph run, every *indecisive* pair splits **exactly
40/40** (forward always picks one slot, reverse the other, all 40 repeats). Pooling passes or
resampling the same model cannot break a deterministic flip (pooled majority frac = 0.500).
**=> same-model self-consistency / "more repeats" is dead-on-arrival for paragraphs.** (Decisive
pairs are the mirror image: 0/80 vs 80/0 - perfect agreement.)

### Finding 4 - Cross-MODEL diversity DOES help paragraphs (bias direction differs by model)
On the "New federal" paragraph set (50 pairs, 4 cheap models, temp 0), counting how many
models are decisive per pair:

| # models decisive | pairs |
|---|---|
| 0 (nobody) | 6 (12%) |
| 1 | 6 (12%) |
| 2 | 19 (38%) |
| 3 | 11 (22%) |
| 4 (all) | 8 (16%) |

Only **12% are unanimously indecisive**; **76% have >=2 models decisive**. Among the 38 pairs
with >=2 decisive models, **31 (62% of all pairs) AGREE on the winner**, only 7 conflict.
**=> a heterogeneous cheap panel with a ">=2 agreeing decisive judges" rule could lift
paragraph decisiveness from ~0.5 to ~0.62 (conservative) using only cheap models** - because
position bias is deterministic *within* a model but *differs across* models. Diversity, not
repetition.

### Finding 5 - On articles, a 3-cheap panel beats a single strong judge on BOTH axes
Offline sim on "Model baseline 3 - articles" (30 pairs, temp 0, majority among decisive judges):

| Panel | decisive rate | accuracy (large-gap) |
|---|---|---|
| best single cheap | ~0.63 | - |
| gpt-4.1-nano alone | 0.03 | - |
| **3 cheap** (4o-mini, v4-flash, deepseek-chat) | **0.83** | **0.857** |
| 5 cheap | 0.83 | 0.857 |
| 7 mixed (+ strong) | 0.87 | **0.75 (down)** |
| single gpt-4.1 (reference) | 0.87 | 0.778 |

**Diminishing returns by K=3.** The **3-cheap panel is *more accurate* (0.857) than a single
gpt-4.1 (0.778)** while approaching its decisiveness - at a fraction of the cost. Adding
stronger models (7mixed) raised decisiveness but *hurt* accuracy (conflicting/correlated
errors). **=> diversity of cheap judges > adding an expensive one.**

### Finding 6 - Most of this validates OFFLINE for ~$0
Because Judge Lab persists per-pass verdicts + ground truth, ensemble/escalation/confidence-
weighting/panel-size rules can all be ranked by **re-aggregating existing recorded calls**
grouped on `(pair_label, repeat_index)` - no new LLM spend. Only prompt-change tactics
(force-a-winner rubric, structured judging) need one fresh cheap sweep. The first deliverable
can therefore be a **pure offline re-aggregation analysis tool** with zero schema change.

## Approaches Evaluated (subagent brainstorm + my data)

Ranked by **decisiveness-per-dollar**, split by regime (a single judge = 2 LLM calls):

**Paragraphs** (bottleneck = deterministic within-model position bias):
1. **Heterogeneous cheap panel, ">=2 agreeing decisive judges"** - the only ensemble the data
   shows working on paragraphs (Finding 4). Cost 2K calls; odd K=3 recommended.
2. **Force-a-winner / TIE-discouraging rubric** (non-ensemble) - drains the 0.5 plateau at the
   source; needs one cheap sweep; *guardrail*: must not drop large-gap accuracy.
3. **Tie-break-only second *different cheap* model** - pay the extra judge only on 0.5 pairs.
   - **Anti-recommended for paragraphs:** cheap->strong escalation (Finding 2), same-model
   self-consistency / more repeats (Finding 3), pooled-pass voting (Finding 3).

**Articles** (stronger genuinely helps; cheap panel proven):
1. **Cheap->strong escalation cascade** - accept cheap decisive verdict; escalate only the
   indecisive remainder to a strong judge. Est. ~0.96 blended decisive at ~2.7 calls avg -
   best $/decisive. Fully offline-validatable.
2. **3-cheap heterogeneous panel, majority among decisive** - proven 0.83 decisive @ 0.857
   accuracy (more accurate than a single gpt-4.1), 6 calls. Already validated offline.
3. **Confidence-weighted aggregation** - small edge over plain majority; free to test offline;
   risk: confidence is a 2-pass-table artifact, can amplify a confidently-wrong cheap judge.

**Non-ensemble levers worth A/B-testing in the same harness:** force-a-winner rubric;
structured/rubric judging (already shipped - measure as decisiveness lever); reasoning-effort
& temperature (skeptic: more reasoning may *reduce* paragraph decisiveness per Finding 2).

### Honest caveats / threats to validity
- **Ground truth exists only on large-gap pairs.** "Decisiveness" gains on close pairs may be
  *manufactured* (forcing a winner on a genuine tie). Every decisive-rate win must be reported
  next to the large-gap accuracy guardrail - never alone.
- Small samples (n=30 articles, n=50 paragraphs). Treat magnitudes as directional.
- Cheap models share backbones => correlated errors => real accuracy gain < i.i.d. theory.
- `decisive != correct`. The goal is decisiveness *without* accuracy loss, not at its expense.

## Judge Lab Extension Points (from code survey)
The harness is the right substrate. Lowest-friction seams (`evolution/src/lib/judgeEval/`):
1. **Offline re-aggregation analysis** (no schema change) - group recorded `judge_eval_calls`
   across single-judge runs on a shared test set; apply candidate rules; emit a leaderboard.
   *First deliverable; validates Findings 4-5 at scale for $0.*
2. **Ensemble `JudgeFn` factory** - swap `createCallLLMJudge` for a `createEnsembleJudgeFn`
   (parallel K judges + aggregation) at the `executeSweep` injection point. No schema change.
3. **Judge-set as a sweep dimension** - extend the model loop to enumerate ordered judge-sets +
   an aggregation rule (live confirmation of the offline result).
4. **Optional `judge_eval_sub_verdicts` table** - persist per-judge sub-verdicts if/when live
   ensembles ship (Phase 3+); per-call `winner`/`confidence` stays the ensemble aggregate;
   leaderboard VIEW unaffected. Add `judge_model` to calls to drop one JOIN.

Production wiring (Phase 4+) mirrors the **rubric overlay** precedent: thread an optional
ensemble config through `compareWithBiasMitigation` (byte-identical default path when unset),
extend the order-invariant comparison cache key with the judge-set, behind a kill-switch env.

## Open Questions
- Does the paragraph ">=2 agreeing" lift (62%) hold across topics beyond "New federal", and what
  is its accuracy on the large-gap subset?
- Optimal cheap panel composition for paragraphs (which 3 models have the most *complementary*
  position biases)? The 7 conflict pairs are the genuinely-hard / true-tie residue.
- For articles, exact escalation economics (trigger threshold, strong-model choice) that
  maximize blended decisive-rate per dollar vs the 3-cheap panel.
- Standard aggregation rule: "majority among decisive judges" vs confidence-weighted vs
  margin>=2 - measured on the full recorded corpus.
- Should genuine TIEs be *preserved* (close pairs) rather than forced? Interaction with the
  ranking loop's `updateDraw` path.

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

### Relevant Docs (judge/evolution; full read + surveyed)
- docs/feature_deep_dives/judge_evaluation.md - Judge Lab architecture, test sets, sweeps, metrics (full read)
- evolution/docs/rating_and_comparison.md - judge contract, 2-pass reversal, confidence table, draw logic (full read)
- evolution/docs/criteria_agents.md - criteria eval + mirror-approver bias-mitigation pattern (full read)
- evolution/docs/arena.md, cost_optimization.md, agents/overview.md, metrics.md, evolution_metrics.md, data_model.md, architecture.md - surveyed via Explore
- docs/docs_overall/llm_provider_limits.md - cheap model availability/limits - surveyed

## Code Files Read / Mapped
- evolution/src/lib/judgeEval/ - schemas.ts, runJudgeEval.ts (JudgeFn injection + createCallLLMJudge), executeSweep.ts (model x temp x reasoning grid loop), metrics.ts, settings.ts (settings_key composition), persist.ts (replaceCalls), testSet.ts, cost.ts, seed.ts
- evolution/src/services/judgeEvalActions.ts - cap-gated server actions
- evolution/scripts/judge-eval.ts - CLI (seed / create-test-set / sweep)
- evolution/src/lib/shared/computeRatings.ts - buildComparisonPrompt, parseWinner, aggregateWinners, compareWithBiasMitigation (rubric overlay precedent)
- evolution/src/lib/shared/reversalComparison.ts - generic run2PassReversal<TParsed,TResult>
- evolution/src/lib/comparison.ts - ComparisonResult, draw thresholds
- evolution/src/lib/shared/rating.ts - Rating, updateRating/updateDraw, DECISIVE_CONFIDENCE_THRESHOLD
- supabase/migrations/20260606000001_judge_eval_tables.sql, 20260610000001_judge_eval_calls_audit_and_snapshot.sql - schema + leaderboard VIEW

## Data Queries Run (dev / staging, read-only)
- Per-model decisive rate + cost-per-decisive x pair_kind (all 123 runs).
- Paragraph confidence-value distribution (bimodal 0.5/1.0 confirmed).
- Test-set x model coverage (offline-ensemble candidate sets identified).
- Offline ensemble sim on "Model baseline 3 - articles" (3/5/7 panels vs single gpt-4.1).
- Pooled-pass test on 40-repeat paragraph run (deterministic 40/40 position bias confirmed).
- Cross-model complementarity + agreement on "New federal" paragraphs (62% >=2-agree).
