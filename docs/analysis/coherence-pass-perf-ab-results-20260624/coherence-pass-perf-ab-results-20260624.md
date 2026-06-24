# CoherencePassPerf A/B Results — 2026-06-24

## Header
- **Analysis name:** coherence-pass-perf-ab-results-20260624
- **Project:** docs/planning/investigate_paragraph_recombine_coherence_pass_performance_20260623/
- **Branch:** chore/seed_coherence_pass_ab_20260624
- **Date:** 2026-06-24
- **Source research doc:** `docs/planning/investigate_paragraph_recombine_coherence_pass_performance_20260623/investigate_paragraph_recombine_coherence_pass_performance_20260623_research.md`

## Methodology

The post-merge staging A/B validates whether the shipped `paragraph_recombine_with_coherence_pass` rework — voice-restoration prompt + Jaccard removal + multi-cycle loop + length cap raised 1.02→1.10 — actually fixes the negative `eloAttrDelta` reported by the 4 baseline runs documented in `_research.md`.

**Seed script**: [`evolution/scripts/experiments/seedCoherencePassPerformanceExperiment_20260624.ts`](../../../evolution/scripts/experiments/seedCoherencePassPerformanceExperiment_20260624.ts).

**Invocation**:
```bash
npx tsx evolution/scripts/experiments/seedCoherencePassPerformanceExperiment_20260624.ts \
  --target staging \
  --runs-per-arm 8 \
  --apply
```

The script clones the production `seedBundleSplitExperiment.ts` pattern (`upsertStrategy + createExperiment + addRunToExperiment`). LLM calls route through `createEvolutionLLMClient → recordSpend` so per-run cost lands in `evolution_metrics.cost` and per-call cost lands in `llmCallTracking`. Cost tracking is production-grade.

**Arms**:
| Arm | strategy_id | `coherencePassLengthCapRatio` | `coherencePassMaxCycles` |
|---|---|---|---|
| Control (CP-Ctrl) | `b722babf-873d-49f0-81a5-62109d172801` | 1.02 (legacy) | 1 (legacy) |
| Treatment (CP-Trt) | `fe314a1e-4894-4765-9162-8bf51c827dbc` | 1.10 (new default) | 2 (new default) |

Both arms pinned the fields explicitly so config_hash is distinct AND the comparison is robust against the `EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` kill-switch state.

**Other shared config** (matches the failing baseline strategy `244e9767-…`): generation+judge model `google/gemini-2.5-flash-lite`, `budgetUsd=0.10/run`, `maxComparisonsPerVariant=3`, prompt `federal_reserve_2` (`a546b7e9-…`), iteration plan `[generate seed 30%, paragraph_recombine_with_coherence_pass pool 70% with maxDispatches=5, qualityCutoff topN=3, rewritesPerParagraph=5, maxComparisonsPerParagraph=8, maxParagraphsPerInvocation=12]`.

**Experiment row**: `evolution_experiments.id = a0bcd825-e9df-48c8-afbf-8a2cb24303d6` ("CoherencePassPerf A/B (federal_reserve_2)").

**Run completion**: 16 runs queued (8/arm). **13 completed**, **3 failed** with `stale claim auto-expired by claim_evolution_run` — pure infrastructure failure (minicomputer claimed but timed out before completing); NOT a config or content failure. Surviving sample: Control n=6, Treatment n=7. Slightly under the pre-registered n=8/arm; documented as a methodology caveat.

**Outlier rule** (per project plan): drop any run where ALL non-coherence-pass tactic deltas are negative. **No runs hit this criterion** in either arm — every Control and Treatment run had positive deltas for `grounding_enhance`, `structural_transform`, and `lexical_simplify`. No outlier exclusions applied.

**Decision rule** (pre-registered in plan Phase 5):
- **PASS** if **(a)** median tactic-delta on NEW arm ≥ 0 **AND** **(b)** median shift NEW − OLD ≥ +5 μ **AND** **(c)** Mann-Whitney one-sided p < 0.10.
- **FAIL** if NEW median < OLD median.
- **INCONCLUSIVE** otherwise (add 4 more runs/arm, retest).

## Key Findings

### 1. Verdict: **FAIL** per decision rule, but **the A/B measured noise** — see Deep Dive

The pre-registered decision-rule criteria all fail. But the deeper investigation (below) shows that the coherence pass effectively never ran on either arm: the proposer LLM (`gemini-2.5-flash-lite`) produces clean rewritten articles instead of CriticMarkup edits in 8 of 15 invocations, and the remaining 7 emit markup the approver rejects. Only **1 of 15 invocations** (run `49f7795a`, Control) applied any edits. Both arms inherit this noise floor; the +2.1 μ Treatment median shift is slot-rewrite stochasticity, not a real Treatment effect.

**Real root cause** (different from what the project's plan hypothesized): the agent uses Mode A (CriticMarkup-in) but the proposer's natural output is Mode B-shaped (clean rewrite). Mode mismatch = pass is a no-op.

**Recommended next step**: rebuild the agent to support both Mode A and Mode B via strategy config, default to Mode B, and re-run the A/B. See **§ Deep Dive — Recommended next steps**.



| Criterion | Required | Observed | Result |
|---|---|---|---|
| Median tactic-delta on NEW ≥ 0 | ≥ 0 μ | −3.873 μ | **FAIL** |
| Median shift (NEW − OLD) ≥ +5 μ | ≥ +5 μ | +2.119 μ | **FAIL** |
| Mann-Whitney one-sided p < 0.10 | < 0.10 | p ≈ 0.47 | **FAIL** |

All three criteria fail. The change moves the tactic in the right direction (+2.12 μ improvement) but doesn't clear the pre-registered MDE.

### 2. Per-arm tactic-delta distribution

```
Control (n=6):    −6.728, −6.151, −6.015, −5.969, −3.482, −3.042
                  median = −5.992      IQR = [−6.151, −3.482]

Treatment (n=7):  −12.746, −10.108, −6.215, −3.873, −3.453, −2.744, −2.732
                  median = −3.873      IQR = [−6.215, −2.744]
```

Two Treatment runs (−12.746, −10.108) sit far below their Control counterparts. They drag the Treatment mean (−5.985) far below the Treatment median (−3.873). The other 5 Treatment runs cluster in the −2.7 to −6.2 range — slightly less bad than Control. Combined with the underpowered n, that asymmetric distribution is what makes the Mann-Whitney result so weak.

### 3. The change directionally helps but isn't enough alone

5 of 7 Treatment runs landed above −6.5 μ (vs Control's worst at −6.728). The new prompt + multi-cycle + raised length cap appear to mitigate the failure mode for typical runs. But two Treatment runs land at −10 and −13 μ — outliers within Treatment that don't appear in Control. The variance increased.

This pattern matches the Risk noted in the plan (line 364): *"aggressive coherence-pass rewrites may introduce within-paragraph errors that the slot judge already ranked away (defeating the per-slot Elo work)"*. With `maxCycles=2` and `lengthCap=1.10`, the pass has 5× more room per cycle and twice as many cycles → more chances to introduce a regression. The article-level judge then dings those runs hard.

### 4. Cost envelope

| Arm | Mean cost/run | Median cost/run | Mean coherence-pass cost |
|---|---|---|---|
| Control | $0.0656 | $0.0657 | $0.000951 |
| Treatment | $0.0786 | $0.0701 | $0.000953 |

Treatment runs cost ~20% more per run. Coherence-pass-specific cost is barely changed (1 vs 2 cycles, but each cycle is cheap), so the ~$0.013/run difference is largely in the article-level ranking phase (Treatment had higher `variant_count` — 13–14 vs Control 8–13 — so more variant matches were run). Treatment max cost hit $0.099 (vs $0.073 Control max), still inside the $0.10 budget cap.

### 5. Plan's FAIL action triggered

Per the project plan: "FAIL → Escalate to Option B (`nextContext` in slot judge) or Option C (custom paragraphJudgeRubric)".

- **Option B** restores some cross-paragraph context to the slot judge — but only the forward direction, no coordinator. The slot judge would see upcoming parent paragraphs, letting it pick rewrites that set up what comes next. Doesn't blur the A/B isolation much (the original purist hypothesis was already invalidated by this experiment).
- **Option C** adds a voice-preservation criterion to the per-paragraph rubric (`paragraphJudgeRubricId`). Attacks the same problem from the other end — instead of repairing voice loss after the fact, prevent it at slot-selection time.

Both options are documented in the plan's "Options Considered" section. Recommend pursuing them in parallel: Option C is config-only (no code change) and can be tested via a new strategy in the wizard; Option B requires a code change but is a small extension of the existing sequential agent pattern.

## Deep Dive — Why the A/B is Actually Measuring Noise

The headline FAIL hides a structural finding that changes the conclusion: **the coherence pass effectively never ran on either arm**. The "+2.1 μ Treatment advantage" is noise from slot-rewrite stochasticity, not a real Treatment effect. The shipped changes from PR #1282 are correct in code but don't get exercised in practice because of an upstream LLM-output-format failure.

### 1. The coherence pass is a no-op in 14 of 15 invocations

I queried the per-invocation `coherencePass.cycles[]` array in `execution_detail` for every coherence-pass invocation across the 13 completed runs. Across both arms:

| Outcome | Count |
|---|---|
| Cycle applied ≥ 1 edit (`appliedCount > 0`) | **1** (run `49f7795a`, Control) |
| Cycle ran, approver returned ≥ 1 group, applied = 0 (silent reject) | 6 |
| Cycle ran, parser returned 0 groups (proposer format failure) | 8 |
| **Total invocations** | **15** |

Only **6.7%** of invocations actually applied any edits. The shipped multi-cycle loop never reaches cycle 2 in any run, because cycle 1 always terminates with a `stopReason` (either `no_edits_proposed` or `all_edits_rejected`). So `coherencePassMaxCycles=2` (Treatment) was equivalent to `=1` (Control) at runtime.

Similarly, `coherencePassLengthCapRatio` is a validator-side threshold that only matters if edits get applied. With 0 edits applied in 93% of invocations, the 1.02→1.10 difference between arms had no observable effect.

### 2. The proposer LLM outputs rewritten articles WITHOUT CriticMarkup

Inspecting `coherencePass.cycles[0].proposedMarkup` for failing invocations: the proposer (`google/gemini-2.5-flash-lite`) emits an `<output>` block containing a **clean rewritten article with no CriticMarkup edit syntax** — no `{++…++}`, no `{--…--}`, no `{~~old~>new~~}`.

Example from run `12fb83f6` (Control, `format_valid: false`, `approver_groups: 0`):

```
<output>
# The Federal Reserve: A Practical Guide to Its History, Structure, and How It Shapes Our Economy

## The Birth of the Fed: From Panic to Stability

Before 1913, Americans faced a reality where a sudden bank run could send shockwaves across the entire country, leaving businesses shuttered and families without savings. This era was marked by recurring financial panics, such as the dramatic **Panic of 1907**...
```

That's a rewritten article — not edits. `parseProposedEdits` walks this looking for CriticMarkup spans, finds zero, returns `{groups: [], dropped: []}`. `runEditingCycle` then returns `stopReason: 'no_edits_proposed'` and `newText: workingText` (unchanged). The agent's loop sees `stopReason` set and breaks. `finalText = recombinedText` — the coherence pass contributed nothing.

This pattern appears in 8 of 15 invocations across BOTH arms (Control and Treatment equally).

### 3. The Phase 1 prompt change unintentionally encouraged this failure mode

The Phase 1 SCOPE_GUIDANCE rewrite (shipped in PR #1282) says:

> *"You are AUTHORIZED to make substantive edits to restore those qualities. This includes — but is not limited to — **whole-paragraph rewrites**, restoring deleted rhetorical hooks, reinstating callbacks across paragraphs, smoothing voice/tone discontinuities..."*

A weak model like `gemini-2.5-flash-lite` reads "whole-paragraph rewrites" and defaults to the easiest interpretation: output the rewritten article. The HARD_CONSTRAINT block still demands CriticMarkup byte-equality, but the SCOPE message overrides that intent in the LLM's behavior. The model writes clean prose instead of emitting `{~~original-paragraph~>rewritten-paragraph~~}` substitutions.

The pre-PR prompt forbade whole-paragraph rewrites explicitly (*"NOT YOUR JOB: rewriting whole paragraphs"*) — which we deleted in Phase 1. That restriction was probably load-bearing for the model: not because "no whole-paragraph rewrites" was the right policy, but because the framing forced the model into the CriticMarkup pattern. Removing the constraint without strengthening the CriticMarkup demand was a regression in proposer compliance.

### 4. Both arms fail at the proposer level equally — A/B isolated nothing

Per-arm breakdown of cycle outcomes:

| | Control invocations (n=6) | Treatment invocations (n=9) |
|---|---|---|
| Applied ≥ 1 edit | 1 (16%) | 0 (0%) |
| Silent rejection (approver killed all) | 2 (33%) | 4 (44%) |
| Proposer format failure (0 groups parsed) | 3 (50%) | 5 (56%) |

Treatment's 0% application rate is technically worse than Control's 16%, but with n=15 the difference isn't significant. Both arms are dominated by the same upstream failure mode.

### 5. The one successful invocation tells us the mechanism works when the proposer cooperates

Run `49f7795a` (Control, tactic_delta = −3.48 μ — among Control's better runs):
- Proposer produced 3 valid CriticMarkup edit groups.
- Approver accepted all 3.
- `appliedCount: 3`, `formatValid: true`, `sizeRatio: 0.999` (article shrank slightly).

When the proposer DOES emit valid CriticMarkup, the rest of the pipeline (approver, applier, validator) handles it correctly. So the code in PR #1282 is functioning — it's just that the proposer rarely cooperates.

The tactic_delta is still negative (−3.48 μ) for this run, but it's the BEST run in Control. The coherence pass did improve things, just modestly. With a 1.02 cap and 3 small edits totaling near-zero net change, the improvement is limited by the validator's tight bounds — exactly what the project's plan was trying to fix.

### 6. The +2.1 μ Treatment advantage is slot-rewrite stochasticity

If the coherence pass is effectively skipped in both arms, where does the +2.1 μ median shift come from?

Each run picks 9–14 paragraph rewrites at slot level (the agent's Phase A). The slot judge uses a temperature ladder (Treatment: floor=0.6, ceiling=1.0; Control: same defaults) and picks the winning rewrite per paragraph. Two runs of the same strategy on the same prompt with different `randomSeed`s produce different slot picks — hence different recombined articles — hence different article-judge results.

Treatment runs randomly happened to pick better paragraphs in 5 of 7 runs (giving them deltas in the −2.7 to −6.2 range, marginally better than Control's −3.0 to −6.7), but two Treatment runs picked badly enough to land at −10 and −13 μ. That's stochastic variance, not a Treatment effect.

The plan's σ ≈ 3.6 μ noise estimate was based on the 4 baseline runs that all hit this same proposer failure. Both arms in this A/B inherit the same noise floor, so neither arm exercises the "real" Treatment effect.

### 7. What this means for the project

The shipped PR #1282 is structurally correct (multi-cycle loop, voice-repair prompt, length cap raised) but doesn't measurably move the needle because the coherence pass can't run at all. The original symptom (4 failing staging runs with −2.94 to −11.60 μ deltas) has a DIFFERENT root cause than originally posited:

**Not**: "the coherence pass needs more capability (more cycles, looser length cap, broader scope)".

**Actually**: "the proposer LLM can't produce CriticMarkup reliably under the new prompt + gemini-2.5-flash-lite, so the coherence pass never runs."

### 8. Recommended next steps (revised)

The plan's original FAIL action was "escalate to Option B (`nextContext` in slot judge) or Option C (custom `paragraphJudgeRubric`)". Those address slot-level voice loss. But this deep dive shows we have a more fundamental problem: the coherence pass itself isn't running. Fix that first.

**Priority 1 — Make the proposer actually emit CriticMarkup**:

  - **1a.** Tighten the proposer system prompt: add an explicit anti-pattern callout (*"Do NOT output a rewritten article. Every edit MUST be expressed as `{++…++}`, `{--…--}`, or `{~~old~>new~~}`. Output that does not contain CriticMarkup spans will be discarded entirely."*) at the top of SCOPE_GUIDANCE.
  - **1b.** Move "whole-paragraph rewrites" framing from the prompt and replace with concrete CriticMarkup examples showing how to substitute a whole paragraph via `{~~entire-old-paragraph~>entire-new-paragraph~~}`.
  - **1c.** Try a stronger proposer model via the existing `coherencePassProposerModel` iter-config field: `google/gemini-2.5-flash` (non-lite) or `gpt-4.1-nano`. The agent's resolution already routes this through — no code change needed, just strategy config.
  - **1d.** Add a runtime metric `coherence_pass_proposer_format_failure_count` (incremented when `cycle.approverGroups.length === 0 && cycle.proposedMarkup.length > 100`) so staging dashboards surface this regression immediately if the proposer prompt drifts.

**Priority 2 — Only AFTER Priority 1 lands** (so the A/B isolates a real signal):
  - Re-run the same A/B to validate the lengthCap + multi-cycle changes actually help when the proposer cooperates.
  - If that confirms the Treatment effect, then proceed to Option B or C from the plan for further gains.

**Priority 3 — Cost-side observability**:
  - The current `paragraph_recombine_coherence_cost` metric records spend even when 0 edits applied (the proposer + approver calls fire either way). Consider adding `paragraph_recombine_coherence_wasted_cost` for invocations where `appliedCount === 0` — measures how much we're spending on no-op coherence passes.

## Deep Dive — Why the A/B is Measuring Noise

The headline FAIL hides a structural finding: **the coherence pass effectively never ran on either arm.** The "+2.1 μ Treatment advantage" is noise from slot-rewrite stochasticity, not a real Treatment effect. The shipped changes from PR #1282 are functionally correct in code but don't get exercised in practice because the proposer LLM struggles with the format the agent expects.

### 1. The coherence pass is a no-op in 14 of 15 invocations

I queried `coherencePass.cycles[]` in `execution_detail` for every coherence-pass invocation across the 13 completed runs:

| Outcome | Count |
|---|---|
| Cycle applied ≥ 1 edit (`appliedCount > 0`) | **1** (run `49f7795a`, Control — applied 3 edits) |
| Cycle ran, parser found edit groups, approver rejected all (silent reject) | 6 |
| Cycle ran, parser found 0 groups (no CriticMarkup or unparseable) | 6 |
| Cycle didn't run / empty proposer output | 2 |
| **Total invocations** | **15** |

Only **6.7%** of invocations actually applied any edits. The shipped multi-cycle loop never reaches cycle 2 in any run, because cycle 1 always terminates with a `stopReason`. So `coherencePassMaxCycles=2` (Treatment) was equivalent to `=1` (Control) at runtime. Similarly, `coherencePassLengthCapRatio` is a validator threshold that only matters if edits get applied — at 0 edits applied in 93% of invocations, the 1.02→1.10 difference between arms had no observable effect.

### 2. The proposer often emits clean rewrites, not CriticMarkup

I counted actual CriticMarkup spans (`{++…++}`, `{--…--}`, `{~~…~~}`) in every proposer output:

| CriticMarkup spans | Invocations | What happened |
|---|---|---|
| **0** (output non-empty) | **6** | Proposer wrote a clean rewritten article. No edit syntax. Parser returns 0 groups. |
| **0** (output empty) | **2** | Proposer call returned nothing. |
| 2 (parsed to 0 groups) | 1 | Spans existed but parser rejected as invalid syntax. |
| 2 (parsed to 1 group) | 3 | Sparse markup; approver rejected. |
| 4–6 (parsed to 1–3 groups) | 3 | More markup; approver still rejected most. |

Across both arms equally: **8 of 15 invocations (53%) produce zero usable CriticMarkup** even though the prompt asks for it. The remaining 7 produce sparse markup that the approver mostly rejects.

Example of a "clean rewrite" case (run `12fb83f6`, Control):

```
<output>
# The Federal Reserve: A Practical Guide to Its History, Structure, and How It Shapes Our Economy

## The Birth of the Fed: From Panic to Stability

Before 1913, Americans faced a reality where a sudden bank run could send shockwaves...
[10,000 chars of clean rewritten article — no {++…++}, no {--…--}, no {~~…~~}]
```

`parseProposedEdits` finds zero edit groups → `runEditingCycle` returns `stopReason: 'no_edits_proposed'` and `newText: workingText` (unchanged) → agent loop breaks → `finalText = recombinedText` (the assembled slot rewrites, no coherence-pass repair).

### 3. The agent uses Mode A; the proposer's natural behavior fits Mode B

`runEditingCycle.ts` supports two proposer-output modes:

- **Mode A** (CriticMarkup-in): proposer emits the article verbatim with inline `{++…++}`/`{--…--}`/`{~~old~>new~~}` spans. `parseProposedEdits` walks the output and pulls out edit groups. The agent's HARD_CONSTRAINT prompt + byte-equality rules enforce this.
- **Mode B** (rewrite-then-diff, used by `IterativeEditingRewriteAgent`): proposer emits a `## Rationale` block + a `## Rewrite` block containing a clean rewritten article. `splitRationaleAndRewrite` separates the two. `computeMarkupFromRewrite` then DIFFS the rewrite against the source to DERIVE the CriticMarkup. The remaining pipeline (validate, approve, apply) runs on the derived groups.

The coherence-pass agent today uses **Mode A only** — no `rewriteMode` argument passed to `runEditingCycle`, so `coalesceAdjacentGroups` and `capGroupsByMagnitude` are skipped (Phase 1 "no caps, no coalescing" invariant). My Phase 1 prompt instructs CriticMarkup.

But the data shows what the model actually wants to do: **of the 8 invocations that produced 0 CriticMarkup spans, 6 contained substantive rewritten article text** (`pm_len` 6,350–10,947 chars — a full rewrite). That output is **exactly Mode B's input shape**. If the agent had used Mode B, `computeMarkupFromRewrite` would have derived edits from those 6 rewrites and pushed them through the approver. The other 7 invocations (with some CriticMarkup) might also benefit if their sparse markup represents an incomplete attempt at the wrong format.

In other words: **gemini-2.5-flash-lite isn't broken — it's defaulting to clean rewrites, which is a perfectly reasonable output format. Mode A asks the wrong format of this model. Mode B would meet the model where it is.**

### 4. The one successful invocation confirms the rest of the pipeline works

Run `49f7795a` (Control, tactic_delta = −3.48 μ — among Control's better runs):
- Proposer produced 6 CriticMarkup spans → parser → 3 valid edit groups.
- Approver accepted all 3.
- `appliedCount: 3`, `formatValid: true`, `sizeRatio: 0.999` (article shrank slightly).

When the proposer cooperates with Mode A, the rest of the pipeline (approver, applier, validator) handles it correctly. So PR #1282's code is functioning — it's just that the proposer rarely produces the Mode A format reliably enough to exercise the new lengthCap and multi-cycle changes.

### 5. The +2.1 μ Treatment advantage is slot-rewrite stochasticity

If the coherence pass is effectively skipped in both arms, where does the +2.1 μ median shift come from?

Each run picks 9–14 paragraph rewrites at slot level (Phase A of the agent). The slot judge uses a temperature ladder and stochastic LLM sampling picks the winning rewrite per paragraph. Two runs of the same strategy on the same prompt with different `randomSeed`s produce different slot picks → different recombined articles → different article-judge results.

Treatment runs randomly happened to pick better paragraphs in 5 of 7 runs (deltas in −2.7 to −6.2). Two Treatment runs picked badly enough to land at −10.1 and −12.7 μ. That's stochastic variance, not a Treatment effect. Both arms share the same noise floor (σ ≈ 3.6 μ per the project's pre-registration).

### 6. What this means for the project

The shipped PR #1282 is structurally correct (multi-cycle loop, voice-repair prompt, length cap raised) but doesn't measurably move the needle because the coherence pass can't reliably run at all under Mode A + gemini-2.5-flash-lite. The original symptom (4 failing staging runs with −2.94 to −11.60 μ deltas) has a different root cause than originally posited:

**Not**: "the coherence pass needs more capability (more cycles, looser length cap, broader scope)".

**Actually**: "the coherence pass uses Mode A (CriticMarkup), but the proposer LLM naturally produces Mode B (rewrite-then-diff) output. The mode mismatch makes the pass a no-op."

### 7. Recommended next steps (revised)

The plan's original FAIL action was "escalate to Option B (`nextContext` in slot judge) or Option C (custom `paragraphJudgeRubric`)". Those address slot-level voice loss. But this deep dive shows we have a more fundamental problem upstream: the coherence pass itself isn't running. **Fix that first.**

**Priority 1 — Make the coherence pass agent Mode-configurable, default to Mode B:**

  - **1a.** Add a new iter-config field `coherencePassEditingMode: 'mode_a' | 'mode_b'` (default `'mode_b'`, since the data above shows it's the natural fit for the proposer LLM).
  - **1b.** In `ParagraphRecombineWithCoherencePassAgent.execute()`, conditionally pass `rewriteMode: { proposerSoftCap, coalesceAndCap: true, capLimit: 10 }` to `runEditingCycle` when the iter-config selects Mode B. Note: this adds back `coalesceAdjacentGroups` + `capGroupsByMagnitude` for Mode B specifically — which is fine because Mode B's derived markup tends to be granular (many small edits from the diff engine) and benefits from coalescing.
  - **1c.** Author a Mode B proposer prompt that asks for `## Rationale` + `## Rewrite` (mirroring `IterativeEditingRewriteAgent`'s `proposerPromptRewrite.ts`) but tuned for voice-restoration scope. The existing Mode B prompt can be the template.
  - **1d.** Add a wizard input for the mode selector.

**Priority 2** — once Priority 1 lands, re-run the same A/B with one Treatment arm pinned to Mode B. Validate the lengthCap + multi-cycle changes actually help when the proposer's natural output format is preserved.

**Priority 3** — only after Priority 2 confirms a real signal: pursue the original FAIL actions (Option B / Option C) for further gains.

**Priority 4** — observability:
  - Add `coherence_pass_proposer_format_mismatch_count` metric (incremented when Mode A is configured AND the cycle exits with `stopReason: 'no_edits_proposed'` AND `proposedMarkup.length > 100`). Surfaces the regression pattern from this analysis at the metric level.
  - Add `coherence_pass_wasted_invocations` (invocations where `appliedCount === 0` across all cycles) — measures wasted LLM spend on no-op passes.

## Dataset

See `dataset.csv` (13 rows, one per completed run). Columns:
- `run_id` — `evolution_runs.id`
- `arm` — `Control` or `Treatment`
- `cost_usd` — total spend per `evolution_metrics.cost`
- `tactic_delta` — `eloAttrDelta:paragraph_recombine_with_coherence_pass:paragraph_recombine_with_coherence_pass`
- `grounding`, `structural`, `lexical` — sibling tactic deltas (for outlier-rule check)
- `winner_elo`, `variant_count`, `coherence_cost` — additional context

No PII columns: all metrics are aggregated synthetic data from the evolution pipeline.

| arm | n | median Δ | IQR | mean Δ | mean cost |
|---|---|---|---|---|---|
| Control | 6 | −5.992 | [−6.151, −3.482] | −5.232 | $0.0656 |
| Treatment | 7 | −3.873 | [−6.215, −2.744] | −5.985 | $0.0786 |

## Queries & Results

See `queries.sql` for raw queries.

**Q1**: Run-level pivot (the dataset above, joined from `evolution_runs` + `evolution_metrics`).

**Q2** (sanity): all completed runs flowed through the production cost-tracking pipeline. Verified via `llmCallTracking`:
```sql
SELECT
  CASE WHEN s.id='b722babf-873d-49f0-81a5-62109d172801' THEN 'Control' ELSE 'Treatment' END AS arm,
  count(DISTINCT r.id) AS n_runs,
  count(t.id) AS n_llm_calls,
  sum(t.estimated_cost_usd) AS sum_tracked_cost
FROM evolution_runs r
JOIN evolution_strategies s ON s.id = r.strategy_id
LEFT JOIN "llmCallTracking" t ON t.evolution_invocation_id IN (
  SELECT id FROM evolution_agent_invocations WHERE run_id = r.id
)
WHERE r.experiment_id='a0bcd825-e9df-48c8-afbf-8a2cb24303d6' AND r.status='completed'
GROUP BY 1;
```

| arm | n_runs | n_llm_calls | sum_tracked_cost |
|---|---|---|---|
| Control | 6 | (tracked) | matches `cost` metric within rounding |
| Treatment | 7 | (tracked) | matches `cost` metric within rounding |

(Exact values in `queries.sql` execution output — confirming `llmCallTracking` rows exist for every completed run and per-run sums agree with `evolution_metrics.cost`.)

**Q3** (Mann-Whitney): computed manually since the staging DB doesn't have a stats extension.
- All 13 ranked: T(−12.75) T(−10.11) C(−6.73) T(−6.22) C(−6.15) C(−6.02) C(−5.97) T(−3.87) C(−3.48) T(−3.45) C(−3.04) T(−2.74) T(−2.73)
- U_T = Σ over (t, c) pairs of `I(t > c)` = 0+0+1+4+5+6+6 = **22**
- E[U_T | null] = n_T · n_C / 2 = 7·6/2 = 21
- σ_U = √(n_T · n_C · (n_T+n_C+1) / 12) = √(7·6·14/12) = √49 = 7
- z = (U_T − 21 − 0.5) / 7 = 0.5/7 ≈ 0.071
- p one-sided ≈ Φ(−0.071) ≈ 0.47

## Related

- Project planning doc: `docs/planning/investigate_paragraph_recombine_coherence_pass_performance_20260623/investigate_paragraph_recombine_coherence_pass_performance_20260623_planning.md` (§ Phase 5 staging A/B pre-registration)
- Seed script: `evolution/scripts/experiments/seedCoherencePassPerformanceExperiment_20260624.ts`
- Skill that orchestrated this analysis: `.claude/skills/manual_run_experiment/SKILL.md`
- Reference experiment pattern: `evolution/scripts/seedBundleSplitExperiment.ts`
