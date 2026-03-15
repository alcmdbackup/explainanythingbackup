# Simplify Pipeline State Evolution Progress

## Phase 1: Create actions.ts, reducer.ts, add with*() to state.ts
### Work Done
Completed in earlier session.

## Phase 2: Migrate all agents + pipeline to action dispatch
### Work Done
Completed in earlier session.

## Phase 3: Move agent-local fields + default nullables
### Work Done
- Removed 5 agent-local fields from `ReadonlyPipelineState` and `PipelineStateImpl`: `similarityMatrix`, `debateTranscripts`, `treeSearchResults`, `treeSearchStates`, `sectionState`
- Changed `allCritiques` from `Critique[] | null` to `Critique[]` with default `[]`
- Changed `diversityScore` from `number | null` to `number` with default `0`
- Changed `DiffMetrics.diversityScoreAfter` from `number | null` to `number`
- Removed `debatesLength` from `BeforeStateSnapshot` (debateTranscripts no longer on state)
- Updated `serializeState` to write `null` for removed agent-local fields (backward compat)
- Updated `deserializeState` to ignore agent-local fields, use `?? []` / `?? 0` for defaulted fields
- Kept all fields on `SerializedPipelineState` for checkpoint backward compat
- Cleaned up ~30 null-checks across agents/core files
- Updated `validation.ts` phase checks from `=== null` to `=== 0` / `.length === 0`
- Fixed `evolutionVisualizationActions.ts` to read treeSearch data from snapshot instead of state
- Updated 12 test files for new defaults and removed field references

### Verification
- `npx tsc --noEmit` — 0 errors
- `npx eslint evolution/src/lib/ --quiet` — clean
- `npx jest evolution/src/lib/` — 67 suites, 1375 tests all passing

### Files Modified (source)
- `evolution/src/lib/types.ts`
- `evolution/src/lib/core/state.ts`
- `evolution/src/lib/core/validation.ts`
- `evolution/src/lib/core/pipelineUtilities.ts`
- `evolution/src/lib/core/pipeline.ts`
- `evolution/src/lib/core/diversityTracker.ts`
- `evolution/src/lib/core/supervisor.ts`
- `evolution/src/lib/agents/proximityAgent.ts`
- `evolution/src/lib/agents/reflectionAgent.ts`
- `evolution/src/lib/agents/metaReviewAgent.ts`
- `evolution/src/lib/agents/evolvePool.ts`
- `evolution/src/lib/agents/treeSearchAgent.ts`
- `evolution/src/lib/agents/iterativeEditingAgent.ts`
- `evolution/src/lib/agents/sectionDecompositionAgent.ts`
- `evolution/src/services/evolutionVisualizationActions.ts`

### Files Modified (tests)
- `evolution/src/lib/core/state.test.ts`
- `evolution/src/lib/core/reducer.test.ts`
- `evolution/src/lib/core/pipelineUtilities.test.ts`
- `evolution/src/lib/core/pipelineFlow.test.ts`
- `evolution/src/lib/core/pipeline.test.ts`
- `evolution/src/lib/agents/debateAgent.test.ts`
- `evolution/src/lib/agents/proximityAgent.test.ts`
- `evolution/src/lib/agents/sectionDecompositionAgent.test.ts`
- `evolution/src/lib/agents/treeSearchAgent.test.ts`
- `evolution/src/lib/agents/reflectionAgent.test.ts`
- `src/__tests__/integration/evolution-tree-search.integration.test.ts`
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.test.tsx`

## Phase 4: Action dashboard visibility
### Work Done
Pending.

## Phase 5: Cleanup + docs
### Work Done
Pending.
