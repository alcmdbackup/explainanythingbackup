# Agent Comparison Analysis Evolution Plan

## Background
Investigate and document how agent efficiency comparisons work in the evolution dashboard, specifically the Explorer > Agents average rating view and the Optimization > Agent Analysis ROI leaderboard. Clarify the methodology behind each metric (avg Elo per agent, Elo gain, Elo per dollar), identify any gaps or inconsistencies in how ratings are computed and attributed, and propose improvements to make agent comparison more actionable for optimizing pipeline configurations.

## Requirements (from GH Issue)
- [ ] Explorer > Agents > average rating — understand what avg_elo means, how it's computed per agent
- [ ] Optimization > Agent Analysis — understand the ROI leaderboard methodology
- [ ] Document the data flow from pipeline execution → agent metrics → dashboard display
- [ ] Identify gaps or improvements in agent comparison methodology

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
- `evolution/docs/evolution/rating_and_comparison.md` - May need clarification on how ratings are attributed to agents
- `evolution/docs/evolution/architecture.md` - Agent interaction patterns relevant to metric computation
- `evolution/docs/evolution/data_model.md` - Agent metrics table schema and data flow
- `evolution/docs/evolution/hall_of_fame.md` - Cross-method comparison methodology
- `evolution/docs/evolution/cost_optimization.md` - Agent ROI computation and dashboard
- `evolution/docs/evolution/strategy_experiments.md` - Factor analysis of agent impact
- `evolution/docs/evolution/visualization.md` - Dashboard views for agent analysis
- `evolution/docs/evolution/README.md` - Entry point documentation
