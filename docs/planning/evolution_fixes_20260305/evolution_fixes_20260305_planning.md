# Evolution Fixes Plan

## Background
The evolution experiment system has several UX and architectural issues that reduce pipeline quality and usability. Budget should be set once at the experiment level rather than per-run, the "optimizing for" dropdown is unnecessary, experiment names shouldn't influence prompt names, strategy reuse needs confirmation, the model list is missing GPT-5 models, per-agent budgets should be eliminated, and runs should always exhaust their full budget rather than stopping early.

## Requirements (from GH Issue #NNN)
- [ ] Set budget for each per run once at experiment level - rather than for each run
- [ ] Get rid of "optimizing for" dropdown within experiment creation and eliminate anything associated to it
- [ ] Why does experiment name influence prompt name
- [ ] Confirm runs re-use strategies if they already exist
- [ ] List of available models available within experiment UI does NOT include GPT-5 models. Make sure we have canonical model set.
- [ ] Eliminate per agent budgets
- [ ] Make sure run always goes until full budget is exhausted

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` - Pipeline overview may need updates for budget/agent changes
- `evolution/docs/evolution/architecture.md` - Phase transitions and budget enforcement changes
- `evolution/docs/evolution/data_model.md` - Experiment model changes
- `evolution/docs/evolution/reference.md` - Config defaults, budget caps, model list updates
- `evolution/docs/evolution/cost_optimization.md` - Per-agent budget removal, cost tracking changes
- `evolution/docs/evolution/arena.md` - Arena sync changes if budget model changes
- `evolution/docs/evolution/rating_and_comparison.md` - Tournament stopping conditions
- `evolution/docs/evolution/agents/overview.md` - Agent budget cap removal
- `evolution/docs/evolution/agents/generation.md` - Generation budget changes
- `evolution/docs/evolution/agents/editing.md` - Editing budget changes
