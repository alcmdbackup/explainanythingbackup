# Small UI Fixes Plan

## Background
Small UI fixes for the evolution admin pages. The arena leaderboard needs to show Elo uncertainty and a top 15% cutoff indicator. The evolution runs list view has a cost display issue where costs are not updated. Additionally, variants in the arena leaderboard show very high Elo scores despite having no matches, which is misleading.

## Requirements (from GH Issue #NNN)
- Arena leaderboard should show elo uncertainty, in addition to mu and sigma
- Show a cutoff for top 15% - indicate using text at the top which entry is the 15% cutoff we use for ranking
- Cost not updated on evolution runs - in evolution list view
- Variants in arena leaderboard show very high elo despite no matches

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
- `evolution/docs/visualization.md` - May need updates for new leaderboard columns/indicators
- `evolution/docs/arena.md` - May need updates for Elo uncertainty display and 15% cutoff
- `evolution/docs/data_model.md` - May need updates if query changes are required
- `evolution/docs/metrics.md` - May need updates for cost display fixes
