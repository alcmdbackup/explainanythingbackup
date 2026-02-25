# Cost Accuracy Evolution Bug Progress

## Phase 1: Fix computeCostPrediction union-key iteration
### Work Done
- Changed `computeCostPrediction()` to iterate union of estimated + actual agent keys using `new Set([...estimated, ...actual])`
- Inverted test `'excludes agents in perAgentCosts that are not in estimated.perAgent'` → now asserts actual-only agents ARE included with `estimated: 0`
- Added new test `'includes agents from both estimated and actual (full union)'`

### Issues Encountered
None — straightforward fix.

## Phase 2: Thread enabledAgents and singleArticle through estimator
### Work Done
- Exported `SINGLE_ARTICLE_DISABLED` from `budgetRedistribution.ts`
- Added `enabledAgents?: string[]` and `singleArticle?: boolean` to `RunCostConfig` interface
- Added `isActive()` helper in `estimateRunCostWithAgentModels` that checks required/optional/singleArticle
- Wrapped each agent estimate block with `if (isActive(agentName))` guard
- Updated `estimateRunCost()` wrapper to forward `enabledAgents` and `singleArticle`
- Updated both call sites in `evolutionActions.ts` to pass `enabledAgents` and `singleArticle`
- Added 3 tests: disabled agents, backward compat (undefined enabledAgents), singleArticle mode
- Added test in `evolutionActions.test.ts` verifying estimator receives the fields

### Issues Encountered
None.

## Phase 3: Add cost estimates for missing agents
### Work Done
- Extended `AgentModels` interface with `treeSearch`, `outlineGeneration`, `sectionDecomposition`, `flowCritique`
- Added estimation blocks: treeSearch (~33 gen + ~33 judge), outlineGeneration (3+3), sectionDecomposition (~10+~10), flowCritique (~15 judge)
- All use `competitionIters` multiplier since they run in COMPETITION phase
- Added 4 individual agent estimate tests + updated per-agent breakdown test to expect 11 agents

### Issues Encountered
None.

## Phase 4: Update existing tests for new behavior
### Work Done
- `metricsWriter.test.ts`: Added test with invocations for treeSearch/flowCritique not in estimate — verifies they appear with `estimated: 0`
- `costAnalyticsActions.test.ts`: Added test with actual-only agents in cost_prediction.perAgent
- Integration test: Added `'includes actual-only agents with estimated: 0 in prediction'` test with Zod validation

### Issues Encountered
None.

## Phase 5: Documentation updates
### Work Done
- `cost_optimization.md`: Updated Cost Estimation section with enabledAgents/singleArticle params, 11-agent list; updated Cost Prediction at Completion to document union-key behavior; updated Cost Accuracy Dashboard for per-agent table completeness
- `reference.md`: Added new "Pre-Run Cost Estimation" subsection documenting enabledAgents filtering, singleArticle mode, and all 11 agent call profiles

### Issues Encountered
None.

## Final Verification
- All 110 tests pass across 5 test suites (costEstimator, metricsWriter, costAnalyticsActions, evolutionActions, costAnalytics)
- Integration tests pass (9/9)
- Lint clean, tsc clean, build clean
