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
