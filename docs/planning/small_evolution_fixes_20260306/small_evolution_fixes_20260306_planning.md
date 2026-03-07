# Small Evolution Fixes Plan

## Background
Have a few small fixes I want to make for evolution.

## Requirements (from GH Issue #NNN)
- [ ]  Ability to hide prompts, prevent from displaying in "start experiment" and in arena
    - [ ]  See if this is already on stage
- [ ]  Run detail page should show the strategy used
- [ ]  Arena page bugs
    - [ ]  Leaderboard should show experiment and strategy for a given variant
    - [ ]  Elo sometimes sits outside confidence intervals - **1547 vs.** 1633–1956
    - [ ]  Chart on cost vs. rating tab seems buggy - should be scatter plot, don't understand it
    - [ ]  Cost on leaderboard is wrong - it disagrees with cost from run

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
- `docs/feature_deep_dives/admin_panel.md` - Arena/prompt hiding, run detail strategy display
- `docs/docs_overall/design_style_guide.md` - UI changes if any
- `evolution/docs/evolution/visualization.md` - Run detail page changes
- `evolution/docs/evolution/arena.md` - Arena page bug fixes, leaderboard changes
- `evolution/docs/evolution/data_model.md` - Prompt hiding, strategy/experiment linkage
