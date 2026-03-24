# Small UI Fixes Evolution Dash Plan

## Background
Small UX fixes for the evolution dashboard. The runs and experiment history tables on the evolution dashboard overview use a different list layout than the rest of the admin pages. This project standardizes them to use the shared EntityListPage component, improves the visual appeal of the standardized list view, and adds a model dropdown to the strategy creation form.

## Requirements (from GH Issue #NNN)
- Runs and experiment history tables overview lists in evolution dash different than rest - let's use standardized list view.
- Let's make the standardized list view more visually appealing.
- Strategy creation should have dropdown of available models.

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
- `evolution/docs/evolution/visualization.md` - May need updates to reflect standardized list views and strategy creation UI changes
- `evolution/docs/evolution/architecture.md` - May need updates if model dropdown requires new data flow
