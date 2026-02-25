# Cost Accuracy Evolution Bug Plan

## Background
The Cost Accuracy tab in Ratings Optimization > Cost Accuracy > Per Agent Accuracy has a bug where many agents show one of either estimated or actual cost as zero while the other is non-zero. This shouldn't be possible — if an agent has an estimated cost, it should also have an actual cost (and vice versa).

## Requirements (from GH Issue #NNN)
There are many agents where one of either estimated or actual is zero, but the other is not. This shouldn't be possible.

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
- `evolution/docs/evolution/cost_optimization.md` - Cost accuracy dashboard and per-agent accuracy table
- `evolution/docs/evolution/reference.md` - Cost attribution and budget enforcement details
- `evolution/docs/evolution/architecture.md` - Pipeline cost flow
- `evolution/docs/evolution/data_model.md` - Agent invocation cost tracking
- `evolution/docs/evolution/agents/overview.md` - Per-agent cost tracking
- `evolution/docs/evolution/visualization.md` - Cost analytics actions and display
- `evolution/docs/evolution/rating_and_comparison.md` - Tournament/pairwise cost routing
- `docs/feature_deep_dives/metrics_analytics.md` - Metrics aggregation patterns
