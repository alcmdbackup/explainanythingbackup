# Judge Article Flow Progress

## Phase 1: Shared Constants & Flow Prompt Builders
### Work Done
- [ ] Create `flowRubric.ts` with QUALITY_DIMENSIONS, FLOW_DIMENSIONS
- [ ] Flow prompt builders and parsers
- [ ] normalizeScore, getFlowCritiqueForVariant, getWeakestDimensionAcrossCritiques
- [ ] Unit tests (flowRubric.test.ts)
- [ ] lint, tsc, build, tests pass

## Phase 2: Unify Existing Dimension Lists
### Work Done
- [ ] reflectionAgent.ts → QUALITY_DIMENSIONS
- [ ] pairwiseRanker.ts → QUALITY_DIMENSIONS
- [ ] iterativeEditingAgent.ts → QUALITY_DIMENSIONS
- [ ] beamSearch.ts → QUALITY_DIMENSIONS
- [ ] debateAgent.ts → QUALITY_DIMENSIONS
- [ ] index.ts re-exports
- [ ] Update all test fixtures
- [ ] lint, tsc, build, tests pass

## Phase 3: PairwiseRanker Flow Comparison Mode
### Work Done
- [ ] comparePairFlow(), compareFlowWithBiasMitigation()
- [ ] Match.frictionSpots
- [ ] ComparisonCache mode parameter
- [ ] Tests
- [ ] lint, tsc, build, tests pass

## Phase 4: ReflectionAgent Flow Critique + Scale Normalization
### Work Done
- [ ] Critique.scale field
- [ ] Flow critique second pass
- [ ] IterativeEditingAgent cross-scale targeting
- [ ] TreeSearch flow-aware dimension override
- [ ] Tests
- [ ] lint, tsc, build, tests pass

## Phase 5: Pipeline Integration & Feature Flag
### Work Done
- [ ] Feature flag + migration
- [ ] Budget cap
- [ ] Standalone flow critique in pipeline.ts
- [ ] Tournament flow comparison
- [ ] Integration tests
- [ ] lint, tsc, build, tests pass
