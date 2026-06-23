# Investigate Paragraph Recombine Coherence Pass Performance Research

## Problem Statement
Use debugging skill to query supabase dev and diagnose why most recent 4 paragraph recombine runs on stage have all underperformed.

## Requirements (from GH Issue #1269)
Use debugging skill to query supabase dev and diagnose why most recent 4 paragraph recombine runs on stage have all underperformed.

## High Level Summary

All 4 most-recent paragraph-recombine runs on staging use the **`paragraph_recombine_with_coherence_pass`** agent (strategy `244e9767-…`, "Paragraph recombine with coherence pass, top variants", run on 2026-06-23). Every run reports a NEGATIVE `eloAttrDelta:paragraph_recombine_with_coherence_pass:paragraph_recombine_with_coherence_pass` (range −2.94 to −11.60 mu, every recombined-variant histogram lands 100% in the −10:0 bucket) while sibling tactics on the same runs (`grounding_enhance`, `structural_transform`) carry positive deltas. The recombined article variant lands 5th-or-lower out of 8–15 variants per run; the top of each pool is a `generate_from_previous_article` variant in the 1245–1255 Elo range.

The root cause is structural to the coherence-pass agent's design intersected with the post-`investigate_sequential_paragraph_recombine_performance_20260615` rubric:
- **Slot judges aggressively prefer rewrites over originals** (39 / 41 slots = 95% across the 4 runs picked a rewrite). The hardcoded paragraph rubric dropped Fidelity (Phase 1c-ii of the prior project), so nothing penalizes voice/structure loss.
- **The coherence-pass agent intentionally runs slot judges WITHOUT `priorPicks` / `nextContext` / coordinator** (it's the A/B isolation arm for the "isolated rewrites + post-hoc smoothing" hypothesis). So per-slot optimization is paragraph-local with no cross-paragraph context — losses compound across 9–11 slots into article-level voice/structure loss.
- **The post-hoc coherence pass is effectively a no-op in 3 of 4 runs.** It runs ONCE per invocation (single propose-review-apply cycle, hard 2% growth cap). Cycle outcomes: 1 of 3 proposed edits applied (run f2315044), 1 silent rejection (run 04704b6a — approver rejected the only proposed edit), 2 with proposer output yielding 0 parsable edits (runs 38a8f736, 67a4a339). Even when it lands an edit, it can only do MINOR seam repair — it cannot reconstruct lost voice.
- **Rewrite drop rate 15–27% (target <15%), all `length_under`.** The isolated REORDER / TIGHTEN / RESTRUCTURE directives at the 0.6–1.0 temperature ladder produce too-short outputs; the validator drops them. Survivors skew "tighter" (slot judge then picks tightest paraphrase), which compounds the voice loss.
- **Other secondary contributors**: `maxComparisonsPerVariant: 3` (strategy config) gives the article-level Elo system only 3 head-to-head matches per new variant — small sample, high variance, but consistently negative across all 4 runs so it's not the proximate cause.

The prior project (`investigate_sequential_paragraph_recombine_performance_20260615`) addressed an isomorphic symptom on the **sequential** `paragraph_recombine` agent. Its fixes (1c-i nextContext / 1c-ii drop Fidelity / 1c-iii rebalanced rubric / 1d per-paragraph rubric / 2 coordinator replan) targeted the SEQUENTIAL path's slot judge — **none of them help the coherence-pass agent**, whose entire premise is to NOT use sequential context. So this looks like a recurring structural mismatch, not a regression.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/debugging.md — diagnostic queries, `query:staging` patterns
- docs/feature_deep_dives/debugging_skill.md — debug-skill methodology
- evolution/docs/paragraph_recombine.md — sequential paragraph recombine baseline + prior project's Sequential Perf Tuning section (Phases 1a–2)
- evolution/docs/paragraph_recombine_with_coherence_pass.md — the agent under investigation: algorithm, directives, config knobs, A/B design

## Code Files Read
- `evolution/src/lib/core/agents/paragraphRecombineWithCoherencePass/ParagraphRecombineWithCoherencePassAgent.ts` — agent execute() body. Confirms:
  - Slot judge config strips article rubric, uses `paragraphJudgeRubric` if set (else hardcoded paragraph rubric), `comparisonMode: 'paragraph'`, NO `priorPicks` / `nextContext` argument anywhere.
  - Single coherence-pass cycle via `runEditingCycle()` with tight `validateOpts: { lengthCapRatio: 1.02, redundancyJaccardThreshold: 0.30, flowGuardrailEnabled: true }`.
  - Pre-coherence-pass budget gate at 0.85× `effectiveCapUsd` ($0.085 with defaults).
  - On format-invalid recombined assembly, `coherencePass: { skipped: 'format_invalid_recombine' }` and emit `surfaced=false`.
- `evolution/src/lib/core/agents/editing/runEditingCycle.ts` — single-cycle helper. Confirms:
  - When parser produces 0 valid `approverGroups`, helper returns early with `formatValid: false` + `stopReason: 'no_edits_proposed' | 'parse_failed'` and `newText = workingText` (no change).
  - When approver rejects all (`appliedCount === 0`), returns with `stopReason: 'all_edits_rejected'` and `newText = workingText` (silent-rejection observability already wired at the caller).
  - On unsplit / unparseable proposer output, no apply happens.
- Files NOT yet read (deferred to planning): `buildCoherencePassProposerPrompt.ts` (prompt content — likely root cause of 0-edit cycles), `slotProvenance.ts`, `paragraphSlots.ts` (validator's `length_under` rule), `runEditingCycle.ts`'s downstream parsers.

## Key Findings

### Data — the 4 runs

| Run | Strategy | Tactic eloAttrDelta | Sibling deltas | Variants | Top Elo | Coherence-pass Elo position |
|-----|----------|---------------------|-----------------|----------|---------|-----------------------------|
| `f2315044` | "Paragraph recombine with coherence pass, top variants" | **−5.68** | grounding +6.45, structural +4.78, lexical +1.85 | 13 | 1247 | 5 / 11 (Elo 1151) |
| `38a8f736` | same | **−6.04** | grounding +7.14, structural +5.51 | 8 | 1242 | bottom-half |
| `67a4a339` | same | **−2.94** | grounding +5.75, structural +4.62 | 15 | 1246 | bottom-half |
| `04704b6a` | same | **−11.60** | grounding −4.97, structural −5.78 (ALL negative — outlier run) | 11 | 1255 | bottom-half |

All `eloAttrDeltaHist:paragraph_recombine_with_coherence_pass:paragraph_recombine_with_coherence_pass:-10:0` = 1.0 — every coherence-pass variant in every run landed in the −10:0 mu bucket.

### Slot judges aggressively prefer rewrites over originals

Per-invocation slot decisions (one invocation per run, since each run hits a budget that fits ~1 dispatch despite `maxDispatches: 5`):

| Invocation | Slots | Winner = rewrite | Winner = original | Total slot matches |
|------------|-------|-------------------|---------------------|--------------------|
| `5c1f4102` (04704b6a) | 10 | 9 | 1 | 272 |
| `89405c1d` (38a8f736) | 11 | 10 | 1 | 291 |
| `5e3c643a` (67a4a339) | 11 | 11 | 0 | 353 |
| `d85742d9` (f2315044) | 9 | 9 | 0 | 296 |

**95% of slot decisions chose a rewrite.** With the hardcoded paragraph rubric stripped of Fidelity (Phase 1c-ii), nothing in the slot rubric penalizes voice/structure loss, and the slot judge consistently finds something "tighter" or "cleaner" to prefer.

### The coherence pass is effectively a no-op in 3 of 4 runs

Single propose-review-apply cycle per invocation. Outcomes:

| Invocation | approverGroups | accepted | rejected | applied | sizeRatio | formatValid | Notes |
|------------|----------------|----------|----------|---------|-----------|-------------|-------|
| `d85742d9` (f2315044) | 3 | 1 | 2 | **1** | 0.988 | true | only run where coherence pass actually changed text |
| `5c1f4102` (04704b6a) | 1 | 0 | 1 | 0 | 1.000 | true | silent-rejection: approver rejected the only proposed edit |
| `89405c1d` (38a8f736) | 0 | 0 | 0 | 0 | 1.000 | **false** | proposer output yielded 0 valid edits (cycle returned `no_edits_proposed`) |
| `5e3c643a` (67a4a339) | 0 | 0 | 0 | 0 | 1.000 | **false** | same |

In 3 of 4 runs the recombined article passed through coherence pass UNCHANGED. Even in the one successful run (f2315044), only 1 of 3 proposed edits applied — far from enough to repair the cross-slot voice loss.

### Rewrite drop rate 15–27% — all `length_under`

| Invocation | Succeeded | Dropped (length_under) | Drop rate |
|------------|-----------|------------------------|-----------|
| `5c1f4102` | 41 | 9 | 18% |
| `89405c1d` | 40 | 15 | 27% |
| `5e3c643a` | 47 | 8 | 15% |
| `d85742d9` | 37 | 8 | 18% |

Prior project's acceptance signal is `length_over + length_under ≤ 15%`. We're at 15–27%. All drops are `length_under` — the REORDER / TIGHTEN / RESTRUCTURE directives at floor 0.6 / ceiling 1.0 produce too-short rewrites. Survivors skew "tighter than original," which when picked by the slot judge × 9–11 slots compounds article-level voice loss.

### Other observations

- **Only 1 paragraph_recombine_with_coherence_pass invocation per run** (despite `maxDispatches: 5` in strategy config). Each invocation spends ~$0.040 of the iteration's $0.07 budget (70% of $0.10 run cap), so the K-dispatch math caps at 1 — second dispatch would push over budget floor. The `parallel_dispatched` metric of 7–14 is summing across iterations (~11 `generate_from_previous_article` from iter 0 + 1 coherence-pass from iter 1).
- **Slot-judge slot rewrites compound; coherence pass doesn't repair.** Average winner Elo at slot level is 1240–1280 (winners decisively beat the original at 1200) — slot judges are confident. But the article judge then dings the recombined article at 1100–1200 vs the parent's 1247.
- **`slot_provenance_ratio_p25 = p50 = 0` across all 4 runs.** Per the doc this metric is noisy (Levenshtein-based; REORDER and RESTRUCTURE confound), but 0 across the board is striking. (Not necessarily diagnostic — the metric is observational-only.)
- **`median_sentence_verbatim_ratio ≤ 0.023` (essentially zero) across all 4 runs.** Variants share almost no verbatim sentences with parent — consistent with aggressive paragraph-level paraphrasing.
- **`decisive_rate = 0.33–0.60`** at article level (lots of ties), but enough decisive matches to land consistent negative attribution.
- **04704b6a is an outlier — ALL tactics negative including grounding and structural.** Suggests something run-specific (weak seed pool, judge variance, or seed). Worth filtering out when computing the coherence-pass acceptance signal; the OTHER 3 runs (clean comparison) are still −2.94 to −6.04.

### Reconciliation with the prior project (`investigate_sequential_paragraph_recombine_performance_20260615`)

The prior project documented an isomorphic symptom on the **sequential** `paragraph_recombine` agent (`eloAttrDelta:paragraph_recombine:paragraph_recombine` ≈ −1.5 to −6 mu, top variant Elo 1245, ALL 4 most recent runs). Its diagnosis split into:
1. **Selection bias** (`qualityCutoff: topN-3` picks high-Elo parents → hard to beat).
2. **Coherence loss across slot seams** (sequential path: slot 0 commits to a metaphor, slots 1+ don't know).

Its fixes (Phase 1c-i: nextContext block in slot judge; Phase 1c-ii: drop Fidelity from slot rubric; Phase 1c-iii: rebalanced criteria; Phase 1d: per-paragraph rubric; Phase 2: coordinator mid-sequence replan) targeted the SEQUENTIAL path's slot judge.

The coherence-pass agent is a **DIFFERENT** agent class (`paragraph_recombine_with_coherence_pass`) whose entire design premise is to NOT use sequential context per slot judge (no `priorPicks`, no `nextContext`, no coordinator — these are the A/B isolation control). It relies on a post-hoc coherence pass to fix cross-slot seams. The current data shows that post-hoc pass is too weak (1 cycle, 0–1 edits applied per run) to compensate.

**Important**: Phase 1c-ii (drop Fidelity from slot rubric) is shared between both agents — so the post-Phase-1c-ii rubric makes the coherence-pass agent's slot judges aggressive in the same way it did the sequential agent's. But the sequential agent compensates with `nextContext` + coordinator + replan; the coherence-pass agent compensates ONLY with the post-hoc pass, which is firing at 25% useful-edit rate.

## Open Questions

1. **Should the coherence pass be allowed to make non-MINOR changes?** Current `lengthCapRatio: 1.02` allows ≤2% article growth — too tight for restoring voice. Lifting the cap risks article-level format issues and undermines the "MINOR" design intent, but the current setting prevents the pass from doing real work.
2. **Should the coherence-pass agent restore SOME cross-paragraph context to the slot judge?** Re-introducing `nextContext` alone (without coordinator/replan) might be enough to bring slot-level optimization out of voice-degrading paragraph-locality. Trade-off: blurs the A/B isolation (coherence-pass agent is no longer the "pure isolated rewrites" arm).
3. **Should the proposer prompt be rewritten for higher edit yield?** The 50% (2/4) zero-`approverGroups` rate suggests the proposer prompt is underspecified — the LLM produces output that doesn't parse into edit groups. Need to read `buildCoherencePassProposerPrompt.ts` to assess; could be a quick win.
4. **Should the strategy raise `maxComparisonsPerVariant`?** 3 head-to-head matches per article variant is very few — high Elo variance. But it's not the proximate cause (all 4 runs converge to negative deltas).
5. **Should we add a Fidelity-or-equivalent voice-preservation criterion back into the slot rubric for THIS agent only**, via `paragraphJudgeRubricId`? The coherence-pass agent ALREADY supports a custom rubric, but the strategy doesn't set one. A "preserve distinctive voice / cadence / metaphors" criterion could counter the 95% rewrite-pick rate.
6. **Is the `length_under` drop rate fixable by raising the temperature ladder floor** (currently 0.6) or by injecting a hard character count into the directives (as `paragraph_recombine_invocation_20260529` did for the sequential agent's index-0)? Probably yes — straightforward to test.
7. **Is the dispatch math actually producing 1 dispatch by design**, or is there a bug? `maxDispatches: 5` is set, but available iteration budget after iter 0 ≈ $0.045 and per-invocation actual cost is ≈ $0.041. The math is tight but theoretically correct. Worth a sanity check that the iter-budget split (30%/70%) is the intended allocation.
8. **What does the recombined post-coherence-pass article actually look like vs. the parent?** A side-by-side read would clarify whether the issue is structural (loss of voice/structure) or surface (formatting / punctuation residue). Worth manually inspecting one of the f2315044 invocation's outputs.
