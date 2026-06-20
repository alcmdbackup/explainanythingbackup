# Generate Enforce Style Fingerprint Evolution Research

## Problem Statement
Generate a style fingerprint in a piece and make it enforceable on article generation. The fingerprint is a short but accurate description of a writer's style (sentence length, American vs. British terms, idiosyncratic words/phrases, etc.). It will later be injected into a generation prompt to guide article generation and into a rubric to help judge stylistic accuracy vs. expectation.

## Requirements (from GH Issue #NNN)
Compute up with a short but accurate description of a writer's style

Note things like sentence length, American vs. British terms, etc. See what matters and then document it.

Note idiosycratic words/phrases that the author uses, but don't overuse them

This will later be injected into a prompt to guide generation, and into a rubric to help judge stylistic accuracy vs. expepctation

## High Level Summary
_To be populated during /research._

Initial orientation (from doc review during /initialize — file paths below are candidates to confirm during /research):

- **Generation prompt assembly (evolution):** style fingerprint would plug into the evolution prompt builder used for `generate_from_previous_article` / seed generation, and be threaded through the per-run agent context. Confirm the actual builder file/function and the strategy/iteration config surface.
- **Generation prompt assembly (main app):** `src/lib/services/returnExplanation.ts` (`returnExplanationLogic` → `generateNewExplanation`) and `src/lib/services/llms.ts` are the main-app generation path; the concrete prompt template injection point needs to be located by grep during /research.
- **Judging / rubric:** evolution rating/judge path builds comparison prompts (`buildComparisonPrompt` / `buildRubricComparisonPrompt`, judge rubrics module). Stylistic accuracy could be a new rubric dimension or an `evolution_criteria` row.
- **Criteria constraint:** `evolution_criteria.name` CHECK forbids brackets/spaces — a `stylistic_accuracy`-style criterion name must be alphanumeric/underscore/hyphen only.
- **Storage:** candidate is a JSONB style-fingerprint field cached per run (extracted once from the seed/source) and threaded to generation + judging.

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
_To be populated during /research._
