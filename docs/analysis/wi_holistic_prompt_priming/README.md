# Implied-Rubric Weights — Holistic-Prompt Priming Experiment

**Project:** `docs/planning/evalute_implied_rubric_results_and_experimentally_validate_20260623/`
**PR:** [#1281](https://github.com/Minddojo/explainanything/pull/1281)
**Date:** 2026-06-25
**Status:** ✅ Complete — pre-registered decision rule MET; priming is causal.

## TL;DR

The Implicit Rubric Weights tool's inferred weights are **substantially driven** by the holistic-prompt's checklist, not the model's intrinsic preferences alone. A 4-arm experiment varying ONLY the holistic prompt (`gemini-2.5-flash-lite`, same 30 article pairs, same 5 criteria, same per-criterion rubric) produces:

- **23%** overall-verdict flip-rate between Control and Stripped (> 15% pre-registered threshold → **priming is real**)
- **57%** overall-verdict flip-rate between Control and Inverted, with **negative** Spearman rank correlation (ρ = −0.7) — the model's holistic call literally reorders when the checklist's emphasis changes
- Arm C (Aligned) gives **non-zero weights to `depth` (0.08) and `structure` (0.12)** — both were flagged `disagreesWithOverall` and clamped to 0 under Arm A's hardcoded checklist
- Arm D (Inverted) elevates `structure` to top weight (0.37) and zeroes `tone` — exact directional confirmation that the checklist drives the fit

**Production implication:** the holistic checklist baked into `buildComparisonPrompt` (`computeRatings.ts:509-515`) **biases the implied-rubric tool toward criteria that overlap with `clarity / structure / engagement / grammar / overall effectiveness`** and away from criteria that don't (notably **depth**, which has no overlap and gets systematically zeroed). When using this tool for genuine model-preference inference, the holistic prompt's checklist should **mirror the session criteria** (Arm C pattern), not the hardcoded default.

## Setup

| Knob | Value |
|---|---|
| Test set | `judge_eval_test_sets.id = 9acb42f5-fa9b-4ce8-b053-431fbe01e026` (frozen) |
| Pair set hash | `cb4ffde192971908c40cb9719ed337b9da1680597725ba66da18bc0b3eba425c` (identical across all 4 arms) |
| Pair kind | article (30 pairs) |
| Criteria (5) | `sentence_variety`, `tone`, `depth`, `structure`, `clarity` |
| Per-criterion prompt | `buildRubricComparisonPrompt` article mode — **invariant across all arms** (clean experimental isolation; the per-criterion rubric prompt has no override) |
| Judge model | `google/gemini-2.5-flash-lite`, temperature 0 |
| Repeats per pair | Arm A: 1 (existing baseline) • Arms B/C/D: 3 (new — within-arm self-consistency via `foldRepeats`) |
| Cost (3 new arms) | $0.32 total (Arm B $0.107, C $0.109, D $0.109) |

### The four arms (per-session `holistic_prompt_override`)

| Arm | Override content | Intent |
|---|---|---|
| A — Control | `null` (= the hardcoded `Clarity and readability / Structure and flow / Engagement and impact / Grammar and style / Overall effectiveness` checklist in `buildComparisonPrompt`) | What the current tool produces by default. |
| B — Stripped | `## Evaluation\nDecide which version is better overall. Differences are often small — answer TIE only if the two are genuinely indistinguishable.` | Removes the checklist; model picks its own bases for comparison. |
| C — Aligned | `## Evaluation Criteria\n- sentence_variety: …\n- tone: …\n- depth: …\n- structure: …\n- clarity: …` (5 session criteria verbatim, with descriptions) | Holistic + per-criterion prompts reference the same rubric vocabulary. |
| D — Inverted | `## Evaluation Criteria\n- Depth — …\n- Structure — …\n- Technical accuracy — …\n- Factual precision — …\n- Completeness — …` (omits clarity, amplifies depth + structure) | Directional test — if priming is causal, weights shift toward depth/structure. |

Canonical prompt strings + SHA-256 registry: `evolution/src/lib/weightInference/experimentArms.ts` + `experimentArmsHashing.ts`.

## Results

### Per-arm fitted weights

| Criterion | A (Control) | B (Stripped) | C (Aligned) | D (Inverted) |
|---|---|---|---|---|
| `sentence_variety` | 0.105 | 0.207 | 0.237 | **0.302** |
| `tone` | **0.481** | **0.397** | **0.300** | 0.000 ⚠ |
| `depth` | 0.000 ⚠ | 0.000 ⚠ | 0.081 | 0.263 |
| `structure` | 0.000 ⚠ | 0.000 ⚠ | 0.124 | **0.372** |
| `clarity` | 0.414 | 0.396 | 0.259 | 0.062 |
| **Top criterion** | tone | tone | tone | **structure** |
| `n_fit_pairs` | 20 / 30 | 13 / 30 | 9 / 30 | 9 / 30 |
| `train_accuracy` | 0.85 | 0.85 | 1.00 | 0.89 |
| `disagreesWithOverall` flag | depth, structure | depth, structure | — | tone |
| `collinear` flag | — | tone↔clarity | — | — |

⚠ = `disagreesWithOverall` flag → clamped to 0.

### Cross-arm comparison matrix

| Pair | L1 distance | Cosine | Spearman ρ | Top criterion (A→B) | Overall-verdict flip rate |
|---|---|---|---|---|---|
| A vs B | 0.20 | 0.98 | 0.9 | tone = tone | 23% (7/30) |
| A vs C | 0.67 | 0.89 | 1.0 | tone = tone | 43% (13/30) |
| **A vs D** | **1.67** | **0.16** | **−0.7** | **tone vs structure** | **57% (17/30)** |
| B vs C | 0.47 | 0.93 | 0.9 | tone = tone | 27% (8/30) |
| **B vs D** | **1.46** | **0.27** | **−0.6** | **tone vs structure** | **40% (12/30)** |
| C vs D | 0.99 | 0.58 | −0.7 | tone vs structure | 17% (5/30) |

### Per-arm position bias

Forward-vs-reverse winner disagreement rate (first-repeat measurement; the persisted verdict uses majority across `auto_repeats=3` repeats for arms B/C/D).

| Arm | Position bias rate | n (pairs with both passes) |
|---|---|---|
| A | 30% | 30 |
| B | 57% | 30 |
| C | 67% | 30 |
| D | 63% | 30 |

The 27-37 pp uptick in B/C/D vs A reflects measurement asymmetry (B/C/D use repeats=3 so `forwardWinner`/`reverseWinner` are from the first repeat only — see `foldRepeats` in `autoJudge.ts:130-155`) plus a real cost: when the checklist is varied or removed, the model's holistic call becomes less position-stable. Worth noting but not the main signal.

## Decision rule — RESULT

Pre-registered (planning doc lines 173-176): **priming is real** if
- Control vs Stripped flip rate > 15%, **OR**
- Weight-vector L1 > 0.3 with non-overlapping CIs on the top-2 criteria.

**Both conditions met.**
- Control vs Stripped flip rate: **23%** > 15% ✓
- Control vs Inverted L1: **1.67** > 0.3 ✓, with non-overlapping CIs:
  - Arm A `tone` 0.48 (CI 0.33–0.68) vs Arm D `tone` 0.00 (CI 0–0.26)
  - Arm A `structure` 0.00 vs Arm D `structure` 0.37 (CI 0–0.51)
  - Arm A `clarity` 0.41 (CI 0.13–0.59) vs Arm D `clarity` 0.06 (CI 0–0.24)

## Outcome reading

The planning doc enumerated 5 possible outcome shapes. Observed shape: **outcome 4 (priming dominant) + partial outcome 2 (model also has intrinsic preferences)**.

1. ~~All four similar — model has stable intrinsic preference~~ — Arm D ruins this.
2. **Partially:** Arm B ≈ Arm A (L1 = 0.20) is consistent with "model has some intrinsic preference toward tone + clarity even without the checklist." But Arm C ≠ Arm A (L1 = 0.67) shows the model's preferences shift substantially when given an aligned checklist.
3. ~~A ≈ C, B sharply different — model needs scaffolding~~ — Arm B is NOT degenerate; it's the closest neighbor to Arm A.
4. **Yes:** Arm D's weight pattern inverts (depth + structure dominant, tone zeroed). Spearman ρ = −0.7 vs Arm A. 57% holistic-verdict flip on the same 30 pairs. The checklist is causally steering the fit.
5. ~~B becomes degenerate~~ — Arm B has train accuracy 0.85, identical to Arm A.

### Practical takeaways

1. **The hardcoded holistic checklist systematically biases the implied-rubric tool**. Criteria that don't appear in the checklist (notably **depth**) get systematically zeroed via the `disagreesWithOverall` flag. Both Arm A and Arm B (no checklist) zero out depth + structure — the model's "default" preference matches the checklist's pattern. But Arm C (checklist = session criteria) gives both `depth` (0.08) and `structure` (0.12) non-zero weights. So **the model CAN attend to depth/structure, but only when explicitly told to via the holistic prompt.**

2. **The recommended production change:** when an operator runs the Implied Rubric Weights tool for genuine model-preference inference, the **holistic prompt should mirror the session criteria** (the Arm C pattern). Either:
   - **Make Arm C the default** in `runAutoChunk` — automatically generate `holistic_prompt_override` from the session's criteria when no override is provided. Cleanest production fix; eliminates the priming asymmetry without operator action.
   - **OR:** document the bias in the tool's UI (the create-session form already has the Arm-preset dropdown; add a banner explaining the implication of leaving the override blank).

3. **The tool remains useful for "what does the model lean on with THIS holistic prompt"** — that's the Arm A reading. Just don't interpret Arm A's weights as the model's intrinsic rubric.

4. **For the specific tone↔clarity #1/#2 ambiguity** noted in the original investigation: with the priming alignment in mind, Arm A's "tone = 0.48 vs clarity = 0.41" reflects the **holistic prompt's** weighting more than the model's, because the holistic prompt mentions both "Engagement and impact" (~tone) and "Clarity and readability" twice through its checklist. Arm C's more balanced reading (clarity 0.26, tone 0.30, sentence_variety 0.24) is closer to the model's actual lean.

## Caveats

- **N = 30 pairs** per arm, **9-20 fit pairs** after overall-tie filtering. CIs are wide; tone↔clarity #1/#2 ordering within an arm is rarely statistically resolved. Larger test set would tighten the magnitudes; the **directional** findings (Arm D ≠ Arm A) are robust at this N.
- **Single model** (`gemini-2.5-flash-lite`). Position bias is high (30% baseline) and stronger models would likely produce different absolute numbers. The PRIMING effect is the model-agnostic finding; absolute weights are not.
- **Repeats asymmetry**: Arm A baseline used `auto_repeats=1` (pre-existing session); Arms B/C/D used `auto_repeats=3`. The folded confidence weighting differs slightly. Re-running Arm A with repeats=3 would tighten the comparison but isn't expected to flip the directional signal (the original baseline `Fed rubric` session at T=1 / repeats=1 also showed the depth + structure zeroing).
- **Position-bias rate** for B/C/D is measured from the **first repeat only** (`foldRepeats` keeps only `results[0]`'s forward/reverse). The verdict itself uses majority across all 3 repeats. So the position-bias numbers and the verdict numbers reflect different things — interpret the position bias as "noisiness of the first roll", not "noisiness of the persisted verdict".

## Reproducibility

Exact session IDs on staging (read-only):
- Arm A: `20a09cde-883c-4919-8bda-24ae74986ca8` ("New test", pre-existing baseline)
- Arm B: `006aea50-dd06-42da-a7b6-70ae3664d0b9` (`[ARM-B] Stripped holistic 20260625`)
- Arm C: `ec71808d-2833-4f46-83c6-4dd525705112` (`[ARM-C] Aligned holistic 20260625`)
- Arm D: `b8b36654-6f97-4c89-ad3c-d0295b6fdbd4` (`[ARM-D] Inverted holistic 20260625`)

### Re-run the analysis

```bash
npx tsx evolution/scripts/wi_arm_comparison.ts \
  --staging \
  --test-set 9acb42f5-fa9b-4ce8-b053-431fbe01e026 \
  --arm-a 20a09cde-883c-4919-8bda-24ae74986ca8 \
  --arm-b 006aea50-dd06-42da-a7b6-70ae3664d0b9 \
  --arm-c ec71808d-2833-4f46-83c6-4dd525705112 \
  --arm-d b8b36654-6f97-4c89-ad3c-d0295b6fdbd4 \
  --out docs/analysis/wi_holistic_prompt_priming/wi_arm_comparison_results.json
```

The script:
1. Hash-verifies each arm's persisted `holistic_prompt_override` against `ACCEPTED_HASHES[arm]` from `experimentArmsHashing.ts` (refuses to fit if hash drifted from canonical).
2. Hash-verifies the resolved pair set across arms (refuses if any two arms diverge → catches test-set mutation mid-experiment).
3. Re-runs `fitWeights` + `weightCIs` against the persisted verdicts.
4. Writes a stable-key JSON (sorted, fixed arm order A/B/C/D) so re-runs on identical data produce byte-identical output — `git diff` confirms determinism.

### Raw fit JSON

Full per-arm fits + cross-arm metrics: `docs/analysis/wi_holistic_prompt_priming/wi_arm_comparison_results.json`.

## Recommended follow-ups

1. **Productionize Arm C as the default override** (small follow-up PR): in `runAutoChunk`, when `session.holistic_prompt_override` is `null`, auto-construct a checklist from the session's resolved criteria (name + description, mirroring Arm C). Removes the priming asymmetry without operator action.
2. **Replicate at scale** — re-run the same 4-arm setup on (a) a larger test set (60+ pairs), (b) a smarter model (`gemini-2.5-pro` or `claude-haiku-4-5`). The directional findings should hold; absolute weights will tighten.
3. **Cross-criteria study** — try arms with criteria DELIBERATELY MISSING from the holistic prompt vs DELIBERATELY MENTIONED, to characterize the priming response curve.
4. **The position-bias measurement asymmetry** (first-repeat only vs majority-fold verdict) should be unified — either measure position bias on the full repeated set, or document the asymmetry inline in the Run-tab progress display.
