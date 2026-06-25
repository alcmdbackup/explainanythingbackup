# Evaluate Implied Rubric Results and Experimentally Validate Research

## Problem Statement

Experimentally validate how implied rubric results are driven by the underlying wholistic prompts.

## Requirements (from GH Issue #1274)

Experimentally validate how implied rubric results are driven by the underlying wholistic prompts.

## High Level Summary

The Implicit Rubric Weights tool (`evolution/docs/implicit_rubric_weights.md`) infers per-criterion rubric weights from pairwise verdicts by fitting non-negative IRLS-regularized logistic regression. Two completed auto-mode sessions on staging — same Judge Lab test set, same 5 criteria, same model (`google/gemini-2.5-flash-lite`), same 30 article pairs, only temperature differs (0 vs 1) — give us a baseline reading on weight consistency across runs **and** the first observation that prompted this project: the inferred weights appear partly driven by which session criteria happen to overlap with the **hardcoded holistic-prompt checklist** in `buildComparisonPrompt` (`clarity and readability, structure and flow, engagement and impact, grammar and style, overall effectiveness`), not purely by what the model "intrinsically cares about" when ranking holistically.

This project's goal is to **disentangle** those two factors with a controlled 4-arm experiment:

- **A. Control** — current generic holistic checklist (= the existing T=0 and T=1 baseline sessions, already collected)
- **B. Stripped** — holistic prompt removes the checklist; the model picks its own bases for comparison
- **C. Aligned** — holistic prompt's checklist = the same 5 session criteria verbatim; semantic overlap is now mechanical
- **D. Inverted (optional)** — holistic prompt's checklist explicitly highlights `depth + structure` (the two currently zeroed-out criteria) and omits clarity; if priming is causal we expect weights to shift toward depth/structure

The fit, audit, comparisons, dimension verdicts, and export-to-rubric pipeline all stay unchanged. The only new degree of freedom is a per-session **holistic-prompt override** (defaulting to the current hardcoded checklist for back-compat).

### Prior research recap — what we know going into this project

**Source data (from `npm run query:staging`, 2026-06-22):**
- 3 sessions on the same `judge_eval_test_sets.id = 9acb42f5-fa9b-4ce8-b053-431fbe01e026`, same `pair_kind='article'`, same 5 criteria (`sentence_variety, tone, depth, structure, clarity` — positions 0..4).
- "New test" (auto, T=0, repeats=1) — 30/30 pairs judged.
- "Fed rubric" (auto, T=1, repeats=1) — 30/30 pairs judged.
- "Test rubric" (human, replication_rate=0.05) — 4/30 pairs judged, 0 dimension verdicts. Insufficient for fit.

**Per-session fits** (run via a one-off script that imported `fitWeights` + `weightCIs` from `@evolution/lib/weightInference` and queried persisted comparisons + dimension verdicts):

| Criterion | T=0 weight (95% CI) | T=1 weight (95% CI) |
|---|---|---|
| sentence_variety | 0.10 (0.00–0.28) | 0.17 (0.04–0.33) |
| **tone** | **0.48** (0.33–0.71) | 0.30 (0.05–0.49) |
| depth | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |
| structure | 0.00 (0.00–0.00) | 0.00 (0.00–0.08) |
| **clarity** | 0.41 (0.11–0.61) | **0.53** (0.34–0.73) |

- Train accuracy 0.85 / 0.86; held-out matches train (no overfit).
- Both fits flag **depth** + **structure** as `disagreesWithOverall` (negative IRLS coefficient pre-clamp → forced to 0).
- L1 distance between weight vectors = 0.37 (of 2.0 max); cosine = 0.94; Spearman rank ρ = 0.9.
- Top-criterion ordering FLIPS between sessions (T=0 → tone wins; T=1 → clarity wins) but the CIs overlap heavily — this is bootstrap noise at N≈20 fit pairs (10 overall-ties dropped per session).

**Cross-session per-pair verdict agreement (on the SAME 30 pairs):**

| Channel | Agreement |
|---|---|
| Overall (holistic) | 29/30 = 97% |
| sentence_variety | 25/30 = 83% |
| tone | 24/30 = 80% |
| depth | 26/30 = 87% |
| structure | 23/30 = 77% |
| clarity | 25/30 = 83% |

Holistic calls are highly reproducible across temperature; per-criterion calls are 77–87%. Per-criterion noise is the dominant driver of the weight wobble.

**Position-bias rate (forward vs reverse winner, persisted in `evolution_weight_inference_comparisons.forward_winner` / `reverse_winner`):** 30% (T=0), 27% (T=1). Model property, not a temperature property.

### The key insight motivating the experiment

`buildComparisonPrompt(textA, textB, 'article')` in `evolution/src/lib/shared/computeRatings.ts:501-523` hardcodes a checklist that the model uses when forming its holistic verdict. Map each item in that checklist to the 5 session criteria:

| Holistic-prompt item | Session criterion mapped to | Strength of channel |
|---|---|---|
| Clarity and readability | **clarity** | named + definition-aligned |
| Structure and flow | structure | name overlap but bundled with "flow" the per-criterion version omits |
| Engagement and impact | **tone** (partial) | voice channel that produces engagement |
| Grammar and style | **tone** + sentence_variety (partial) | "style" = voice/register = tone |
| Overall effectiveness | — | catchall |

That mapping predicts the observed weight ranking almost exactly: clarity has one named + definition-matched channel; tone has two partial channels; sentence_variety has one weak partial channel; structure has a same-name-but-different-scope channel that produces per-criterion / holistic disagreement; depth has **no channel at all** in the holistic prompt.

**So the "implied rubric" the current tool recovers is a measurement of `(holistic-prompt checklist) ∩ (session criteria)`, not of the model's intrinsic preferences.** If we want the latter we need to either drop the priming (arm B) or make the priming match the session criteria (arm C); the comparison between arms A/B/C/D answers the causal question.

### What the experiment lets us conclude

Pre-registered decision rule: **priming is real** if Control vs Stripped flip rate on the holistic verdict (same model, same 2 articles, only checklist changes) **> 15%**, OR weight-vector L1 distance > 0.3 with non-overlapping CIs on the top-2 criteria.

| Outcome | Reading |
|---|---|
| All four arms produce similar weight vectors | Checklist isn't priming much. The model has a stable intrinsic preference; current tool measures it. |
| B ≈ C, both differ from A | **Best outcome.** Model has an intrinsic rubric that surfaces when priming is dropped OR aligned. Production fix: drop the holistic checklist. |
| A ≈ C, B sharply different | Model needs scaffolding to make coherent holistic calls; without it noise wins. Implied rubric remains useful but reflects the priming list. |
| D shifts weights toward depth/structure | Priming is dominant. Current tool is mostly measuring the holistic checklist. Implied rubrics from the current setup are unreliable as model diagnostics. |
| B becomes degenerate (high tie rate, low train accuracy) | Stripped prompt destroys holistic signal. Useful finding in its own right. |

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

### Relevant Docs
- evolution/docs/implicit_rubric_weights.md — the tool we're testing
- evolution/docs/rating_and_comparison.md — where `buildComparisonPrompt` (the holistic prompt the experiment varies) lives
- evolution/docs/data_model.md — weight-inference tables (sessions, criteria junction, articles, comparisons, dimension_verdicts) — Phase 6 `source_kind` + `judge_eval_test_set_id` + `pair_kind`
- evolution/docs/cost_optimization.md — `LLMSpendingGate` evolution-daily-cap path that auto-mode runs charge into; auto-mode cost-cap pattern reused
- evolution/docs/architecture.md — agent invocation pattern, AgentCostScope, V2CostTracker
- evolution/docs/visualization.md — admin UI conventions for the weight-inference detail page
- docs/feature_deep_dives/judge_evaluation.md — Judge Lab analog data-collection pattern; the test set this experiment uses

## Code Files Read

- `evolution/src/lib/weightInference/types.ts` — `Verdict3`, `PairObservation`, `WeightFitResult`, `WeightCI`, `ConsistencyAudit`
- `evolution/src/lib/weightInference/fit.ts` — `fitWeights` IRLS + clamp-and-refit + flags
- `evolution/src/lib/weightInference/ci.ts` — `weightCIs` bootstrap (`DEFAULT_ITERATIONS=300`, `DEFAULT_SEED=1`, finite-CI guard)
- `evolution/src/lib/weightInference/index.ts` — public barrel
- `evolution/src/lib/weightInference/autoJudge.ts` — `judgePairOnce` (2-pass holistic + 2-pass rubric per pair), `foldRepeats`
- `evolution/src/lib/weightInference/autoRun.ts` — `buildEvolutionAutoRun` placeholder rubric (`weight: 1`), resumable chunked batch
- `evolution/src/lib/shared/computeRatings.ts:393-524` — `buildComparisonPrompt` (the prompt the experiment varies) + the article-mode hardcoded checklist
- `evolution/src/lib/shared/computeRatings.ts:526-575` — `buildSandboxComparisonPrompt` (already accepts `customPromptOverride`; pattern to reuse)
- `evolution/src/lib/shared/rubricJudge.ts:284-339` — `buildRubricComparisonPrompt` (the per-criterion prompt, NOT varied by this experiment)
- `evolution/src/services/weightInferenceActions.ts` — `createWeightInferenceSessionAction`, `getWeightInferenceFitAction`, `exportWeightInferenceRubricAction`, `computeSessionFit`, `loadFitData`
- `evolution/src/services/judgeRubricActions.ts` — `getJudgeRubricForEvaluation` (read-time normalization the exported rubric flows into)
- `src/app/admin/evolution/weight-inference/[sessionId]/page.tsx` — UI surface for sessions + Results tab + Export
- `supabase/migrations/20260619000002_evolution_weight_inference.sql` — 5 weight-inference tables + RLS
- `supabase/migrations/20260620000001_evolution_weight_inference_test_set_source.sql` — Phase 6 `source_kind` + `judge_eval_test_set_id` + `pair_kind`
- `scripts/query-db.ts` — read-only SQL access pattern reused by the analysis script

## Prior staging data — sessions in scope

```sql
SELECT id, name, mode, status, source_kind, judge_eval_test_set_id, pair_kind,
       sample_size, judge_model, judge_temperature, auto_repeats, replication_rate, created_at
FROM evolution_weight_inference_sessions WHERE deleted_at IS NULL ORDER BY created_at DESC;
```

| id (truncated) | name | mode | T | repeats | judged | dim_verdicts |
|---|---|---|---|---|---|---|
| 20a09cde…ca8 | "New test" | auto | 0 | 1 | 30/30 | 30 |
| 33b2cdf6…3 | "Fed rubric" | auto | 1 | 1 | 30/30 | 30 |
| aaf65a8a…810 | "Test rubric" | human | n/a | 1 | 4/30 | 0 |

The two completed auto sessions form the Control arm (Arm A) baseline — no new judging needed for that arm; the experiment generates new sessions for arms B / C / D on the same test set with the same model.

## Verification of plumbing assumptions (Round 2 research)

### Finding 1 — `judgePairOnce` is the actual seam, not `buildComparisonPrompt`

The original plan said "the 4th arg already exists in `buildComparisonPrompt`; only the call site changes." That's correct at the leaf, but the actual seam to extend is **one level higher**: `judgePairOnce(judge, textA, textB, rubric, costAcc, mode)` in `evolution/src/lib/weightInference/autoJudge.ts:69` does **not currently accept** a holistic-override parameter — it calls `buildComparisonPrompt(textA, textB, mode)` inline with no override. So Phase 1 must:

1. Add a 7th param `holisticOverride?: string` to `judgePairOnce`.
2. Forward it inside `buildPrompts: () => ({ forward: buildComparisonPrompt(textA, textB, mode, holisticOverride), reverse: buildComparisonPrompt(textB, textA, mode, holisticOverride) })`.
3. Plumb from `runAutoChunk` (autoRun.ts:158) → `judgeOne(c)` → `judgePairOnce(...)`.
4. Read `session.holistic_prompt_override` once at the top of `runAutoChunk` (after the SessionRow load on line 56-67) and capture it into the closure.

Total surface: ~6 lines across 2 files. **Not the 4th arg of `buildComparisonPrompt`** (that's the destination, not the entry point).

### Finding 2 — Per-criterion rubric prompt has no confound for article-mode

`buildRubricComparisonPrompt` (`evolution/src/lib/shared/rubricJudge.ts:284`) takes `priorPicks`, `nextContext`, `originalParagraph`, `targetStyleProse` — all of these are **paragraph-mode only** (gated on `isParagraphMode`). For our experiment (`pair_kind='article'`), they all render empty. The article-mode rubric prompt is **byte-identical to the baseline sessions' rubric prompt**. So the per-criterion side of the fit is invariant across arms — the experiment cleanly isolates the holistic-prompt manipulation. No new confound.

### Finding 3 — Arm C "Aligned" should use criterion descriptions, not just names

The per-criterion rubric prompt renders each dimension as `${i+1}. ${name}: ${description}` plus the Excellent/Adequate/Weak tier anchors from `evaluation_guidance`. If Arm C's "Aligned" override only lists criterion NAMES (e.g. `- depth`), the holistic prompt is semantically NARROWER than the per-criterion prompt — the model sees rich definitions in the rubric pass but bare names in the holistic pass. To make "alignment" truly mechanical, **Arm C's override should include the criterion descriptions** (e.g. `- depth: Quality of detail, technical accuracy, and explanation of mechanisms`). Tier anchors are probably overkill for the holistic prompt; descriptions are the right granularity.

**Action:** revise Arm C's prompt string in Phase 2 to include descriptions, keep tier anchors only in the per-criterion prompt.

### Finding 4 — Cost-cap math approximation needs noting (but no fix)

`autoCost.ts:103` uses `HOLISTIC_PROMPT_OVERHEAD_CHARS = 700` as a fixed constant for cost projection. Each arm's override has a different length:

| Arm | Override chars (estimated) | Δ vs constant |
|---|---|---|
| A (Control) | ~700 (the hardcoded checklist) | baseline |
| B (Stripped) | ~150 | under-projects by ~5–10% per holistic call |
| C (Aligned, with descriptions) | ~700 | matches |
| D (Inverted) | ~600 | matches within rounding |

This means Arm B's actual cost will be ~10% LOWER than the projection — the cap is conservative, so no functional issue. Worth a one-line code comment but not a planning blocker.

### Finding 5 — Session-create UI add is small + already has the right shape

`src/app/admin/evolution/weight-inference/page.tsx` already uses well-structured `useState` per field and conditionally renders the `auto`-mode block (line 277-294). Adding a "Custom holistic prompt" textarea is one `useState` + a `<textarea>` inside the auto block + one new line in the `create()` call to forward it. ~25 LOC. Collapsing it behind an "Advanced" disclosure is straightforward.

### Finding 6 — No existing cross-session comparison UI; standalone script is the right call

Confirmed (via Explore agent) there is no `/admin/evolution/*/compare` route in the codebase. Closest patterns:
- **Prompt Editor** (`/admin/evolution/prompt-editor`) — multi-config side-by-side on ONE input. Architecturally analogous but built for prompt iteration, not session comparison.
- **Judge Lab leaderboard** (`/admin/evolution/judge-lab`) — shows all runs for one test set in a single table. Could be extended with multi-select, but doing so is project-scope creep.

**Decision:** Keep the analysis as a standalone script (Phase 4 in the plan). If cross-session comparison becomes a recurring need post-experiment, a `/admin/evolution/weight-inference/compare?sessions=A,B,C,D` follow-up project is the natural place — but not in this project's scope.

### Finding 7 — Default chunking handles all 30 pairs in one shot

`WEIGHT_INFERENCE_AUTO_CHUNK_PAIRS=40` (`autoCost.ts:10`) means 30 pairs × 3 repeats fits in a single chunk per arm. The resumable-batch loop in the UI will fire once and return `done: true`. No chunking concerns.

### Finding 8 — Pre-flight cost cap is `WEIGHT_INFERENCE_AUTO_MAX_USD=5` per session

3 new arms × ~$0.04 each = ~$0.12 total. Well within the $5 per-session cap and the $25 evolution daily cap. No env-var changes needed for the experiment.

## Updated open questions (post Round-2 research)

1. **~~Plumbing depth~~ — RESOLVED.** Schema-touching path is correct. Phase 1 of the plan is accurate but should call out `judgePairOnce` (not `buildComparisonPrompt`) as the seam to extend.
2. **~~Sample size~~ — REVISED.** Sticking with N=30 per arm because:
   - The test set is frozen at 30 pairs.
   - `auto_repeats=3` gives cross-repeat self-consistency that the baseline (`repeats=1`) lacked.
   - Even at N=30 / 20-pair-fit, weight L1 distance between arms is the primary signal — not absolute CI width on any single weight. CIs widen but the cross-arm DELTA is what matters.
   - If we wanted N=60, we'd need to expand the test set itself, which is a separate (Judge Lab) project.
3. **Arm C wording.** Should the "Aligned" override include the FULL criterion description per Finding 3, or just the name? Recommendation: full description (mirrors the rubric prompt's `${name}: ${description}` line; no tier anchors to keep the holistic prompt short).
4. **UI exposure.** Should the "Custom holistic prompt" textarea be visible in the create-session form for all operators, or gated behind a debug/advanced flag? Recommendation: visible but inside an `<details>` "Advanced" section so it doesn't add clutter for the common case.
5. **Persistence of arm metadata.** Should we tag sessions with `experiment_arm TEXT` so the analysis script can group by arm without name-matching on `[ARM-X]`? Recommendation: NO — the session name is already searchable and committing schema for one-off experiment metadata is overkill. The standalone script can split by name regex.
3. **Model factor.** Single model (`google/gemini-2.5-flash-lite`) keeps the comparison clean but doesn't tell us whether priming is model-specific. Optional 5th arm runs Arm A's checklist with a smarter model (`google/gemini-2.5-pro` or `claude-haiku-4-5`) to see whether position bias drops and the rubric stabilizes — but this should be optional, not the primary deliverable.
4. **Cost-cap policy.** Auto-mode already has a pre-flight cost-cap gate (`autoCost.plannedCalls = pairs × repeats × CALLS_PER_PAIR`). Each new arm bumps the projected spend by ~$0.30 — well within `evolution_daily_cap_usd = $25`. No new caps needed.

These resolve during the planning phase, not at execution time.
