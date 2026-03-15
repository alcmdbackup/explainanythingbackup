# Cleanup Core Folder Evolution Plan

## Background
The evolution pipeline's core folder (`evolution/src/lib/core/`) contains 34 source files totaling 17,070 LOC. While well-structured with no dead exports, it has accumulated legacy backward-compatibility code, deprecated fields, duplicated constants, and vestigial checkpoint fields that add noise and maintenance burden. This project cleans up these items to reduce complexity.

## Requirements (from GH Issue #NNN)

1. Remove legacy `eloRatings` backward compat from `state.ts` deserializeState() and `SerializedPipelineState` type in `types.ts` (~15 lines)
2. Remove deprecated `debatesAdded` field from `DiffMetrics` type and hardcoded `0` in `pipelineUtilities.ts` (~5 lines)
3. Remove `ordinal: 0` dummy field in `arenaIntegration.ts` syncToArena() (~1 line)
4. Remove unused `persistAgentInvocation()` function from `pipelineUtilities.ts` (~35 lines)
5. Remove null vestigial fields (`similarityMatrix`, `debateTranscripts`, `treeSearchResults`, `treeSearchStates`, `sectionState`) from `serializeState()` in `state.ts` (~5 lines)
6. Consolidate duplicated `SINGLE_ARTICLE_DISABLED` (budgetRedistribution.ts) and `SINGLE_ARTICLE_EXCLUDED` (supervisor.ts) into one source
7. Remove `eloToRating()` backward compat helper from `rating.ts` once #1 is done (~5 lines)

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
- `evolution/docs/evolution/README.md` - unlikely to need changes
- `evolution/docs/evolution/architecture.md` - may need updates if DiffMetrics or serialization format changes
- `evolution/docs/evolution/data_model.md` - may need updates if SerializedPipelineState type changes
- `evolution/docs/evolution/reference.md` - may need updates to key files section
- `evolution/docs/evolution/experimental_framework.md` - unlikely to need changes
