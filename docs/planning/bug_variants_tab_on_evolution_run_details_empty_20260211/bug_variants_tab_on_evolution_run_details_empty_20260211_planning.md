# Bug Variants Tab On Evolution Run Details Empty Plan

## Background
The Variants tab on the evolution run detail page (`/admin/quality/evolution/run/[runId]`) shows empty/no data even when the run has completed with variants. The tab should display a sortable variant table with sparklines and step score expansion, but currently renders with no content. This needs to be investigated and fixed so that variant data loads and displays correctly.

## Requirements (from GH Issue #404)
- Fix the Variants tab on the evolution run detail page to show variant data
- Investigate why data is not being fetched or rendered
- Ensure the fix works for both completed and in-progress runs

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
- `docs/evolution/visualization.md` - May need updates to VariantsTab documentation
- `docs/evolution/data_model.md` - May need updates if data model changes are needed
- `docs/evolution/reference.md` - May need updates to schema or action documentation
- `docs/evolution/architecture.md` - May need updates if architecture changes
- `docs/evolution/README.md` - May need updates to overview
- `docs/evolution/agents/overview.md` - May need updates if agent interaction changes
- `docs/evolution/hall_of_fame.md` - May need updates if hall of fame integration affected
