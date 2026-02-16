# Over Budget Evolution Plan

## Background
Debug why evolution run [232a26c2] is over budget. The pipeline's budget enforcement mechanism (CostTracker with per-agent caps and global cap) should prevent runs from exceeding their budget, but this run appears to have spent more than allocated.

## Requirements (from GH Issue #NNN)
Investigate run 232a26c2, find where budget enforcement failed, and fix the root cause.

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
- `docs/evolution/cost_optimization.md` - Cost tracking and budget enforcement details
- `docs/evolution/reference.md` - Budget caps and configuration defaults
- `docs/evolution/architecture.md` - Pipeline architecture and budget flow
- `docs/evolution/strategy_experiments.md` - Strategy experiment cost constraints
- `docs/evolution/data_model.md` - Cost tracking data model
- `docs/evolution/agents/overview.md` - Agent budget enforcement patterns
- `docs/evolution/visualization.md` - Budget tab and cost visualization
- `docs/evolution/agents/generation.md` - Generation agent budget caps
- `docs/evolution/rating_and_comparison.md` - Comparison cost impact
- `docs/evolution/agents/tree_search.md` - Tree search budget cap
