# Small Evolution Fixes Plan

## Background
Small fixes and improvements to the evolution pipeline dashboard. Focuses on evolution dashboard UX issues including experiment budget input handling, budget calculation refresh, and the ability to kill running pipeline runs from the admin UI.

## Requirements (from GH Issue #TBD)
- [ ] Ratings optimization > new experiment > budget should allow decimals. Should clearly label that it's per article. Should have a button that refreshes calculation when clicked.
- [ ] Rates optimization > new experiment > budget price not passed through correctly. Observed all runs start with budget of 5, rather than input number.
- [ ] Way to automatically kill a pipeline run from "start pipeline" tab - stop it and mark as failed

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
- `evolution/docs/evolution/hall_of_fame.md` - may need updates if experiment budget changes affect hall of fame workflows
- `evolution/docs/evolution/data_model.md` - may need updates if budget config or run config changes
- `evolution/docs/evolution/rating_and_comparison.md` - may need updates if rating optimization changes
- `evolution/docs/evolution/architecture.md` - may need updates for kill mechanism from start pipeline tab
