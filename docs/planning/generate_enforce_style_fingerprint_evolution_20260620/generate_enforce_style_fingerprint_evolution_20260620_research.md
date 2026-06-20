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
1. **Fingerprint is a first-class, reusable entity** (NOT a per-run blob — see "Additional Requirements" below): its own table, computed over a *set* of one-or-more source articles, independently saveable, and incrementally updatable by adding an article to its set. A run/strategy *references* a fingerprint by id rather than computing a throwaway one.
2. **Extract/compute** the fingerprint from the article set via a standalone `EvolutionLLMClient` call (new `AgentName` cost label + Zod `StyleFingerprint` schema). This runs at fingerprint-create/update time (CRUD), and is reused by any run that references the fingerprint — decoupled from the per-run loop.
3. **Thread** the resolved fingerprint into a run via `AgentContext.styleFingerprint` (populated in `claimAndExecuteRun`/run-context build from the referenced fingerprint id) down to the generation agent input.
4. **Inject into generation** by adding an optional style-guide section to `buildEvolutionPrompt` (between `instructions` and `FORMAT_RULES`), fed from the fingerprint's rendered prose.
5. **Inject into judging** by adding a `stylistic_accuracy` `evolution_criteria` row (name is constraint-legal) referenced as a rubric dimension — the recommended path is data-driven (criteria row + `evolution_judge_rubric_dimensions` junction) requiring near-zero judge-code change, with the fingerprint prose supplied as the "expectation" the dimension scores against.

Key design tension to resolve in planning: the rubric judge is *pairwise* (A vs B) and criteria `evaluation_guidance` anchors are *static* prose, whereas the style fingerprint is *per-run dynamic* (varies by which fingerprint the run references). So the fingerprint must reach the judge prompt as runtime context (like the parent text), not baked into the static criterion anchors. This is the main open architectural question (see Open Questions).

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
5. **New fingerprint entity + junction tables** (`evolution_style_fingerprints` + `evolution_style_fingerprint_articles`) following the DB-first entity pattern (`evolution_prompts`/`evolution_criteria`) — CRUD via `executeEntityAction`, Zod schemas, types regen. A run/strategy references it by `styleFingerprintId`. (Supersedes the earlier single-column idea — see Additional Requirements.)
6. **One new `AgentName`** (`style_extraction`) for cost attribution; decide whether its cost rolls into `seed_cost` or a dedicated metric.
7. **Extraction is a single standalone LLM call** using the existing `EvolutionLLMClient`, triggered once per run after `resolveContent()` — cheap, cached on the run, reused across all iterations and both legs (generation + judging).
8. **Anti-overuse requirement** ("note idiosyncratic words/phrases but don't overuse them") must be encoded as an explicit directive in BOTH the generation prompt ("use sparingly, do not force") and the rubric anchors (penalize over-saturation), not just listed as phrases to inject.

## Additional Requirements (added by user 2026-06-20)
The fingerprint must be a **first-class entity**, not a per-run side effect:
1. **Independently saveable** — a fingerprint exists on its own (its own table/CRUD), decoupled from any single run. Mirrors the existing DB-first entity pattern used by `evolution_prompts` / `evolution_criteria` (own table, soft-delete via `deleted_at`/status, CRUD via the `executeEntityAction` dispatcher, Zod insert schema).
2. **Computed over a SET of articles** — the input is one-or-more articles, not a single piece. Needs a fingerprint↔articles relationship (junction table). Open: an "article" = an `explanations` row reference vs. an arbitrary stored text blob vs. either (see Open Questions).
3. **Incrementally updatable** — adding a new article to an existing fingerprint's set updates both the underlying set (insert junction row) AND the fingerprint itself (recompute or merge). Open: full recompute over the enlarged set vs. true incremental merge (feed prior fingerprint + new article to the LLM) (see Open Questions).

**Data-model implication (revised from earlier single-column idea):**
- New table `evolution_style_fingerprints` — `id`, `name`, `fingerprint` JSONB (structured traits), `fingerprint_prose` TEXT (rendered for prompts) or render-on-read, `article_count`, `status`/`deleted_at`, audit cols. (Name likely wants a constraint-legal slug if it ever maps to a metric, like `evolution_criteria`.)
- New junction `evolution_style_fingerprint_articles` — `fingerprint_id`, plus either `explanation_id UUID` (FK) and/or `article_text TEXT` + ordering/added_at. GIN/btree indexes per existing migration patterns.
- A run/strategy references a fingerprint via a new `styleFingerprintId UUID` config field (instead of an inline per-run JSONB). The per-run JSONB column idea is superseded; the run only needs the *reference* (it can denormalize a snapshot if reproducibility-of-historical-runs matters — Open Question).
- Recompute path is the same standalone `EvolutionLLMClient` extraction call, now fed the concatenated/sampled article set and (for incremental) the prior fingerprint.

**Surfaces still to confirm:** admin UI for fingerprint CRUD (mirrors strategy/criteria registry pages under `/admin/evolution/*`) — in scope? The issue text implies compute+enforce; CRUD UI may be a follow-on. Flagged in Open Questions.

## Decisions (confirmed with user 2026-06-20)

### Earlier round
- **Scope:** Evolution pipeline only for v1. Main-app generation is explicitly out of scope.
- **Enforcement:** Per-strategy opt-in flag (e.g. `styleFingerprintEnabled`) so there's a clean control arm.
- **Representation:** Structured JSONB (`{sentenceLength, spellingRegion, signaturePhrases[], tone, …}`) for metrics PLUS a rendered prose block for prompts.

### Open-questions walkthrough (all 8 resolved)
- **Q1 Article identity:** Each set member is EITHER a DB reference (`explanation_id` FK) OR a pasted `article_text` blob. Junction supports both.
- **Q2 Update strategy:** Full recompute of the fingerprint over the enlarged set on each add (deterministic; no drift). Extraction is CRUD-time, infrequent.
- **Q3 Run binding:** Run stores `styleFingerprintId` AND a JSONB snapshot of the fingerprint at run start (reproducibility — later edits don't rewrite history).
- **Q4 Judge wiring:** Fingerprint reaches the judge as runtime context appended to the rubric prompt; one `stylistic_accuracy` criteria row + dimension junction; judge reads the run's snapshot.
- **Q5 Admin UI:** Full-featured UI in v1 — registry + per-fingerprint detail + article add/remove/reorder + edit + re-extract controls (`/admin/evolution/*`). Largest surface; needs E2E.
- **Q6 Cost:** Fingerprint-level cost metric (e.g. `total_extraction_cost`, mirroring criteria's `total_evaluation_cost`) via `llmCallTracking` + aggregate. Not rolled into run `seed_cost`.
- **Q7 No-op:** Fingerprints are authored entities only; a run with none referenced cleanly skips style injection (generation + judging unchanged). No auto-derivation from a run's own seed.
- **Q8 Acceptance:** Human spot-check only for v1 (no automated gate/held-out eval). The `stylistic_accuracy` rubric dimension still produces a score, but success is judged by eyeballing outputs.

> **Scope note:** Q5 (full UI) materially enlarges v1 — plan should phase it: entity+migration+schema → extraction → generation injection → judging → server actions → admin UI → E2E.

## Open Questions
_ALL RESOLVED — see the "Open-questions walkthrough" under Decisions above. Retained below for the rationale/options behind each resolution._

1. **Article identity — what goes in the set?** Each article in a fingerprint's set is: (a) a reference to an existing `explanations` row (`explanation_id` FK); (b) an arbitrary pasted text blob (`article_text`); or (c) either/both. Affects the junction schema and the CRUD/ingest surface.
2. **Incremental update strategy.** When an article is added to an existing fingerprint, do we (a) full-recompute the fingerprint over the enlarged set (simple, deterministic, more tokens), or (b) true incremental merge (feed prior fingerprint + new article to the LLM → updated fingerprint; cheaper, but can drift)? Affects extraction prompt design + cost.
3. **Run reference vs. snapshot.** Does a run store only `styleFingerprintId` (always reads the live fingerprint — simplest), or also denormalize a JSONB snapshot at run start (so a later fingerprint edit doesn't retroactively change what historical runs were judged against — reproducibility)? 
4. **Fingerprint → judge wiring.** How should the fingerprint reach `buildRubricComparisonPrompt`? (a) thread it as runtime context appended to the rubric prompt; (b) store it on each variant and let the judge score adherence; (c) phase 1 = generation-only, judging follow-up. Recommend (a).
5. **Admin CRUD UI scope.** Is a `/admin/evolution/*` fingerprint registry page (create/edit/add-article, mirroring strategy/criteria registries) in scope for v1, or is server-action/CRUD + wiring enough with UI as a follow-on?
6. **Cost label/metric.** Dedicated `style_extraction_cost` metric vs. rolling into `seed_cost`; and is extraction cost attributed to a run, or to the fingerprint entity (since it's computed outside any run)?
7. **Prompt-based (no source) runs.** When a run references no fingerprint (or a strategy opts out), injection is a clean no-op — confirm that's the only behavior, and that fingerprints are never auto-derived from a run's own seed (they're authored as entities).
8. **Acceptance/measurement.** Success metric — `stylistic_accuracy` rubric score lift vs. control arm, a held-out style-match eval, or human spot-check? Ties to the eventual acceptance gate.
