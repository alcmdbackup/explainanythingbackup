# More Evolution UI Cleanup Research

## Problem Statement
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

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/experimental_framework.md
- docs/docs_overall/design_style_guide.md

## Code Files Read
- [list of code files reviewed]
