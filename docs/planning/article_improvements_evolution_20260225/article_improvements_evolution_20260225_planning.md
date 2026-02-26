# Article Improvements Evolution Plan

## Background
The evolution pipeline generates, competes, and refines article variants but lacks a detailed article-level view showing the full history of an article through the evolution process. Users need to understand how articles are tracked on revision (whether new articles are created or old ones updated in-place), and need a comprehensive article detail view showing creation date, Elo rating, agent operations, match history, and other metadata.

## Requirements (from GH Issue #TBD)
I want 2 things - to know how articles are tracked on revision. Is a new article created, or is old one simply updated in place? Also, I want a detailed article view the shows the article and its associated history, like when it was created, its elo, which agents operated on it, its matches, etc.

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
- `evolution/docs/evolution/architecture.md` - May need updates for article tracking/revision model
- `evolution/docs/evolution/README.md` - May need new doc links
- `evolution/docs/evolution/data_model.md` - May need updates for article detail data model
- `evolution/docs/evolution/rating_and_comparison.md` - May need updates for article-level rating views
- `evolution/docs/evolution/hall_of_fame.md` - May need updates for article detail integration
- `evolution/docs/evolution/cost_optimization.md` - May need updates for per-article cost views
- `evolution/docs/evolution/visualization.md` - Will need updates for new article detail view
- `evolution/docs/evolution/reference.md` - May need updates for new actions/files
- `evolution/docs/evolution/strategy_experiments.md` - Likely no changes
