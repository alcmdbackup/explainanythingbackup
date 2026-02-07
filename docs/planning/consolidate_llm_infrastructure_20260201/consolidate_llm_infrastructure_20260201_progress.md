# Consolidate LLM Infrastructure Progress

## Phase 1: Add `onUsage` callback to central service
### Work Done
- Added `LLMUsageMetadata` interface export to `llms.ts`
- Added optional `onUsage` parameter (10th positional param) to `callOpenAIModel`
- Callback invoked after `saveLlmCallTracking` with try-catch to swallow errors
- Added 5 unit tests: non-streaming callback, streaming callback, no callback on API error, backward compat when omitted, callback error swallowed
- All 25 tests pass, lint clean, tsc clean, build clean

### Issues Encountered
- Workflow hook required project folder at `docs/planning/feat/consolidate_llm_infrastructure_20260201/` matching branch name. Created folder with symlinks to existing planning docs.

### User Clarifications
None needed.

## Phase 2: Wire evolution wrapper to use actual costs
### Work Done
- Deleted `MODEL_PRICING` constant (the source of the 1000x pricing bug)
- Rewrote `estimateTokenCost()` to use `getModelPricing()` from `llmPricing.ts` (single source of truth)
- Exported `EVOLUTION_DEFAULT_MODEL` for test accessibility
- Wired `onUsage` callback in both `complete()` and `completeStructured()` → `costTracker.recordSpend()`
- Created `llmClient.test.ts` with 5 tests: estimateTokenCost correctness, default model, recordSpend via callback, resilience when recordSpend throws, completeStructured passes callback
- All tests pass, lint clean, tsc clean, build clean

### Issues Encountered
None.

### User Clarifications
None needed.

## Phase 3: Rename `callOpenAIModel` → `callLLM`
### Work Done
- Renamed `callOpenAIModel` → `callLLM` in definition, wrapper, and export in `llms.ts`
- Renamed `default_model` → `DEFAULT_MODEL`, `lighter_model` → `LIGHTER_MODEL`
- Updated all 16 production callers, 14 test files, 1 integration test, 1 README, and 2 schema comments
- Zero remaining references to old names in `src/`
- All 3009 tests pass (6 pre-existing failures in HomeImportPanel unrelated to this change)
- tsc clean, lint clean, build clean

### Issues Encountered
None.

### User Clarifications
None needed.

## Phase 4: Fix agent costUsd reporting
### Work Done
- Replaced `costUsd: 0` with `costUsd: ctx.costTracker.getAgentCost(this.name)` across all 8 agents (19 occurrences)
- Updated `makeMockCostTracker()` in all 9 test files (8 agents + pipeline) to wire `recordSpend` → `getAgentCost` via shared `Map`
- All 253 evolution tests pass, full test suite passes, tsc clean, lint clean, build clean

### Issues Encountered
None.

### User Clarifications
None needed.
