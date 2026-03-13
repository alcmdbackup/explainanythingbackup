# Minor Evolution UI Fixes Research

## Problem Statement
Minor evolution UI polish — small UI fixes and improvements across the evolution admin pages. This project addresses two specific issues: removing the unused "analysis" tab from the evolution dashboard, and fixing the timeline tab on run detail pages so that per-iteration agent invocation details remain visible after a run completes rather than collapsing to "iteration complete".

## Requirements (from GH Issue #TBD)
1. Eliminate the "analysis" tab and any code that purely supports it in the evolution dashboard
2. Ensure that after a run ends, agents invoked during each iteration remain visible under a run detail page's "timeline" tab, rather than collapsing to just "iteration complete". We can see agents invoked while the run is running, but once it ends timeline gets rid of this and just shows "iteration complete" which isn't helpful.

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
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/reference.md
- docs/docs_overall/design_style_guide.md
- docs/feature_deep_dives/admin_panel.md

## Code Files Read
- [list of code files reviewed]
