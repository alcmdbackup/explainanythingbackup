# More Evolution UI Cleanup Plan

## Background
A few additional improvements to evolution dashboard UI.

## Requirements (from GH Issue #TBD)
- [ ] Add a metrics tab to runs
- [ ] Set default budget at start of experiment creation to be 0.05
- [ ] Invocation detail page
    - [ ] Variants tab is currently broken in production
    - [ ] All agent types (including iterative editing) should show input and output variants as separate tabs
        - [ ] Each tab should have collapsible bars each containing the variant, which let you expand to read
    - [ ] Overview tab should have a "inputs/outputs" module which shows
        - [ ] Input variants, elo and confidence intervals
        - [ ] Output variants, elo and confidence intervals
- [ ] Strategy overview list
    - [ ] For each run, also show 90p elo and max elo, along with confidence intervals
- [ ] Variants overview list
    - [ ] Should show confidence intervals for elo

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
- `evolution/docs/evolution/visualization.md` - May need updates for new metrics tab, invocation detail changes
- `evolution/docs/evolution/arena.md` - May need updates for confidence interval display
- `evolution/docs/evolution/data_model.md` - May need updates for new metrics fields
- `evolution/docs/evolution/architecture.md` - Reference for pipeline understanding
- `evolution/docs/evolution/reference.md` - May need updates for new actions/components
- `evolution/docs/evolution/experimental_framework.md` - May need updates for default budget change
- `docs/docs_overall/design_style_guide.md` - Reference for UI patterns
