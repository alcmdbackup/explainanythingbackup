# Improve Agent Template Evolution Plan

## Background
We want to ensure we have a well-thought-out and extensible template for future agents which extends Entity. It should handle metrics and logging, declare parent variant(s) and child variants as output. It should also have a well-structured detail view that can be shown on invocation detail.

## Requirements (from GH Issue #NNN)
- Create a well-thought-out and extensible agent template that extends Entity
- Handle metrics and logging within the agent template
- Declare parent variant(s) as input and child variants as output
- Provide a well-structured detail view for invocation detail pages

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
- `evolution/docs/architecture.md` - may need updates to agent architecture section
- `evolution/docs/agents/overview.md` - likely needs major updates to reflect new agent template
- `evolution/docs/reference.md` - file inventory updates for new/modified files
- `evolution/docs/data_model.md` - if schema changes are needed for agent invocations
- `evolution/docs/strategies_and_experiments.md` - if strategy/agent interaction changes
- `evolution/docs/entities.md` - entity relationship updates
- `evolution/docs/README.md` - reading order may need adjustment
- `evolution/docs/cost_optimization.md` - if cost tracking changes for agents
- `evolution/docs/rating_and_comparison.md` - if ranking agent interface changes
- `evolution/docs/arena.md` - if arena loading/syncing is affected
