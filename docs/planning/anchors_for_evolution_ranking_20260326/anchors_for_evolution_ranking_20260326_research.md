# Anchors For Evolution Ranking Research

## Problem Statement
Explore whether using "anchor variants" for arena ranking would speed up ranking convergence of newer variants. Anchors are designated well-established variants that serve as the exclusive comparison opponents for new entrants. Because anchors accumulate many matches, they develop much lower sigma (uncertainty) values. The hypothesis is that comparing high-sigma new variants against low-sigma anchors will cause the new variants' ratings to converge faster in the Weng-Lin Bayesian model.

## Requirements (from GH Issue #TBD)
Requirements are open-ended — the research phase will determine specifics based on:
- Whether the Weng-Lin math supports faster convergence when pairing high-sigma vs low-sigma players
- Trade-offs around anchor staleness and rating distortions
- Prior art in gaming/tournament rating systems
- Practical implementation constraints in the current evolution pipeline

## High Level Summary
[Summary of findings — to be populated after research]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/architecture.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/feature_deep_dives/evolution_logging.md
- evolution/docs/metrics.md
- evolution/docs/visualization.md

## Code Files Read
- [list of code files reviewed]
