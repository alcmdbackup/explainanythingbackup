# Remove Ordinals Replace With Mu Evolution Plan

## Background
Remove ordinal (mu - 3*sigma) as the ranking/display metric throughout the evolution pipeline. Replace all ordinal usage with pure mu for sorting, Elo scale conversion, and persistence. The ordinal function penalizes uncertainty, which is already communicated via sigma/CI — baking it into the point estimate double-counts uncertainty.

## Requirements (from GH Issue #NNN)
Completely get rid of concept of ordinals from codebase. Replace with mu everywhere for evolution ranking.

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
- `evolution/docs/evolution/rating_and_comparison.md` - Update ranking description from ordinal to mu
- `evolution/docs/evolution/arena.md` - Update ordinal column references
- `evolution/docs/evolution/visualization.md` - Update ordinal-to-Elo scale references
- `evolution/docs/evolution/data_model.md` - Update avg_elo description
- `evolution/docs/evolution/reference.md` - Update config/schema references
- `evolution/docs/evolution/experimental_framework.md` - Update scale consistency section
