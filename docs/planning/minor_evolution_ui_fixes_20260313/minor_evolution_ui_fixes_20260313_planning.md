# Minor Evolution UI Fixes Plan

## Background
Minor evolution UI polish — small UI fixes and improvements across the evolution admin pages. This project addresses two specific issues: removing the unused "analysis" tab from the evolution dashboard, and fixing the timeline tab on run detail pages so that per-iteration agent invocation details remain visible after a run completes rather than collapsing to "iteration complete".

## Requirements (from GH Issue #TBD)
1. Eliminate the "analysis" tab and any code that purely supports it in the evolution dashboard
2. Ensure that after a run ends, agents invoked during each iteration remain visible under a run detail page's "timeline" tab, rather than collapsing to just "iteration complete". We can see agents invoked while the run is running, but once it ends timeline gets rid of this and just shows "iteration complete" which isn't helpful.

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
- `evolution/docs/evolution/visualization.md` - May need to remove analysis tab references
- `evolution/docs/evolution/arena.md` - Likely no changes needed
- `evolution/docs/evolution/data_model.md` - Likely no changes needed
- `evolution/docs/evolution/rating_and_comparison.md` - Likely no changes needed
- `evolution/docs/evolution/reference.md` - May need to remove analysis references
- `docs/docs_overall/design_style_guide.md` - Likely no changes needed
- `docs/feature_deep_dives/admin_panel.md` - May need to remove analysis route references
