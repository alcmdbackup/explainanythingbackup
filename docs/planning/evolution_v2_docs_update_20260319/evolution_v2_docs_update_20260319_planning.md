# Evolution V2 Docs Update Plan

## Background
Update the evolution pipeline documentation to reflect evolution v2 changes. The evolution system has undergone significant architectural changes including the unified RankingAgent (merging CalibrationRanker and Tournament), evolution explanations decoupling, and various pipeline improvements. This project will audit all evolution docs under evolution/docs/evolution/ and ensure they accurately reflect the current codebase state.

## Requirements (from GH Issue #TBD)
- Audit all evolution docs in evolution/docs/evolution/ for accuracy against current codebase
- Verify all file references, function names, and code patterns are up to date
- Ensure architectural descriptions match current implementation
- Update any stale references to removed or renamed components

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
- `evolution/docs/evolution/README.md` - Entry point and reading order
- `evolution/docs/evolution/architecture.md` - Pipeline orchestration and phases
- `evolution/docs/evolution/data_model.md` - Core primitives and data structures
- `evolution/docs/evolution/visualization.md` - Dashboard and UI components
- `evolution/docs/evolution/agents/overview.md` - Agent framework and patterns
- `evolution/docs/evolution/rating_and_comparison.md` - Rating system and comparisons
- `evolution/docs/evolution/reference.md` - Configuration, schema, key files
- `evolution/docs/evolution/experimental_framework.md` - Metrics and experiments
