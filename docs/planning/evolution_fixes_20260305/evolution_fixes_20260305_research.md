# Evolution Fixes Research

## Problem Statement
The evolution experiment system has several UX and architectural issues that reduce pipeline quality and usability. Budget should be set once at the experiment level rather than per-run, the "optimizing for" dropdown is unnecessary, experiment names shouldn't influence prompt names, strategy reuse needs confirmation, the model list is missing GPT-5 models, per-agent budgets should be eliminated, and runs should always exhaust their full budget rather than stopping early.

## Requirements (from GH Issue #NNN)
- [ ] Set budget for each per run once at experiment level - rather than for each run
- [ ] Get rid of "optimizing for" dropdown within experiment creation and eliminate anything associated to it
- [ ] Why does experiment name influence prompt name
- [ ] Confirm runs re-use strategies if they already exist
- [ ] List of available models available within experiment UI does NOT include GPT-5 models. Make sure we have canonical model set.
- [ ] Eliminate per agent budgets
- [ ] Make sure run always goes until full budget is exhausted

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md

## Code Files Read
- [list of code files reviewed]
