# Over Budget Evolution Progress

## Phase 1: Config Fix (Root Cause)
### Work Done
- Added `pairwise: 0.20` to `budgetCaps` in `src/lib/evolution/config.ts`
- Tournament delegates all LLM calls to PairwiseRanker (name='pairwise'), but pairwise had no budget cap entry

## Phase 2: Rewrite getEvolutionCostBreakdownAction
### Work Done
- Rewrote `src/lib/services/evolutionActions.ts` to query `evolution_agent_invocations` by `run_id` instead of `llmCallTracking` by time window
- Per-agent cost = MAX(cost_usd) since cost_usd is cumulative

## Phase 3: Rewrite getEvolutionRunBudgetAction
### Work Done
- Rewrote `src/lib/services/evolutionVisualizationActions.ts` budget action to use invocations
- Burn curve: compute deltas between consecutive cumulative values per agent

## Phase 4: Rewrite getEvolutionRunTimelineAction
### Work Done
- Replaced 55-line time-boundary/fuzzy-match cost attribution with 12-line invocation delta approach
- Eliminated redundant invocation query by building invocationSet as byproduct of cost computation
- Removed run metadata query (no longer needed for time-window correlation)

## Phase 5: Update Tests
### Work Done
- Updated unit tests in `evolutionVisualizationActions.test.ts`: removed llmCallTracking/run mocks, added invocation mocks
- Updated integration tests in `evolution-actions.integration.test.ts`: replaced `createTestLLMCallTracking` with `createTestAgentInvocation`
- Updated integration tests in `evolution-visualization.integration.test.ts`: same pattern
- Added `createTestAgentInvocation` helper to `evolution-test-helpers.ts`
- BudgetTab and TimelineTab component tests unchanged (mock at module level)

### Verification
- tsc: clean
- lint: clean
- 24/24 unit tests pass
- 23/23 component tests pass
- Build: success
