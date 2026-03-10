# Investigate Evolution Cost Estimation Overrun Plan

## Background
Run 223bc062 exceeded costs in production. The goal is to investigate whether better cost estimation could have prevented this overrun, understand how the estimation system worked for this run, and identify root causes in the cost estimation and budget tracking systems.

## Requirements (from GH Issue #NNN)
- Use supabase prod query tool to investigate how estimation worked for run 223bc062
- Use budget tracking table (evolution_budget_events) to see what happened during the run
- Write an evolution_budget deep dive document to cover how the estimation system works, if one doesn't already exist

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
- `evolution/docs/evolution/cost_optimization.md` - may need updates on estimation accuracy findings
- `evolution/docs/evolution/experimental_framework.md` - per-agent cost breakdown context
- `evolution/docs/evolution/reference.md` - budget cap configuration
- `evolution/docs/evolution/architecture.md` - pipeline cost flow
- `evolution/docs/evolution/agents/generation.md` - generation agent cost drivers
- `evolution/docs/evolution/data_model.md` - cost tracking data model
- `evolution/docs/evolution/rating_and_comparison.md` - comparison cost context
- `evolution/docs/evolution/agents/support.md` - support agent costs
- `evolution/docs/evolution/visualization.md` - cost visualization features
