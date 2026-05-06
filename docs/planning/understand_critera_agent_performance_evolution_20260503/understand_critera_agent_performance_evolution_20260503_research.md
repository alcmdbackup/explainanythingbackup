# understand_critera_agent_performance_evolution_20260503 Research

## Problem Statement

I want to investigate recent criteria agent-focused runs and understand why performance is worse than I expected. Use @docs/docs_overall/debugging.md to query stage db and look at the last few

## Requirements (from GH Issue #NNN)

(Expanded during research — see High Level Summary and Key Findings below.)

## High Level Summary

The criteria agent (`evaluate_criteria_then_generate_from_previous_article`, shipped 2026-05-01 in PR #1023) is producing **-47 Elo mean delta** vs parents (vs +16-23 Elo for vanilla generate / structural_transform). 95 child variants from 5 runs on staging, all from a single strategy ("Criteria based generation") testing 7 seeded sample criteria with `weakestK=2` against the Federal Reserve article prompt.

**Three root causes**, ranked by share-of-blame:

1. **Misconfigured rubrics for educational content (DOMINANT).** The seeded `point_of_view` rubric explicitly equates neutral writing with score 1 ("reads like a Wikipedia summary" — pejorative); the LLM reliably scores it 4.15/10 (lowest of any criterion) and focuses on it 96.8% of the time. The seeded `engagement` rubric demands "reader can't put it down" pacing unsuitable for technical content; pushed toward sensationalist "evocative" / "intriguing" language. Together POV + engagement drive ~75% of weakestK=2 focus pairs and produce -47.55 / -41.87 Elo when focused.

2. **`customPrompt` template invites bloat (CONTRIBUTING).** The wrapper builds GFPA's prompt with "Apply these specific fixes" + suggestion verbs ("introduce", "frame", "add") and never instructs the LLM to preserve length. Worst-case variants bloat 29-45% with clunky meta-commentary or tone inflation. (Caveat: reflection wrapper bloats 16.7% and works fine — bloat alone isn't the killer; bloat *of bad suggestions* is.)

3. **Mechanical GFPA execution of bad suggestions.** The 5 best criteria-driven variants ALSO focus on POV+engagement but apply suggestions surgically (1-17% length change, even -1.4% in one case) and produce genuinely better articles. The agent CAN execute well; the failure mode is qualitative, not categorical.

**Refuted hypotheses:**
- Regression-to-mean: Reflection uses the same `sourceMode='pool'` and faces an identical parent-Elo climb (19→26→29→30 across iterations) yet achieves positive deltas — refuting R2C's claim that RTM explains 95% of the criteria delta.
- Parser bugs: 3% parse-error rate, all due to "zero valid suggestions remained after weakest-K filter"; not a dominant failure.
- LLM judge noise: Mean confidence 0.766; judge is decisive, not shaky.
- Cost / latency / operational issues: 96.9% success rate, $0.0018/invocation median, 13.3s median latency. Operationally healthy.

**Caveats:** Sample is thin — 5 runs, 1 strategy, 1 prompt (Federal Reserve, highly factual content). Findings may not extrapolate to opinion-driven content prompts.

## Documents Read

### Core
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`

### Evolution (full directory, including the 4 newly-moved deep dives)
- `evolution/docs/README.md`
- `evolution/docs/architecture.md`
- `evolution/docs/agents/overview.md`
- `evolution/docs/arena.md`
- `evolution/docs/cost_optimization.md`
- `evolution/docs/curriculum.md`
- `evolution/docs/data_model.md`
- `evolution/docs/entities.md`
- `evolution/docs/logging.md`
- `evolution/docs/metrics.md`
- `evolution/docs/minicomputer_deployment.md`
- `evolution/docs/rating_and_comparison.md`
- `evolution/docs/reference.md`
- `evolution/docs/strategies_and_experiments.md`
- `evolution/docs/visualization.md`
- `evolution/docs/sample_content/api_design_sections.md`
- `evolution/docs/sample_content/filler_words.md`
- `evolution/docs/planning/multi_iteration_strategy_support_evolution_20260415/multi_iteration_strategy_support_evolution_20260415_planning.md`
- `evolution/docs/evolution_metrics.md` (moved from `docs/feature_deep_dives/`)
- `evolution/docs/variant_lineage.md` (moved from `docs/feature_deep_dives/`)
- `evolution/docs/multi_iteration_strategies.md` (moved from `docs/feature_deep_dives/`)
- `evolution/docs/editing_agents.md` (moved from `docs/feature_deep_dives/`)

### Tracked for this project
- `docs/docs_overall/debugging.md` — `npm run query:staging` workflow, evolution-specific debugging recipes.
- `docs/planning/evaluateCriteriaThenGenerateFromPreviousArticle_20260501/evaluateCriteriaThenGenerateFromPreviousArticle_20260501_planning.md` — full implementation plan; key for understanding the customPrompt design + the seeded sample criteria definitions.
- `docs/planning/evaluateCriteriaThenGenerateFromPreviousArticle_20260501/evaluateCriteriaThenGenerateFromPreviousArticle_20260501_research.md` — architectural decisions (combined LLM call, attribution dimension, marker tactic).
- `docs/research/judge_agreement_summary_tables.md` — qwen-2.5-7b judge accuracy data (decisive on close pairs at all temps; explains why the -47 Elo signal isn't judge noise).

## Code Files Read (during agent investigation, primarily by Round 1D and Round 3C)

- `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` — wrapper agent class (especially `buildCustomPromptFromSuggestions` at lines 253-268 and the weakest-K selection logic at lines 486-490).
- `evolution/src/lib/core/agents/generateFromPreviousArticle.ts` — inner GFPA `customPrompt` branch and `criteria_driven` tactic guard.
- `evolution/src/lib/pipeline/loop/buildPrompts.ts` — `buildEvolutionPrompt` assembly (preamble + parent + instructions + FORMAT_RULES).
- `evolution/src/lib/shared/formatRules.ts` (or `enforceVariantFormat.ts`) — FORMAT_RULES text; does not cap length.
- `evolution/src/lib/core/tactics/generateTactics.ts` — vanilla tactic prompts for comparison.
- `evolution/src/lib/schemas.ts` — `iterationConfigSchema` refinements for `criteria_and_generate`.
- `evolution/src/services/criteriaActions.ts` — `getCriteriaForEvaluation`, `validateCriteriaIds`.
- `evolution/scripts/seedSampleCriteria.ts` — the 7 seeded sample criteria with their rubrics (THE root cause for the misconfigured ones).

## Key Findings (numbered)

1. **point_of_view rubric is misconfigured for educational content.** Anchor 1 = "reads like a Wikipedia summary" (pejorative); anchor 10 = "argues for something specific". For factual articles like the Federal Reserve, the LLM correctly scores it low (avg 4.15) and the suggestions push toward opinionated framing — which the standard quality judge then marks as worse.

2. **engagement rubric demands page-turner pacing unsuitable for technical content.** Anchor 1 = "reader bounces", anchor 10 = "reader can't stop until the end". Suggestions push toward "evocative phrases", "intrigue", and titles like "The Fed's Secret Hand". 96/98 invocations generate suggestions for it; produces -41.87 Elo when focused.

3. **clarity / structure / tone / sentence_variety rubrics are well-configured.** Average scores 6.37-8.67; never picked as weakest by the LLM (correct behavior). These don't need changes.

4. **depth rubric is well-configured but mechanically over-applied.** Suggestions are sensible (concrete examples, mechanism explanation) but produces -56.82 Elo when focused — likely because GFPA elaborates depth into bloat rather than depth into substance.

5. **The customPrompt template invites bloat through asymmetric framing.** "Apply these specific fixes" + suggestion verbs ("introduce", "frame", "add", "integrate") with no length-preservation instruction. Vanilla `structural_transform` says "preserve all key points exactly" which creates implicit pressure against bloat; criteria's customPrompt has no equivalent.

6. **Bloat by itself doesn't cause negative deltas.** Reflection wrapper bloats MORE than criteria (16.7% vs 11.8% length ratio) but achieves positive deltas. What matters is whether the additions add value. Reflection picks expansion-suitable tactics (engagement_amplify, analogy_bridge); criteria's LLM-generated suggestions push toward opinion / sensationalism that the judge correctly downscores.

7. **The agent CAN work well — best 5 variants tell us what success looks like.** They focus on the same POV+engagement criteria but apply suggestions surgically: 1-17% length change (one variant -1.4%), reframing neutrality into "perspective-driven narrative" connecting Fed policy to reader's stakes ("Imagine a world where your paycheck's value fluctuates wildly"). Quality is genuinely better, not just "less bloated".

8. **Regression-to-mean is real but minor.** Pool-mode parents are ~+4 mu above population mean (29.28 vs 25). Reflection faces the same headwind (uses pool mode for iters 2+, same parent-Elo climb 19→26→29→30) and still achieves positive deltas — refuting R2C's "RTM explains 95%" claim. Switching to seed mode would only reclaim ~+4-6 Elo.

9. **Operational health is fine.** 96.9% success rate (3/98 fail at parser when ALL suggestions get filtered out); $0.0018 median cost per invocation; 13.3s median latency; 97.9% of successful invocations surface a variant. Judge confidence on criteria comparisons is 0.766 mean — decisive.

10. **Sample is tiny.** 5 runs, 1 strategy, 1 prompt (Federal Reserve), 1 set of 7 criteria. All from a 3.75-hour window on 2026-05-03. Findings about specific rubrics (POV, engagement) are well-supported by the code-level evidence; quantitative deltas should be re-measured after any fixes against more diverse prompts.

## Open Questions

1. **Will the rubric fixes generalize to opinion content?** The current evidence is from a factual-Fed article. POV / engagement rubrics may be valuable for opinion / persuasive content; a fix should preserve that use case (e.g., add an article-type field, or split into two rubric sets).

2. **Is the sample biased?** All 95 variants come from one strategy. Could the strategy author have tuned criteria for a different content type and tested on Fed by accident? Worth confirming with the user before declaring the seeded defaults unsuitable.

3. **What's the ratio of educational vs opinion content in the broader explanation pipeline?** If most ExplainAnything content is factual / educational, the seeded defaults need to bias that way.

4. **Should `depth` apply only when the parent has clear gaps?** Currently it's available as a focus target on every variant; if the parent is already detailed, "fill gaps" suggestions become "add filler".

## Recommended Next Steps (rough — formalize in plan-review)

**Phase 1 (lowest effort, highest impact, ~1 hour, all admin-UI edits):**
- Edit `point_of_view` rubric anchors via `/admin/evolution/criteria` UI to reframe around narrative voice + pedagogical fit (not "takes a stance").
- Edit `engagement` rubric anchors to anchor on logical example progression (not "reader can't put down").
- Re-run 2-3 small experiments on the same Federal Reserve prompt to confirm deltas improve.

**Phase 2 (if Phase 1 confirms improvement, ~2 hours code + test):**
- Code change: add length-preservation instruction to `buildCustomPromptFromSuggestions` in `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts:253-268`. Suggested addition: "Aim to preserve current word count (±10%) while improving the targeted criteria. Do not add new sections or examples; deepen or refactor existing ones."
- Update `evolution/scripts/seedSampleCriteria.ts` so the `npm run seed:criteria` script's POV + engagement rubrics use the new wording.

**Phase 3 (optional, if researchers want diverse content support):**
- Add an article-type field or split criteria into "educational" vs "opinion" rubric sets.
- Diversify the test set beyond the Federal Reserve article before drawing broader conclusions.

## Phase 1 Pre-Edit Snapshot (rollback insurance — 2026-05-03)

Captured from staging before admin-UI rubric edits. If Phase 1 needs to revert, paste these values back into the admin UI for each criterion.

### `point_of_view` (id: `226aa0f0-7280-4733-947a-b8227f1e59f8`)

- **min_rating**: 1
- **max_rating**: 10
- **description**: `Whether the article takes a clear stance or perspective rather than enumerating facts neutrally.`
- **evaluation_guidance**:
  - Score 1: `Pure enumeration; no perspective; reads like a Wikipedia summary.`
  - Score 5: `Implicit perspective; takes occasional positions but mostly neutral.`
  - Score 10: `Clear thesis or perspective; the article argues for something specific.`

### `engagement` (id: `d18c3316-9a36-424e-b0d3-e17655b06c9a`)

- **min_rating**: 1
- **max_rating**: 10
- **description**: `How well the article holds reader attention from start to finish.`
- **evaluation_guidance**:
  - Score 1: `No hook; reader bounces in the first paragraph.`
  - Score 5: `Mild interest; pacing flat or uneven.`
  - Score 10: `Compelling throughout; reader can't stop until the end.`

### Drain check (2026-05-03)

`SELECT id FROM evolution_runs WHERE status IN ('claimed','running') AND id IN (SELECT DISTINCT run_id FROM evolution_agent_invocations WHERE agent_name='evaluate_criteria_then_generate_from_previous_article')` returned **0 rows** — safe to edit without contaminating in-flight runs.

## Investigation Audit Trail

4 rounds × 4 Explore agents (16 total agent invocations on staging via `npm run query:staging`):

- **Round 1**: Inventory criteria runs + per-invocation breakdown + Elo delta vs siblings + agent code reading. Surfaced the -47 Elo headline and the POV-focus pattern.
- **Round 2**: Suggestion-vs-result diff (worst 5 variants), POV rubric deep-dive (smoking gun), pool-mode parent Elo distribution, logs + judge confidence. Confirmed POV rubric misconfiguration; produced (later refuted) RTM claim.
- **Round 3**: Best-performing variants (inverse view), depth + engagement rubric deep-dive, customPrompt rendered + bloat pattern, reflection-vs-criteria comparison. Showed agent can work surgically; engagement also misconfigured; bloat invited by customPrompt asymmetry; reflection bloats more but works.
- **Round 4**: Never-focused rubric check (clarity/structure/tone/sentence_variety all OK), reflection sourceMode comparison (refuted RTM claim — both use pool), counterfactual scenario modeling, code-level recommendations.

## Post-Merge Analysis (2026-05-05)

After PR #1032 merged and Phase 1 + Phase 2 changes shipped, ran 3 additional staging batches and quantitative analyses to validate the fix's behavior in the wild. **The headline finding shifted: the original "-47 Elo structural underperformance" framing was misleading. The typical (median) variant is roughly Elo-neutral; the negative mean is driven by a long-tail of catastrophic failures, not pervasive weakness.**

### Phase 2 staging validation (5 runs, n=90, original 7-criteria strategy)

After the customPrompt code change deployed via the merge, re-ran the same strategy. All 4 multi-signal indicators stayed favorable vs Phase 1:

| Signal | Pre-edit | Phase 1 (rubrics only) | Phase 2 (+ customPrompt) |
|--------|---------:|-----------------------:|--------------------------:|
| n | 95 | 92 | 90 |
| Mean Elo Δ | -47 | -36 | **-27.8** |
| Mean length ratio | 1.118 | 1.079 | 1.096 |
| Min length ratio | — | 0.924 | 0.948 |
| Max length ratio | — | 1.432 | 1.419 |
| POV focus rate | 96.8% | 77.2% | **71.1%** |
| Operational success | 96.9% | 100% | 100% |

The customPrompt change reclaimed an additional ~+8 Elo on top of the rubric reframing's ~+11 Elo. Cumulative trajectory: **-47 → -36 → -27.8 Elo (42% of original gap closed).**

### Limited-criteria experiment (5 runs, n=99, 4 criteria + weakestK=1)

Strategy: only 4 well-configured criteria (depth, sentence_variety, structure, tone) — POV and engagement deliberately omitted; weakestK reduced from 2 to 1.

| Signal | Phase 2 (7-crit, k=2) | **Limited (4-crit, k=1)** |
|--------|-----------------------:|---------------------------:|
| n | 90 | 99 |
| Mean Elo Δ | -27.8 | **-28.7** (≈ same) |
| Mean length ratio | 1.096 | **1.053** (best yet) |
| Max length ratio | 1.419 | **1.217** (much tighter) |
| Most-focused criterion | POV 71.1% | depth 57.4% |
| Parse failures | 0% | 2/101 (~2%) |

Removing POV/engagement + tightening k=1 produced the most surgical, conservative rewrites of any config tested. **Mean Elo plateaued ~-28 Elo regardless.** The 2 parse failures came from the LLM-vs-wrapper "weakest pick" disagreement (with k=1, the wrapper has a tighter target and mismatches happen more often).

### Suggestion-text profile (n=1473 LLM-generated suggestions across all 3 batches)

| Field | Mean chars | Notes |
|-------|-----------:|-------|
| `examplePassage` (quoted from parent) | 256 | ~50 words / 2-3 sentences |
| `whatNeedsAddressing` (issue) | 156 | ~30 words / 1-2 sentences |
| `suggestedFix` (instruction) | 208 | ~40 words / 1-2 sentences |
| **Total per suggestion** | **620** | ~120 words |

Across all batches: LLM produces ~5 suggestions per invocation, wrapper keeps ~3 and feeds them to the inner generator (drops ~2 because the LLM picked criteria the wrapper hadn't designated as weakest). **Each variant is rewritten from ~3 × 620 = ~1860 chars (~370 words) of structured guidance** — substantially more prescriptive than reflection's tactic prompts (~150-200 char preambles).

### Sentence-level parent-vs-child diff (n=281 across all 3 batches)

Initial paragraph-level diff overstated change rate (paragraph granularity is binary — a single edited sentence flips the whole paragraph as "changed"). Sentence-level analysis is far more accurate.

| Bucket | Mean % CHILD verbatim | Median % CHILD verbatim | Median % PARENT preserved |
|--------|---------------------:|------------------------:|--------------------------:|
| Phase 1 (7-crit, k=2) | 70.9% | 83.0% | 89.3% |
| Phase 2 (+customPrompt) | 74.2% | 81.0% | 87.8% |
| Limited (4-crit, k=1) | 71.9% | **86.1%** | **91.2%** |

**The typical (median) variant changes only ~14-19% of sentences.** Mean is higher (~25-29% changed) due to a long tail of near-total rewrites. The Limited config produced the most conservative changes (median 86.1% verbatim).

### Elo Δ percentile distribution by rewrite bucket (n=281, sentence-level)

The crucial diagnostic. Bucketing variants by sentence-level verbatim share:

**Overall (n=281):** mean **-30.8**, p10 -108.6, p25 -58.8, **p50 -6.5**, p75 -0.5, p90 +4.9

| Bucket | n | Mean | p10 | p25 | Median | p75 | p90 |
|--------|---|-----:|----:|----:|-------:|----:|----:|
| 0-20% verbatim (full rewrite) | 22 | **-68.9** | -165.4 | -112.8 | -60.2 | -12.3 | +4.5 |
| 20-40% verbatim | 16 | -30.0 | -59.1 | -55.2 | -51.1 | -1.4 | +40.7 |
| 40-60% verbatim | 23 | -17.3 | -57.1 | -47.7 | -4.4 | +1.5 | +20.5 |
| 60-80% verbatim (moderate edit) | 54 | -28.0 | -91.5 | -57.5 | -5.0 | -1.0 | +4.6 |
| 80-90% verbatim (light edit) | 102 | -29.0 | -91.8 | -58.7 | -3.8 | -0.4 | +3.2 |
| 90-95% verbatim (very light edit) | 60 | -28.6 | -96.9 | -57.4 | -6.6 | -0.7 | +2.5 |
| 95-100% verbatim (nearly unchanged) | 4 | -22.5 | -77.0 | -62.2 | -27.2 | +12.4 | +35.7 |

**Two distinct failure modes are now visible:**

1. **Failure mode A — rewrite disasters** (0-20% verbatim, n=22, ~8% of samples). p25 -113, mean -69. These are the long-tail outliers. Killable with a sentence-overlap guardrail (e.g., reject any rewrite where < 50% of sentences are byte-identical from parent).

2. **Failure mode B — structural left-tail** (~25% of all samples in light-edit buckets). p25 ≈ -50 to -60 Elo across the 60-95% verbatim range. **These variants made small, targeted edits but the judge still scored them ~50+ Elo worse than parent.** This is a quality-of-suggestion problem, not a rewrite-scope problem — and it's the bigger contributor (~70 variants vs ~22).

**Counterfactual: dropping the most-rewritten N% of variants:**

| Drop bottom | Threshold verbatim ≥ | n kept | Mean Δ Elo | Median Δ Elo |
|-------------|---------------------:|-------:|------------:|-------------:|
| 0% | 0.0% | 281 | -30.8 | -6.5 |
| 5% | 5.1% | 267 | -28.3 | -4.4 |
| 10% | 33.6% | 253 | -27.4 | -4.4 |
| **15%** | **43.7%** | 239 | **-26.9** | -4.0 |
| 20% | 55.1% | 225 | -28.3 | -4.0 |
| 30% | 73.1% | 197 | -28.1 | -3.9 |
| 50% | 83.4% | 141 | -29.1 | -4.4 |

Killing the 15% most-rewritten variants buys **+4 Elo on the mean** (from -30.8 to -26.9). The median improves from -6.5 → -4.0 just by dropping the bottom 15%. Beyond that, dropping more variants doesn't help — the typical-case Elo Δ is structurally stuck at -4 to -5 Elo.

### Updated improvement recommendations (post-data)

The original "structural Elo ceiling" framing turned out to be misleading. The data now points to two separable problems:

**HIGH-IMPACT, LOW-EFFORT** (target failure mode A):

1. **Sentence-overlap guardrail.** Post-generation check: split parent and child into sentences (regex `[.!?][""”’]?\s|$`), compute byte-identical overlap, reject any rewrite < 50% verbatim. Either retry with the same suggestions or fall back to the parent. **Expected impact: +4-6 Elo on the mean, kills the 22-variant disaster bucket entirely.**

2. **Pre-tell the LLM the wrapper's pick.** Eliminates the ~45% suggestion-drop rate by inverting evaluation order (wrapper picks weakest first via fast scoring call, then prompts a focused suggestion call). Side benefit: kills the parse-failure mode entirely.

3. **Stronger "preserve most paragraphs" directive in customPrompt.** Add explicit budget: "modify only 2-3 specific sentences per fix; do not rewrite surrounding paragraphs." Encourages the median behavior (already pretty good), discourages the tail.

**MEDIUM-IMPACT, MEDIUM-EFFORT** (target failure mode B):

4. **Investigate the structural left-tail.** What's special about variants that made light edits but lost -50+ Elo? Possibilities: misaligned suggestions (LLM picked wrong fix even with right rubric), specific criteria that produce bad suggestions even on well-aligned rubrics, judge biases against specific edit patterns. Drill-down required.

5. **Try a stronger evaluator model.** Currently same gpt-4.1-nano runs evaluation and generation. Adding `evaluationModel?: string` to StrategyConfig (defaulting to `generationModel`) would let researchers A/B with `gpt-4.1-mini` or `claude-sonnet-4` for the evaluate-and-suggest call.

6. **Diversify the test set.** All current data is on one prompt (Federal Reserve, factual). The agent might shine on opinion or narrative content where "fix point of view" suggestions are more natural. Pick 3 prompts spanning factual / explainer / opinion.

**LARGER STRUCTURAL CHANGES** (only if 1-3 don't close the gap):

7. **Criteria → tactic mapping.** Replace customPrompt path with reflection-style tactic selection. Weakest criterion → tactic mapping → vanilla GFPA dispatch. Reuses well-tested tactic infrastructure; loses some user-defined criteria flexibility.

8. **Single-call evaluate-and-rewrite.** Halve LLM calls. Have the LLM do score + rewrite in one go with suggestions baked in as scratch-pad reasoning. More coherent, less wrapper-vs-LLM friction.

### What changed in the framing post-data

| Before | After |
|--------|-------|
| "-47 Elo mean delta = pervasive structural underperformance" | "-31 Elo mean = -7 Elo median + long tail of -100+ Elo failures" |
| "Methodology fundamentally produces 'patched' variants" | "Most variants make ~14-19% sentence changes — quite surgical. Methodology isn't broken; failure modes are." |
| "Need to switch to tactic-driven approach to fix structural ceiling" | "Two distinct failures: (A) rewrite disasters (kill with overlap guardrail), (B) light-edit left-tail (separate root cause TBD). Quick wins available." |
| "Each criteria-driven variant rewrites ~50% of the article" | "PARAGRAPH-level diff overstated change. SENTENCE-level: median ~14-19% changed, mean ~25-29% (long tail)." |
