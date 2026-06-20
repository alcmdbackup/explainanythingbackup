# Generate Enforce Style Fingerprint Evolution Research

## Problem Statement
Generate a style fingerprint in a piece and make it enforceable on article generation. The fingerprint is a short but accurate description of a writer's style (sentence length, American vs. British terms, idiosyncratic words/phrases, etc.). It will later be injected into a generation prompt to guide article generation and into a rubric to help judge stylistic accuracy vs. expectation.

## Requirements (from GH Issue #NNN)
Compute up with a short but accurate description of a writer's style

Note things like sentence length, American vs. British terms, etc. See what matters and then document it.

Note idiosycratic words/phrases that the author uses, but don't overuse them

This will later be injected into a prompt to guide generation, and into a rubric to help judge stylistic accuracy vs. expepctation

## High Level Summary

**This is primarily an EVOLUTION-PIPELINE feature, not a main-app feature.** The feature's "a piece" = the parent/seed article that evolution's `generate_from_previous_article` rewrites from. The main app (`returnExplanation`) generates from a *query/title*, not from a source article (sources there are for citation grounding, not voice mirroring), so it has no natural "source piece" to fingerprint. We confirmed clean injection points already exist in the evolution pipeline for all three legs: (1) extract fingerprint from the source, (2) inject into generation prompt, (3) inject into judging rubric.

The shape of the work:
1. **Extract** a compact style fingerprint from the source article via one standalone LLM call (new `EvolutionLLMClient` call with a new `AgentName` cost label + a Zod `StyleFingerprint` schema), triggered once per run right after `resolveContent()` makes the source text available — before the iteration loop.
2. **Store** it as a JSONB column on `evolution_runs` (idempotent `ADD COLUMN IF NOT EXISTS`, GIN index optional), regen DB types, add to the run Zod schema.
3. **Thread** it via `AgentContext.styleFingerprint` (populated in `claimAndExecuteRun`/run-context build) down to the generation agent input.
4. **Inject into generation** by adding an optional style-guide section to `buildEvolutionPrompt` (between `instructions` and `FORMAT_RULES`), fed from the fingerprint.
5. **Inject into judging** by adding a `stylistic_accuracy` `evolution_criteria` row (name is constraint-legal) referenced as a rubric dimension — the recommended path is data-driven (criteria row + `evolution_judge_rubric_dimensions` junction) requiring near-zero judge-code change, with the fingerprint text supplied as the "expectation" the dimension scores against.

Key design tension to resolve in planning: the rubric judge is *pairwise* (A vs B) and criteria `evaluation_guidance` anchors are *static* prose, whereas the style fingerprint is *per-run dynamic*. So the fingerprint must reach the judge prompt as runtime context (like the parent text), not baked into the static criterion anchors. This is the main open architectural question (see Open Questions).

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

### Relevant Docs (evolution + feature deep dives)
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/editing_agents.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/criteria_agents.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md
- docs/feature_deep_dives/judge_evaluation.md
- docs/feature_deep_dives/search_generation_pipeline.md
- docs/feature_deep_dives/writing_pipeline.md
- (also reviewed: evolution/docs/{README,arena,metrics,evolution_metrics,entities,variant_lineage,multi_iteration_strategies,curriculum,prompt_editor,cost_optimization}.md)

## Code Files Read

### Generation prompt assembly (evolution)
- `evolution/src/lib/pipeline/loop/buildPrompts.ts` — `buildEvolutionPrompt(preamble, textLabel, text, instructions, feedback?)` builds `preamble → ## <label> → text → feedback → ## Task → instructions → FORMAT_RULES → "Output ONLY…"`. **Injection point:** add an optional `styleGuide?` param rendered between `instructions` and `FORMAT_RULES`. (verified)
- `evolution/src/lib/core/agents/generateFromPreviousArticle.ts` — `buildPromptForTactic(text, tactic)` and the `execute()` generation branch: `const prompt = input.customPrompt ? buildEvolutionPrompt(customPrompt.preamble,'Original Text',parentText,customPrompt.instructions) : buildPromptForTactic(parentText,tactic)` then `llm.complete(prompt,'generation',…)`. `GenerateFromPreviousInput` already carries `customPrompt?`, `criteriaSetUsed?`, `weakestCriteriaIds?` — add `styleFingerprint?`.
- `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` — `buildCustomPromptFromSuggestions()` builds `{preamble, instructions}`; `buildEvaluateAndSuggestPrompt()` renders criteria name/description/range + `evaluation_guidance` anchors into the eval prompt.
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts` — `PROPOSER_SOFT_RULES` hardcodes "Preserve the author's voice, tone, and reading level." — today's only style handling; a fingerprint would make this dynamic.
- `evolution/src/lib/core/types.ts` — `AgentContext` (carries `db, runId, config, rawProvider?, defaultModel?, promptId?, experimentId?, strategyId?`, etc.); **add `styleFingerprint?`**.
- `evolution/src/lib/schemas.ts` — `iterationConfigSchema` / `strategyConfigSchema` (has `criteriaIds?`, `generationGuidance?` (mutually exclusive w/ criteriaIds), `judgeRubricId?`, `paragraphJudgeRubricId?`); `evolutionRunFullDbSchema`; criteria insert schema with `name.regex(/^[A-Za-z][a-zA-Z0-9_-]*$/)`; `evaluationGuidanceAnchorSchema` (template for a new `styleFingerprintSchema`).

### Judging / rubric / criteria
- `evolution/src/lib/shared/rubricJudge.ts` — `buildRubricComparisonPrompt()` maps `rubric.dimensions` → numbered blocks `"${i+1}. ${name}${desc}${tierAnchors}"`; per-dimension verdict contract `"${name}: <A|B|TIE>"`. **Judge is pairwise.**
- `evolution/src/lib/shared/judgeRubrics.ts` — static `ARTICLE_SANDBOX_RUBRIC` / `PARAGRAPH_SANDBOX_RUBRIC` (sandbox/Match-Viewer only); production rubric dimensions come from DB.
- `evolution/src/services/judgeRubricActions.ts` — `getJudgeRubricForEvaluation(db, rubricId)` resolves dimensions from `evolution_judge_rubrics` + `evolution_judge_rubric_dimensions` junction, filters archived/soft-deleted criteria, re-normalizes weights.
- `supabase/migrations/20260503033102_create_evolution_criteria.sql` — `evolution_criteria` table; **name CHECK `^[A-Za-z][a-zA-Z0-9_-]{0,128}$`** (verified, line 88); `evolution_criteria_rubric_anchors_in_range()` IMMUTABLE fn validates anchors within `[min_rating,max_rating]`.
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — `resolveContent()` returns source `originalText` (`explanations.content` for explanation runs; arena seed / `CreateSeedArticleAgent` for prompt runs); rubric resolution gated by `EVOLUTION_RUBRIC_JUDGING_ENABLED !== 'false'`. **Extraction hooks here / right after.**

### Extraction + storage plumbing
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — `client.complete(prompt, agentName, options?)`; cost via `costTracker.reserve()`→`recordSpend()`; per-agent cost metric via `COST_METRIC_BY_AGENT[agentName]` + `writeMetricMax`.
- `evolution/src/lib/core/agentNames.ts` — `AGENT_NAMES` union (verified). **Add a `style_extraction` label** (+ decide cost metric mapping; seed-phase labels roll into `seed_cost`).
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — orchestrates claim → `resolveContent()` → iteration loop; **extraction call + `UPDATE evolution_runs SET style_fingerprint=…` go here before the loop**.
- `supabase/migrations/20260503033104_evolution_variants_criteria_columns.sql` — template for idempotent `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS … USING GIN`.
- DB types regen via `npm run db:types` → `src/lib/database.types.ts`.

### Main-app generation (confirmed largely out of scope)
- `src/lib/services/returnExplanation.ts` — `returnExplanationLogic` → `generateNewExplanation` → `callLLM(formattedPrompt, "generateNewExplanation", …)`; prompts from `src/lib/prompts.ts` (`createExplanationPrompt`, `createExplanationWithSourcesPrompt`, `editExplanationPrompt`). `generateTitleFromUserQuery` is the structured-output (`callLLM` + Zod schema) template if a main-app extraction is ever added.
- `src/lib/services/llms.ts` — `callLLM`/`callLLMModelRaw`; system message hardcoded; OpenAI `json_schema` (strict) vs DeepSeek/OpenRouter `json_object` (not schema-enforced) split — relevant if a cheap model does the extraction.

## Key Findings
1. **Scope is the evolution pipeline.** The source "piece" is the parent/seed article; main-app generation has no source piece to fingerprint, so main-app changes are optional/out-of-scope for v1.
2. **Generation injection is a one-param change** to `buildEvolutionPrompt` plus threading `styleFingerprint` through `AgentContext` → `GenerateFromPreviousInput`. Both the tactic branch and the `customPrompt` branch must render it.
3. **Judging injection is best done data-first:** a `stylistic_accuracy` `evolution_criteria` row + rubric-dimension junction needs near-zero judge code — BUT the per-run fingerprint (the "expectation") must be passed to the judge prompt as runtime context, since criteria anchors are static. This is the one non-trivial code change on the judging side.
4. **Name constraint confirmed:** `stylistic_accuracy` (or `style_fidelity`) is legal; `[anything]` / spaces are not (matches reference memory).
5. **One new storage column** (`evolution_runs.style_fingerprint JSONB`) + Zod schema + types regen; idempotent migration pattern exists.
6. **One new `AgentName`** (`style_extraction`) for cost attribution; decide whether its cost rolls into `seed_cost` or a dedicated metric.
7. **Extraction is a single standalone LLM call** using the existing `EvolutionLLMClient`, triggered once per run after `resolveContent()` — cheap, cached on the run, reused across all iterations and both legs (generation + judging).
8. **Anti-overuse requirement** ("note idiosyncratic words/phrases but don't overuse them") must be encoded as an explicit directive in BOTH the generation prompt ("use sparingly, do not force") and the rubric anchors (penalize over-saturation), not just listed as phrases to inject.

## Open Questions
1. **Fingerprint → judge wiring:** how should the per-run fingerprint reach `buildRubricComparisonPrompt`? Options: (a) thread it as runtime context appended to the rubric prompt; (b) store it on each variant and let the judge compare each variant's adherence; (c) phase 1 = generation-only, judging in a follow-up. Recommend (a).
2. **Fingerprint representation:** structured JSONB (`{sentenceLength, spellingRegion, signaturePhrases[], tone, …}`) vs. a single prose paragraph vs. both (structured for metrics + a rendered prose block for prompts). Affects schema + prompt rendering.
3. **Config surface:** is style enforcement always-on per run, or opt-in via a strategy/iteration config flag (e.g. `styleFingerprintEnabled`)? A flag keeps A/B isolation clean and lets the acceptance gate measure effect.
4. **Cost label/metric:** dedicated `style_extraction_cost` metric vs. rolling into `seed_cost`.
5. **Prompt-based (no source) runs:** when there's no parent article (pure prompt runs that generate a seed), is there a piece to fingerprint at all? Likely: skip extraction, no-op the injection.
6. **Acceptance/measurement:** what's the success metric — a `stylistic_accuracy` rubric score lift, a held-out style-match eval, or human spot-check? Ties to the project's eventual gate.
7. **Main-app scope:** confirm with user whether main-app generation is explicitly out of scope for this project.
