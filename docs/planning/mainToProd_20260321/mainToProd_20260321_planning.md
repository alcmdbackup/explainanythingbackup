# Main To Prod Plan

## Background
Standard merge of main (staging) branch into production branch. This ensures all validated staging changes are promoted to production with proper conflict resolution and CI validation.

## Requirements (from GH Issue #NNN)
- Merge main into production, resolve conflicts (preferring main)
- Run all checks (lint/tsc/build/unit/integration)
- Create PR

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
- `evolution/docs/evolution/README.md` - Evolution pipeline overview
- `evolution/docs/evolution/architecture.md` - Pipeline architecture
- `evolution/docs/evolution/data_model.md` - Core data model
- `evolution/docs/evolution/arena.md` - Arena system
- `evolution/docs/evolution/rating_and_comparison.md` - Rating system
- `evolution/docs/evolution/agents/overview.md` - V2 operations
- `evolution/docs/evolution/reference.md` - Reference docs
- `evolution/docs/evolution/cost_optimization.md` - Cost tracking
- `evolution/docs/evolution/visualization.md` - Admin UI
- `evolution/docs/evolution/strategy_experiments.md` - Experiments
- `evolution/docs/evolution/experimental_framework.md` - Metrics framework
- `evolution/docs/evolution/entity_diagram.md` - Entity relationships
- `evolution/docs/evolution/curriculum.md` - Learning curriculum
- `evolution/docs/evolution/minicomputer_deployment.md` - Deployment guide
