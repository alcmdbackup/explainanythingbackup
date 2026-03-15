# Cleanup Core Folder Evolution Research

## Problem Statement
The evolution pipeline's core folder (`evolution/src/lib/core/`) contains 34 source files totaling 17,070 LOC. While well-structured with no dead exports, it has accumulated legacy backward-compatibility code, deprecated fields, duplicated constants, and vestigial checkpoint fields that add noise and maintenance burden. This project cleans up these items to reduce complexity.

## Requirements (from GH Issue #704)

1. Remove legacy `eloRatings` backward compat from `state.ts` deserializeState() and `SerializedPipelineState` type in `types.ts` (~15 lines)
2. Remove deprecated `debatesAdded` field from `DiffMetrics` type and hardcoded `0` in `pipelineUtilities.ts` (~5 lines)
3. Remove `ordinal: 0` dummy field in `arenaIntegration.ts` syncToArena() (~1 line)
4. Remove unused `persistAgentInvocation()` function from `pipelineUtilities.ts` (~35 lines)
5. Remove null vestigial fields (`similarityMatrix`, `debateTranscripts`, `treeSearchResults`, `treeSearchStates`, `sectionState`) from `serializeState()` in `state.ts` (~5 lines)
6. Consolidate duplicated `SINGLE_ARTICLE_DISABLED` (budgetRedistribution.ts) and `SINGLE_ARTICLE_EXCLUDED` (supervisor.ts) into one source
7. Remove `eloToRating()` backward compat helper from `rating.ts` once #1 is done (~5 lines)

## High Level Summary

After reviewing all 34 source files in `evolution/src/lib/core/`, all exports have active consumers — no dead code was found. The cleanup opportunities are limited to:
- **Legacy compat code**: `eloRatings` deserialization path and `eloToRating()` helper from when the system used Elo ratings instead of OpenSkill mu/sigma
- **Deprecated fields**: `debatesAdded` in DiffMetrics (hardcoded to 0), `ordinal` dummy in arena sync
- **Vestigial serialization fields**: 5 null fields written during checkpoint serialization that are never read back
- **Duplication**: Same agent exclusion list defined in two files under different names
- **Potentially dead function**: `persistAgentInvocation()` appears superseded by the 2-phase create/update pattern

### Key Risk: Legacy Checkpoints
The `eloRatings` compat code in `state.ts` exists to deserialize old checkpoints. Before removing, we must verify no `continuation_pending` or recent checkpoints use this format. If all active runs use the new `ratings` format, it's safe to remove.

### Key Risk: Vestigial Serialization Fields
The null fields in `serializeState()` (`similarityMatrix`, `debateTranscripts`, etc.) may be expected by the `SerializedPipelineState` type. Removing them requires updating the type definition and ensuring deserialization handles their absence.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/experimental_framework.md

## Code Files Read
- evolution/src/lib/core/actions.ts (128 LOC)
- evolution/src/lib/core/agentToggle.ts (37 LOC)
- evolution/src/lib/core/arenaIntegration.ts (304 LOC)
- evolution/src/lib/core/budgetRedistribution.ts (75 LOC)
- evolution/src/lib/core/comparisonCache.ts (95 LOC)
- evolution/src/lib/core/configValidation.ts (123 LOC)
- evolution/src/lib/core/costEstimator.ts (465 LOC)
- evolution/src/lib/core/costTracker.ts (154 LOC)
- evolution/src/lib/core/critiqueBatch.ts (92 LOC)
- evolution/src/lib/core/diversityTracker.ts (110 LOC)
- evolution/src/lib/core/eloAttribution.ts (108 LOC)
- evolution/src/lib/core/errorClassification.ts (43 LOC)
- evolution/src/lib/core/formatValidationRules.ts (104 LOC)
- evolution/src/lib/core/jsonParser.ts (54 LOC)
- evolution/src/lib/core/llmClient.ts (183 LOC)
- evolution/src/lib/core/logger.ts (127 LOC)
- evolution/src/lib/core/metricsWriter.ts (218 LOC)
- evolution/src/lib/core/persistence.ts (262 LOC)
- evolution/src/lib/core/pipeline.ts (904 LOC)
- evolution/src/lib/core/pipelineUtilities.ts (218 LOC)
- evolution/src/lib/core/pool.ts (134 LOC)
- evolution/src/lib/core/rating.ts (78 LOC)
- evolution/src/lib/core/reducer.ts (32 LOC)
- evolution/src/lib/core/reversalComparison.ts (39 LOC)
- evolution/src/lib/core/seedArticle.ts (66 LOC)
- evolution/src/lib/core/state.ts (320 LOC)
- evolution/src/lib/core/strategyConfig.ts (212 LOC)
- evolution/src/lib/core/supervisor.ts (213 LOC)
- evolution/src/lib/core/textVariationFactory.ts (26 LOC)
- evolution/src/lib/core/validation.ts (127 LOC)
