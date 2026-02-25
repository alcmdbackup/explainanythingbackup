# Cost Accuracy Evolution Bug Plan

## Background
The Cost Accuracy tab in Ratings Optimization > Cost Accuracy > Per Agent Accuracy has a bug where many agents show one of either estimated or actual cost as zero while the other is non-zero. This shouldn't be possible — if an agent has an estimated cost, it should also have an actual cost (and vice versa).

## Requirements (from GH Issue #560)
There are many agents where one of either estimated or actual is zero, but the other is not. This shouldn't be possible.

## Problem
`computeCostPrediction()` in `costEstimator.ts` only iterates over the 7 hardcoded estimated agent keys, silently dropping any agents that actually ran but weren't estimated (`treeSearch`, `outlineGeneration`, `sectionDecomposition`, `flowCritique`, `proximity`, `metaReview`). Additionally, `estimateRunCostWithAgentModels()` always estimates all 7 agents regardless of `enabledAgents`, so disabled agents show estimated > 0 but actual = 0. The `RunCostConfig` interface lacks `enabledAgents` and `singleArticle` fields, preventing the estimator from knowing which agents will actually run.

## Options Considered

### Option A: Union-key fix only (minimal)
Change `computeCostPrediction` to iterate the union of estimated and actual agent keys. Agents in actuals but not in estimates get `estimated: 0`. Agents in estimates but not in actuals get `actual: 0`.

**Pros**: Smallest change, single function fix, no new estimator logic
**Cons**: Doesn't fix the root cause (estimator still produces wrong estimates), pre-run estimate UI still inflated

### Option B: Union-key fix + enabledAgents threading (recommended)
Fix `computeCostPrediction` (union keys) AND thread `enabledAgents`/`singleArticle` through the estimator so it only estimates agents that will actually run.

**Pros**: Fixes both symptoms — per-agent accuracy table AND pre-run estimate are correct
**Cons**: Touches more files, but all changes are straightforward

### Option C: Full fix + add estimates for missing agents
Option B + add cost estimation formulas for `treeSearch`, `outlineGeneration`, `sectionDecomposition`, `flowCritique` in `estimateRunCostWithAgentModels`.

**Pros**: Most complete — all agents get both estimated and actual values
**Cons**: More complex; estimating `treeSearch` (~60 calls) and `flowCritique` (pool-size-dependent) requires careful heuristics. Can be done as a follow-up.

**Decision**: **Option B** — fixes the core bug and prevents both symptom classes. Option C (adding estimates for missing agents) is a separate enhancement that can follow.

## Phased Execution Plan

### Phase 1: Fix `computeCostPrediction` union-key iteration

**Files modified:**
- `evolution/src/lib/core/costEstimator.ts` — `computeCostPrediction()` (lines 382-388)

**Change:**
```typescript
// BEFORE (buggy):
for (const agent of Object.keys(estimated.perAgent)) {

// AFTER (fixed):
const allAgents = new Set([
  ...Object.keys(estimated.perAgent),
  ...Object.keys(perAgentCosts),
]);
for (const agent of allAgents) {
```

**Tests modified:**
- `evolution/src/lib/core/costEstimator.test.ts` — Invert the test `'excludes agents in perAgentCosts that are not in estimated.perAgent'` to assert actual-only agents ARE included with `estimated: 0`. Add new test for union behavior.

**Verify**: `npm test -- costEstimator.test.ts`, lint, tsc, build

### Phase 2: Thread `enabledAgents` and `singleArticle` through estimator

**Files modified:**

1. `evolution/src/lib/core/costEstimator.ts`:
   - Add `enabledAgents?: string[]` and `singleArticle?: boolean` to `RunCostConfig` interface
   - In `estimateRunCostWithAgentModels()`, after building `perAgent`, filter out agents that won't run:
     - Import `REQUIRED_AGENTS`, `OPTIONAL_AGENTS` from `budgetRedistribution.ts`
     - If `enabledAgents` is defined, skip optional agents not in the set
     - If `singleArticle` is true, skip `generation`, `outlineGeneration`, `evolution`
     - Required agents (`generation`, `calibration`, `tournament`) always included (unless singleArticle disables them)

2. `evolution/src/services/evolutionActions.ts`:
   - `_estimateRunCostAction` (line 113): Add `enabledAgents: config.enabledAgents, singleArticle: config.singleArticle` to the estimator call
   - `_queueEvolutionRunAction` (line 183): Same addition

**Tests modified:**
- `evolution/src/lib/core/costEstimator.test.ts`:
  - Add test: `'excludes disabled agents when enabledAgents is provided'`
  - Add test: `'includes all agents when enabledAgents is undefined (backward compat)'`
  - Add test: `'excludes generation/evolution/outlineGeneration in singleArticle mode'`

**Verify**: `npm test -- costEstimator.test.ts evolutionActions.test.ts`, lint, tsc, build

### Phase 3: Update existing tests for new behavior

**Files modified:**
- `evolution/src/lib/core/metricsWriter.test.ts` — Add test with invocation rows for agents not in estimate (e.g., `treeSearch` row + estimate without `treeSearch`)
- `evolution/src/services/costAnalyticsActions.test.ts` — Add test where `cost_prediction.perAgent` includes agents with `estimated: 0` (actual-only agents)
- `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` — Add test for actual-only agents appearing in prediction

**Verify**: Full test suite `npm test -- --testPathPatterns="costEstimator|metricsWriter|costAnalytics|evolution-cost-estimation"`

### Phase 4: Documentation updates

**Files modified:**
- `evolution/docs/evolution/cost_optimization.md` — Update "Cost Prediction at Completion" section to document union-key behavior; update "Cost Accuracy Dashboard" section
- `evolution/docs/evolution/reference.md` — Update "Cost Estimation" section to document `enabledAgents`/`singleArticle` awareness

## Testing

### Unit tests to modify
| File | Change |
|---|---|
| `costEstimator.test.ts` | Invert excluded-agent test; add enabledAgents filtering tests; add singleArticle test |
| `metricsWriter.test.ts` | Add test with extra invocation agents beyond estimate |
| `costAnalyticsActions.test.ts` | Add test with actual-only agents in aggregation |

### Unit tests to add
| Test | What it verifies |
|---|---|
| `computeCostPrediction includes actual-only agents` | Agents in `perAgentCosts` but not in `estimated.perAgent` appear with `estimated: 0` |
| `estimator skips disabled agents` | When `enabledAgents: ['generation']`, only `generation` + required agents appear in `perAgent` |
| `estimator backward compat` | When `enabledAgents` is undefined, all 7 agents still estimated |
| `singleArticle mode skips generation agents` | `generation`, `outlineGeneration`, `evolution` excluded |

### Integration test
- `evolution-cost-estimation.integration.test.ts` — Add actual-only agent scenario

### Manual verification
1. Open `/admin/quality/optimization` → Cost Accuracy tab → verify per-agent table no longer has zero-estimated or zero-actual mismatches
2. Open `/admin/quality/evolution` → select a strategy with disabled agents → verify pre-run estimate only shows enabled agents
3. Run an evolution pipeline → check `evolution_runs.cost_prediction` JSONB → verify `perAgent` contains the union of estimated and actual agents

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - Update "Cost Prediction at Completion" and "Cost Accuracy Dashboard" sections to document union-key behavior and enabledAgents awareness
- `evolution/docs/evolution/reference.md` - Update cost estimation section to document enabledAgents/singleArticle filtering

Docs confirmed NOT affected (no updates needed):
- `evolution/docs/evolution/architecture.md` - Pipeline cost flow unchanged
- `evolution/docs/evolution/data_model.md` - Schema unchanged
- `evolution/docs/evolution/agents/overview.md` - Agent framework unchanged
- `evolution/docs/evolution/visualization.md` - UI reads JSONB dynamically, no hardcoded keys
- `evolution/docs/evolution/rating_and_comparison.md` - Tournament cost routing unchanged
- `docs/feature_deep_dives/metrics_analytics.md` - General metrics unrelated

## Files Modified Summary

| File | Phase | Change |
|---|---|---|
| `evolution/src/lib/core/costEstimator.ts` | 1, 2 | Union-key iteration in `computeCostPrediction`; add `enabledAgents`/`singleArticle` to `RunCostConfig`; filter agents in `estimateRunCostWithAgentModels` |
| `evolution/src/services/evolutionActions.ts` | 2 | Pass `enabledAgents`/`singleArticle` at both call sites |
| `evolution/src/lib/core/costEstimator.test.ts` | 1, 2, 3 | Invert excluded-agent test; add filtering tests |
| `evolution/src/lib/core/metricsWriter.test.ts` | 3 | Add extra-agent invocation test |
| `evolution/src/services/costAnalyticsActions.test.ts` | 3 | Add actual-only agent aggregation test |
| `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` | 3 | Add actual-only agent integration test |
| `evolution/docs/evolution/cost_optimization.md` | 4 | Update cost prediction and accuracy sections |
| `evolution/docs/evolution/reference.md` | 4 | Update cost estimation section |

## Risk Assessment

**Low risk**: All changes are additive or corrective. No schema changes, no migrations, no DB writes altered. The union-key fix is strictly more correct (superset of previous output). The `enabledAgents` threading uses existing infrastructure (`REQUIRED_AGENTS`/`OPTIONAL_AGENTS` from `budgetRedistribution.ts`). Old runs with frozen `cost_estimate_detail` are unaffected — the union-key fix naturally handles the mismatch.
