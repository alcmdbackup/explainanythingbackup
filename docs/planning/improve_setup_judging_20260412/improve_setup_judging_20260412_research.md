# Improve Setup Judging Research

## Problem Statement
Improve the evolution pipeline's setup and judging by adding cheap judge models (Qwen 8B, Google), centralizing model configuration into a registry with max temperature validation, setting judge temperature to 0, adding configurable generation temperature to strategy config, and changing OpenSkill beta to 0.

## Requirements (from GH Issue #TBD)
- Change beta to 0 in my Openskill implementation
- I want to speed up judging for evolution. Add want to add two models - Qwen 8b, a Google one. Both cost around $.10 per M input or less. Help me find these actual models and add support for these in my evolution system, including in model dropdown list on strategy creation.
- Refactor to consolidate my model information into a central model registry.
    - Add my 2 new models to this registry
    - Add maximum temperature into this model registry
- Set temperature to 0 for all models when they are used as judges
- Add the ability to configure (optionally) a generation temperature for generation models, from the strategy config. Make sure to find the max temperature for all of our available models and add them to our model registry, to validate the user's input from the strategy creation screen to make sure temp is a valid value.

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/cost_optimization.md
- evolution/docs/entities.md
- evolution/docs/metrics.md
- evolution/docs/logging.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/agents/overview.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/testing_setup.md

## Code Files Read
- src/config/llmPricing.ts
- src/lib/services/llms.ts
- [list of code files reviewed]
