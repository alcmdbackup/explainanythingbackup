# Over Budget Evolution Plan

## Background
Debug why evolution run [232a26c2] is over budget. The pipeline's budget enforcement mechanism (CostTracker with per-agent caps and global cap) should prevent runs from exceeding their budget, but this run appears to have spent more than allocated.

## Requirements (from GH Issue #427)
Investigate run 232a26c2, find where budget enforcement failed, and fix the root cause.

## Problem

Run `232a26c2` paused at iteration 11 with "Budget exceeded for pairwise: spent $1.0504, cap $1.0000". Two issues:

1. **Missing budget cap**: `PairwiseRanker.name = 'pairwise'` but `budgetCaps` has no `pairwise` entry — falls back to default 20% ($1.00). Meanwhile `tournament: 0.20` goes unused since Tournament delegates all LLM calls to PairwiseRanker.

2. **Dashboard cost contamination**: All 3 dashboard cost queries use `llmCallTracking` with time-window correlation (no `run_id` column). Parallel/overlapping runs contaminate each other's results. The run-scoped `evolution_agent_invocations` table (which has `run_id`) already contains per-iteration cumulative cost data but isn't used for dashboards.

## Options Considered

### For parallel run cost isolation
1. **Add `run_id` to `llmCallTracking`** — Thread run ID through `saveLlmCallTracking()` for exact per-call attribution. Requires migration + plumbing through all callers.
2. **Switch dashboard queries to `evolution_agent_invocations`** (chosen) — Already has `run_id` and per-iteration cumulative cost data. No migration needed. Per-agent total = MAX(cost_usd) since values are cumulative. Per-iteration delta = diff between consecutive iterations for same agent.

Option 2 chosen because the data already exists — just needs queries rewired.

## Phased Execution Plan

### Phase 1: Config fix (root cause)

**File**: `src/lib/evolution/config.ts` (line 22-34)

Add `pairwise: 0.20` to `budgetCaps`. Matches what `tournament` has since tournament delegates all LLM work to pairwise.

### Phase 2: Rewrite `getEvolutionCostBreakdownAction`

**File**: `src/lib/services/evolutionActions.ts` (lines 619-675)

Current: Queries `llmCallTracking` with time window, groups by agent.
New: Query `evolution_agent_invocations` with `run_id`. Per-agent total = MAX(cost_usd) grouped by agent_name. `calls` field becomes invocation count (iterations agent ran) instead of LLM call count — UI displays as `{b.calls}x` in `AgentCostChart` (page.tsx:146), still reads naturally.

### Phase 3: Rewrite `getEvolutionRunBudgetAction`

**File**: `src/lib/services/evolutionVisualizationActions.ts` (lines 679-746)

Current: Queries `llmCallTracking`, builds agent breakdown + cumulative burn curve (one point per LLM call).
New: Query `evolution_agent_invocations` ordered by `(iteration, execution_order)`.

- **Agent breakdown**: MAX(cost_usd) per agent (same as Phase 2).
- **Cumulative burn curve**: For each invocation, delta = `cost_usd - prev_cost_for_same_agent`. Running sum of deltas = cumulative. Points at agent-iteration granularity instead of per-LLM-call — fewer points, more meaningful.

### Phase 4: Rewrite `getEvolutionRunTimelineAction` cost attribution

**File**: `src/lib/services/evolutionVisualizationActions.ts` (lines 370-425)

Current: Builds time boundaries from checkpoints, queries `llmCallTracking`, attributes calls by time + agent name fuzzy match (55 lines).
New: Extend the existing invocation query (line 490, already fetches `iteration, agent_name` for `hasExecutionDetail`) to also select `cost_usd`. Build `costMap` from invocation deltas per `"iteration-agent"` key. Remove the entire `llmCallTracking` query block and `boundaries` computation.

Delta computation:
```ts
const prevCost = new Map<string, number>(); // agent → last cumulative cost
for (const inv of sortedInvocations) {
  const prev = prevCost.get(inv.agent_name) ?? 0;
  const delta = inv.cost_usd - prev;
  costMap.set(`${inv.iteration}-${inv.agent_name}`, delta);
  prevCost.set(inv.agent_name, inv.cost_usd);
}
```

### Phase 5: Update tests

| Test file | Changes |
|-----------|---------|
| `src/lib/services/evolutionVisualizationActions.test.ts` | Remove `llmCallTracking` mocks, add `evolution_agent_invocations` mocks for timeline + budget |
| `src/__tests__/integration/evolution-actions.integration.test.ts` | Update cost breakdown test expectations |
| `src/__tests__/integration/evolution-visualization.integration.test.ts` | Update timeline/budget tests |
| `src/components/evolution/tabs/BudgetTab.test.tsx` | Update if BudgetData shape changes |
| `src/components/evolution/tabs/TimelineTab.test.tsx` | Update if needed |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/evolution/config.ts` | Add `pairwise: 0.20` to budgetCaps |
| `src/lib/services/evolutionActions.ts` | Rewrite `getEvolutionCostBreakdownAction` |
| `src/lib/services/evolutionVisualizationActions.ts` | Rewrite timeline + budget cost queries |
| `src/lib/services/evolutionVisualizationActions.test.ts` | Update mocked queries |
| `src/__tests__/integration/evolution-actions.integration.test.ts` | Update cost breakdown test |
| `src/__tests__/integration/evolution-visualization.integration.test.ts` | Update timeline/budget tests |

## Testing

1. `npx tsc --noEmit` — type check
2. `npx next lint` — lint
3. `npx jest --testPathPattern="evolutionVisualizationActions|evolution-actions|evolution-visualization|BudgetTab|TimelineTab"` — unit + integration tests
4. `npm run build` — full build
5. Manual: Load run detail page for a completed evolution run, verify Budget tab shows agent breakdown and burn chart, Timeline tab shows per-agent costs

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/cost_optimization.md` - Cost tracking and budget enforcement details
- `docs/evolution/reference.md` - Budget caps and configuration defaults
- `docs/evolution/architecture.md` - Pipeline architecture and budget flow
- `docs/evolution/strategy_experiments.md` - Strategy experiment cost constraints
- `docs/evolution/data_model.md` - Cost tracking data model
- `docs/evolution/agents/overview.md` - Agent budget enforcement patterns
- `docs/evolution/visualization.md` - Budget tab and cost visualization
- `docs/evolution/agents/generation.md` - Generation agent budget caps
- `docs/evolution/rating_and_comparison.md` - Comparison cost impact
- `docs/evolution/agents/tree_search.md` - Tree search budget cap
