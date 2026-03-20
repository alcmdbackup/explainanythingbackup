# Minor Evolution V2 Changes Plan

## Background
The evolution V2 pipeline's evolve phase adds variants to the pool that never get properly triaged/ranked (they skip the `newEntrantIds` tracking), and the file naming in the V2 pipeline could be clearer. This project disables the evolve agent from the V2 pipeline and explores renaming key files to improve codebase readability.

## Requirements (from GH Issue #NNN)
1. Disable the evolve agent from the main evolution V2 pipeline (`evolve-article.ts`)
2. Explore renaming key files in `evolution/src/lib/v2/` to make the codebase easier to understand

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
- `evolution/docs/evolution/reference.md` - May need updates to reflect evolve agent removal and file renames
- `evolution/docs/evolution/data_model.md` - File path references may change
- `evolution/docs/evolution/architecture.md` - Pipeline flow description may change
- `evolution/docs/evolution/cost_optimization.md` - File references may change
- `evolution/docs/evolution/rating_and_comparison.md` - File references may change
- `evolution/docs/evolution/experimental_framework.md` - File references may change
- `evolution/docs/evolution/strategy_experiments.md` - File references may change
- `evolution/docs/evolution/agents/overview.md` - Agent interaction table may change
- `evolution/docs/evolution/agents/generation.md` - File references may change
- `evolution/docs/evolution/visualization.md` - File references may change
