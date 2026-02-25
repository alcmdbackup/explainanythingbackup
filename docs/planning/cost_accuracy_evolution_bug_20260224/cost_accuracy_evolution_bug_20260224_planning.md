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

### Option B: Union-key fix + enabledAgents threading
Fix `computeCostPrediction` (union keys) AND thread `enabledAgents`/`singleArticle` through the estimator so it only estimates agents that will actually run.

**Pros**: Fixes both symptoms — per-agent accuracy table AND pre-run estimate are correct
**Cons**: Touches more files, but all changes are straightforward. Missing agents still show `estimated: 0`.

### Option C: Full fix + add estimates for missing agents (chosen)
Option B + add cost estimation formulas for `treeSearch`, `outlineGeneration`, `sectionDecomposition`, `flowCritique` in `estimateRunCostWithAgentModels`.

**Pros**: Most complete — all agents get both estimated and actual values. Pre-run estimate total is accurate. Per-agent accuracy table has real data for every agent.
**Cons**: Requires heuristics for `treeSearch` (~60 calls) and `flowCritique` (pool-size-dependent).

**Decision**: **Option C** — the most complete fix. Every agent that makes LLM calls gets a cost estimate, and the union-key fix ensures nothing is silently dropped.

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
   - In `estimateRunCostWithAgentModels()`, before building `perAgent`, determine which agents are active:
     - Import `REQUIRED_AGENTS`, `OPTIONAL_AGENTS`, `SINGLE_ARTICLE_DISABLED` from `budgetRedistribution.ts` (export `SINGLE_ARTICLE_DISABLED` if not already exported — do NOT duplicate the list)
     - If `enabledAgents` is defined, skip optional agents not in the set
     - If `singleArticle` is true, also skip agents in `SINGLE_ARTICLE_DISABLED` (currently `generation`, `outlineGeneration`, `evolution`)
     - Required agents (`generation`, `calibration`, `tournament`) always included (unless singleArticle disables them)
   - Wrap each agent's estimate block in an `if (isActive(agentName))` guard
   - Also update the `estimateRunCost()` backward-compat wrapper (~line 235) to forward `enabledAgents` and `singleArticle` from `EvolutionRunConfig` to `estimateRunCostWithAgentModels`, so callers using the legacy wrapper also get correct filtered estimates

2. `evolution/src/services/evolutionActions.ts`:
   - `_estimateRunCostAction` (line 113): Add `enabledAgents: config.enabledAgents, singleArticle: config.singleArticle` to the estimator call
   - `_queueEvolutionRunAction` (line 183): Same addition

3. `evolution/src/lib/core/budgetRedistribution.ts`:
   - Export `SINGLE_ARTICLE_DISABLED` constant (if not already exported) so costEstimator.ts can import it instead of duplicating the list

**Tests modified:**
- `evolution/src/lib/core/costEstimator.test.ts`:
  - Add test: `'excludes disabled agents when enabledAgents is provided'`
  - Add test: `'includes all agents when enabledAgents is undefined (backward compat)'`
  - Add test: `'excludes generation/evolution/outlineGeneration in singleArticle mode'`
- `evolution/src/services/evolutionActions.test.ts`:
  - Add test: `'passes enabledAgents and singleArticle to estimator'` — verify the new fields are forwarded from StrategyConfig to estimateRunCostWithAgentModels

**Verify**: `npm test -- costEstimator.test.ts evolutionActions.test.ts`, lint, tsc, build

### Phase 3: Add cost estimates for missing agents

**Files modified:**
- `evolution/src/lib/core/costEstimator.ts` — `estimateRunCostWithAgentModels()`

Add estimation blocks for 4 agents that make LLM calls:

```typescript
// treeSearch: ~33 gen calls + ~33 judge calls per competition iteration
// (beam search: K=3 beams × B=3 branches × D=3 depth = ~27 gen, ~27 judge + re-critiques)
perAgent.treeSearch =
  (await estimateAgentCost('treeSearch', getModel('treeSearch', false), textLength, 33) +
   await estimateAgentCost('treeSearch', getModel('treeSearch', true), textLength * 2, 33))
  * competitionIters;

// outlineGeneration: 3 gen calls + 3 judge calls per competition iteration
// (outline→score→expand→score→polish→score pipeline)
perAgent.outlineGeneration =
  (await estimateAgentCost('outlineGeneration', getModel('outlineGeneration', false), textLength, 3) +
   await estimateAgentCost('outlineGeneration', getModel('outlineGeneration', true), textLength, 3))
  * competitionIters;

// sectionDecomposition: ~10 gen calls + ~10 judge calls per competition iteration
// (~5 sections × 2 cycles × 1 edit + 1 judge per cycle)
perAgent.sectionDecomposition =
  (await estimateAgentCost('sectionDecomposition', getModel('sectionDecomposition', false), textLength / 5, 10) +
   await estimateAgentCost('sectionDecomposition', getModel('sectionDecomposition', true), textLength / 5, 10))
  * competitionIters;

// flowCritique: ~15 judge calls per competition iteration (1 per pool variant, pool ~15 in competition)
// Uses judge model since flowCritique runs compareFlowWithBiasMitigation (2-pass judge LLM calls)
perAgent.flowCritique = await estimateAgentCost(
  'flowCritique', getModel('flowCritique', true), textLength, 15
) * competitionIters;
```

Also add the new agent names to the `AgentModels` interface so per-agent model overrides work:
```typescript
interface AgentModels {
  // ... existing 7 ...
  treeSearch?: AllowedLLMModelType;
  outlineGeneration?: AllowedLLMModelType;
  sectionDecomposition?: AllowedLLMModelType;
  flowCritique?: AllowedLLMModelType;
}
```

**Note**: `proximity` and `metaReview` make zero LLM calls — no estimates needed.

**Tests modified:**
- `evolution/src/lib/core/costEstimator.test.ts`:
  - Add test: `'estimates treeSearch cost for competition iterations'`
  - Add test: `'estimates outlineGeneration cost for competition iterations'`
  - Add test: `'estimates sectionDecomposition cost for competition iterations'`
  - Add test: `'estimates flowCritique cost for competition iterations'`
  - Update existing `estimateRunCostWithAgentModels` tests to expect 11 agents in `perAgent` instead of 7

**Verify**: `npm test -- costEstimator.test.ts`, lint, tsc, build

### Phase 4: Update existing tests for new behavior

**Files modified:**
- `evolution/src/lib/core/metricsWriter.test.ts` — Add test with invocation rows for agents not in estimate (e.g., `treeSearch` row + estimate without `treeSearch`)
- `evolution/src/services/costAnalyticsActions.test.ts` — Add test where `cost_prediction.perAgent` includes agents with `estimated: 0` (actual-only agents)
- `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` — Add test for actual-only agents appearing in prediction

**Verify**: Unit tests: `npm test -- --testPathPatterns="costEstimator|metricsWriter|costAnalytics"`, then integration test separately: `npm run test:integration -- --testPathPatterns="evolution-cost-estimation"`

### Phase 5: Documentation updates

**Files modified:**
- `evolution/docs/evolution/cost_optimization.md` — Update "Cost Prediction at Completion" section to document union-key behavior; update "Cost Accuracy Dashboard" section; document new agent estimates
- `evolution/docs/evolution/reference.md` — Update "Cost Estimation" and "Task-Type Cost Estimation" sections to document `enabledAgents`/`singleArticle` awareness and the 4 new agent estimates

## Testing

### Unit tests to modify
| File | Change |
|---|---|
| `costEstimator.test.ts` | Invert excluded-agent test; add enabledAgents filtering tests; add singleArticle test; add tests for 4 new agent estimates; update perAgent key count assertions |
| `metricsWriter.test.ts` | Add test with extra invocation agents beyond estimate |
| `costAnalyticsActions.test.ts` | Add test with actual-only agents in aggregation |

### Unit tests to add
| Test | What it verifies |
|---|---|
| `computeCostPrediction includes actual-only agents` | Agents in `perAgentCosts` but not in `estimated.perAgent` appear with `estimated: 0` |
| `estimator skips disabled agents` | When `enabledAgents: ['generation']`, only `generation` + required agents appear in `perAgent` |
| `estimator backward compat` | When `enabledAgents` is undefined, all 11 agents estimated |
| `singleArticle mode skips generation agents` | `generation`, `outlineGeneration`, `evolution` excluded |
| `estimates treeSearch cost` | `perAgent.treeSearch` > 0 for competition iterations |
| `estimates outlineGeneration cost` | `perAgent.outlineGeneration` > 0 for competition iterations |
| `estimates sectionDecomposition cost` | `perAgent.sectionDecomposition` > 0 for competition iterations |
| `estimates flowCritique cost` | `perAgent.flowCritique` > 0 for competition iterations |

### Integration test
- `evolution-cost-estimation.integration.test.ts` — Add actual-only agent scenario

### Manual verification
1. Open `/admin/quality/optimization` → Cost Accuracy tab → verify per-agent table no longer has zero-estimated or zero-actual mismatches
2. Open `/admin/quality/evolution` → select a strategy with disabled agents → verify pre-run estimate only shows enabled agents and includes treeSearch/outlineGeneration/sectionDecomposition/flowCritique
3. Run an evolution pipeline → check `evolution_runs.cost_prediction` JSONB → verify `perAgent` contains all active agents with both estimated and actual values

## Documentation Updates
The following docs need updates:
- `evolution/docs/evolution/cost_optimization.md` - Update "Cost Prediction at Completion" and "Cost Accuracy Dashboard" sections; document union-key behavior, enabledAgents awareness, and 4 new agent estimates
- `evolution/docs/evolution/reference.md` - Update cost estimation section to document enabledAgents/singleArticle filtering and new agent call profiles

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
| `evolution/src/lib/core/costEstimator.ts` | 1, 2, 3 | Union-key iteration in `computeCostPrediction`; add `enabledAgents`/`singleArticle` to `RunCostConfig`; filter agents in `estimateRunCostWithAgentModels`; add 4 new agent estimate blocks; extend `AgentModels` interface |
| `evolution/src/services/evolutionActions.ts` | 2 | Pass `enabledAgents`/`singleArticle` at both call sites |
| `evolution/src/lib/core/budgetRedistribution.ts` | 2 | Export `SINGLE_ARTICLE_DISABLED` constant |
| `evolution/src/lib/core/costEstimator.test.ts` | 1, 2, 3, 4 | Invert excluded-agent test; add filtering tests; add 4 new agent estimate tests; update key count assertions |
| `evolution/src/lib/core/metricsWriter.test.ts` | 4 | Add extra-agent invocation test |
| `evolution/src/services/costAnalyticsActions.test.ts` | 4 | Add actual-only agent aggregation test |
| `evolution/src/services/evolutionActions.test.ts` | 2 | Add test verifying enabledAgents/singleArticle passthrough |
| `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` | 4 | Add actual-only agent integration test |
| `evolution/docs/evolution/cost_optimization.md` | 5 | Update cost prediction, accuracy sections, new agent estimates |
| `evolution/docs/evolution/reference.md` | 5 | Update cost estimation section |

## Risk Assessment

**Low risk**: All changes are additive or corrective. No schema changes, no migrations, no DB writes altered. The union-key fix is strictly more correct (superset of previous output). The `enabledAgents` threading uses existing infrastructure (`REQUIRED_AGENTS`/`OPTIONAL_AGENTS`/`SINGLE_ARTICLE_DISABLED` from `budgetRedistribution.ts`). Old runs with frozen `cost_estimate_detail` are unaffected — the union-key fix naturally handles the mismatch. The new agent estimates use the existing `estimateAgentCost()` + baseline system, so they benefit from historical data in `evolution_agent_cost_baselines` and fall back to heuristics when no baseline exists. Zod schemas use `z.record()` with no fixed keys — adding new agent keys is safe.

## Rollback Plan

All changes ship in a single PR. If the per-agent accuracy table regresses or new agent estimates are wildly inaccurate:
1. **Revert the PR** — single `git revert` restores previous behavior
2. Old runs with frozen `cost_prediction` JSONB are unaffected since the union-key fix only changes how the data is read, not written
3. New runs created after revert will return to the 7-agent estimator behavior automatically
