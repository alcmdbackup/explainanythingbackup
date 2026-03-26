# Debug Run 3345a6ab In Stage Producing 4 Variants 1200 Elo Only Plan

## Background
Debug why evolution run 3345a6ab in staging is producing only 4 variants all stuck at 1200 Elo, indicating ranking/rating is not working correctly.

## Requirements (from GH Issue #TBD)
1. Query run 3345a6ab data from staging database
2. Check variant count and Elo values
3. Inspect ranking logs for errors or skipped phases
4. Identify root cause of why variants are not being rated
5. Fix and verify the issue

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
- `evolution/docs/architecture.md` - May need updates if pipeline flow is changed
- `evolution/docs/arena.md` - May need updates if arena sync is affected
- `evolution/docs/rating_and_comparison.md` - May need updates if rating logic is fixed
- `docs/docs_overall/debugging.md` - May add new debugging guidance
- `evolution/docs/strategies_and_experiments.md` - May need updates if strategy config is involved
- `evolution/docs/data_model.md` - May need updates if schema changes are needed
- `evolution/docs/cost_optimization.md` - May need updates if budget tracking is involved
- `docs/feature_deep_dives/evolution_logging.md` - May need updates if logging changes
