# Prod Evolution Budget Issue Debug Plan

## Background
Production evolution experiment runs are hitting budget exceeded errors because the total experiment budget ($0.50) is evenly split across all runs ($0.0625/run), which is too small for even a single iteration. Need to add a run preview to the experiment UI showing per-run budget, factor combinations, and strategy details before starting.

## Requirements (from GH Issue #TBD)
1. Add a run preview table/panel to ExperimentForm showing each L8 row with its factor values, strategy label, estimated cost, and per-run budget
2. Show the per-run budget calculation (totalBudget / numRuns) prominently with a warning when it's below a minimum threshold
3. Show redistributed per-agent budget caps for each run config (accounting for enabledAgents)
4. Surface which agents are active vs disabled per run
5. Leverage existing validateExperimentConfig() which already returns expandedConfigs

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
- `evolution/docs/evolution/strategy_experiments.md` - Add run preview UI docs
- `evolution/docs/evolution/cost_optimization.md` - Note budget warning feature
- `evolution/docs/evolution/visualization.md` - Document new experiment preview component
- `evolution/docs/evolution/reference.md` - Update key files section
