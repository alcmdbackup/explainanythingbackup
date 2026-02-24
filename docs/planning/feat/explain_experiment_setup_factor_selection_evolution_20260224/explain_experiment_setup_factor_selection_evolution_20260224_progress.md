# Explain Experiment Setup Factor Selection Evolution - Progress

## Phase 1: Remove estimateCostImpact() dead code
### Work Done
- Removed `estimateCostImpact()` from `FactorTypeDefinition` interface
- Removed all 4 implementations (model, iterations, agent_set, editor factors)
- Removed `getCheapestInputPrice()` helper function
- Updated `factorRegistry.test.ts`: removed 4 dead tests, updated interface validation
- Updated `route.test.ts`: removed `estimateCostImpact` from mock factor definitions

### Verification
- Lint: clean, tsc: clean
- factorRegistry.test.ts: 19/19 pass, route.test.ts: 17/17 pass

## Phase 2: Fix judgeModel default ordering
### Work Done
- Swapped `DEFAULT_ROUND1_FACTORS.B` to `{ low: 'gpt-5-nano', high: 'gpt-4.1-nano' }` (cheap=low)
- Changed `mapFactorsToPipelineArgs` fallback from `'gpt-4.1-nano'` to `'gpt-5-nano'`
- Updated tests: factorial.test.ts, route.test.ts, run-strategy-experiment.test.ts, strategy-experiment.integration.test.ts

### Verification
- Lint: clean, tsc: clean
- factorial.test.ts: 20/20 pass, route.test.ts: 17/17 pass

## Phase 3: Show model pricing in UI dropdowns
### Work Done
- Added `valuePricing?` to `FactorMetadata` interface
- Updated `getFactorMetadataAction` to use `orderValues()` and populate `valuePricing` for model factors
- Updated `FactorValueSelect` to show pricing in dropdown options
- Added 3 new tests for ordering and pricing

### Verification
- Lint: clean, tsc: clean
- experimentActions.test.ts: 23/23 pass (3 new)

## Phase 4: Documentation updates
### Work Done
- Fixed judgeModel Low/High in strategy_experiments.md table
- Removed `estimateCostImpact` from factor registry capability list

### Verification
- All 82 tests pass across 4 test suites
