# Cost Estimates Wrong Evolution Prod Progress

## Phase 1: Schema & CostTracker API (Steps 1-5b) — COMPLETE
### Work Done
- Created migration `20260222100001_llm_tracking_invocation_fk.sql` — adds nullable `evolution_invocation_id UUID` FK column to `llmCallTracking`
- Created migration `20260222100002_llm_tracking_invocation_index.sql` — partial CONCURRENTLY index
- Added `evolution_invocation_id` to `llmCallTrackingSchema` in schemas.ts
- Extended CostTracker with `invocationCosts` map, `recordSpend(agent, cost, invocationId?)`, `getInvocationCost(id)`
- Updated `CostTracker` interface and `ExecutionContext`/`LLMCompletionOptions` types with `invocationId`
- Fixed 26 mock CostTracker objects across 15 test files to add `getInvocationCost`

### Issues Encountered
- 26 tsc errors from mock CostTrackers missing `getInvocationCost` — resolved via subagent batch fix

## Phase 2: Invocation Lifecycle & LLM Call Linkage (Steps 6-10) — COMPLETE
### Work Done
- Split `persistAgentInvocation` into `createAgentInvocation` (returns UUID) + `updateAgentInvocation` (writes final cost)
- Added `createScopedLLMClient` to llmClient.ts — thin wrapper injecting invocationId
- Updated `createEvolutionLLMClient` to pass invocationId through to `recordSpend` and `callLLM`
- Refactored `callLLM` chain: replaced positional `onUsage` param with `CallLLMOptions` object across entire LLM call chain
- Updated `saveLlmCallTracking` to write `evolution_invocation_id`
- Added `createAgentCtx` helper to pipeline.ts

### Issues Encountered
- `callLLM` positional→object refactor was invasive (touched callOpenAIModel, callAnthropicModel, routeLLMCall, callLLMModelRaw)
- 2 external callers (hallOfFameActions.ts, llms.test.ts) needed updating for new CallLLMOptions pattern

## Phase 3: Pipeline Wiring & Agent Name Cleanup (Steps 11-13) — COMPLETE
### Work Done
- Rewired `runAgent` to: `createAgentInvocation` → `createAgentCtx` → `agent.execute(agentCtx)` → `getInvocationCost` → `updateAgentInvocation`
- Wired flowCritique dispatch with same two-phase invocation pattern
- Updated `executeMinimalPipeline` with same pattern
- Renamed `'flowCritique'` to `'tournamentFlowComparison'` in pairwiseRanker.ts for call_source disambiguation

## Phase 4: Fix Dashboard Data Sources (Steps 14-16) — COMPLETE
### Work Done
- Fixed timeline delta computation: removed `prevCostByAgent` subtraction — `cost_usd` is now incremental
- Updated `persistCostPrediction` to query invocations table for actual costs (was using `getAllAgentCosts()`)
- Changed `computeCostPrediction` signature to 3-arg: `(estimated, actualTotalUsd, perAgentCosts)`
- Fixed 7 test callers across 2 test files for new 3-arg signature

### Issues Encountered
- `getAllAgentCosts()` only reflected last continuation session — querying invocations table is the correct fix

## Phase 5: UI Label Clarity (Steps 17-18) — COMPLETE
### Work Done
- Renamed all "Estimated vs Actual" labels to "Pre-run Estimate vs Final Cost" in TimelineTab.tsx
- Updated heading, value labels, chart tooltips, and legend text (7 label changes)
- BudgetStatusCard kept as-is — already provides unique burn-rate/forecast info, values now agree with header

## Phase 6: Data Migration — DEFERRED (not blocking initial deploy)
- Historical data before this fix has cumulative `cost_usd` values
- New runs get correct incremental data immediately
- Backfill migration to be run within 1 week of deploy

## Testing — COMPLETE
### Unit Tests Added
- CostTracker: 6 tests for invocation cost tracking (dual tracking, independence, accumulation)
- llmClient: 4 tests for createScopedLLMClient (invocationId injection, parallel safety)
- pipeline: 4 tests for createAgentCtx (scoping, immutability, independence)
- costEstimator: 6 tests for computeCostPrediction 3-arg signature (per-agent comparison, delta math, division-by-zero)

### Test Fixes
- Fixed llmClient.test.ts mock: positional onUsage → CallLLMOptions object
- Fixed pipeline.test.ts Supabase chain mock: upsert→chain, single returns UUID
- Fixed pairwiseRanker.test.ts: flowCritique → tournamentFlowComparison
- Fixed hallOfFameActions.test.ts: callLLM onUsage → CallLLMOptions
- Fixed BudgetTab.test.tsx: updated label assertion
- Fixed hallOfFame.test.ts: queued invocation results for pipeline type tracking tests

### Verification Results
- tsc: Clean (0 errors)
- lint: Only pre-existing warnings
- build: Successful
- unit tests: 249 suites, 4865 passed, 0 failed
- integration tests: 28 suites, 241 passed, 0 failed
