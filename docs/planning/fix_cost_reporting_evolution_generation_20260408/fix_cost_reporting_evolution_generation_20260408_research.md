# Fix Cost Reporting Evolution Generation Research

## Problem Statement
We want accurate generation vs. ranking costs for the `generateFromSeedArticle` agent, which currently approximates these as a 50/50 split in `persistRunResults.finalizeRun()`. We also want to see costs broken down by generation vs. ranking at the top level (entity list overview pages and metrics tab) for both strategy and run entities.

## Requirements (from GH Issue #931)
- Accurate generation vs. ranking costs for the `generateFromSeedArticle` agent (currently approximated 50/50).
- Cost breakdown by generation vs. ranking visible at top-level entity list overview pages.
- Cost breakdown by generation vs. ranking visible on the metrics tab.
- Apply at both strategy and run entity levels.

## High Level Summary

The 50/50 split is **not in the agent itself** — it lives at `evolution/src/lib/pipeline/finalize/persistRunResults.ts:295-321`, which buckets `evolution_agent_invocations.cost_usd` by `agent_name` and applies a hardcoded `cost / 2` split for `generate_from_seed_article` rows. The comment in that file calls it a "coarse approximation" pending a "non-shared per-call cost tracker."

**Critical insight from research:** The "non-shared per-call cost tracker" already effectively exists. Inside `generateFromSeedArticle.ts`, every LLM call goes through `llm.complete(prompt, agentName, ...)` where `agentName` is the literal string `'generation'` or `'ranking'` — these strings flow through `createLLMClient.ts` into `costTracker.recordSpend(agentName, actualCost)`, which buckets them under `phaseCosts['generation']` and `phaseCosts['ranking']` in a process-local in-memory accumulator. **`recordSpend` is fully synchronous and per-key isolated**, so `phaseCosts['generation']` is the precise sum of every generation LLM call across every concurrent agent in the run, with no race conditions. Same for `'ranking'` (which `SwissRankingAgent.ts:126` also writes to).

The catch: the cost tracker is **not currently in scope** inside `finalizeRun()`. It's instantiated in `runIterationLoop.ts:192`, lives for the duration of `evolveArticle()`, and only its aggregate `getTotalSpent()` is returned via `EvolutionResult.totalCost`. The fix is to extend `EvolutionResult` to also carry `phaseCosts: Record<string, number>` (from `costTracker.getPhaseCosts()`) so `finalizeRun` can read the per-purpose totals directly.

Once accurate run-level `total_generation_cost`/`total_ranking_cost` exist, surfacing them on UI requires:
1. Adding `listView: true` to the catalog/entity definitions (currently missing).
2. Adding propagation defs to `StrategyEntity.atPropagation` and `ExperimentEntity.atPropagation`.
3. Manually adding columns to the experiments page (it hardcodes columns rather than using `createMetricColumns`).
4. Run-detail metrics tab and strategy-detail metrics tab will auto-render once metrics exist (no UI changes needed).

## Key Findings

### F1. The 50/50 split lives at finalization, not in the agent
**File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts:295-321`

```typescript
// We deliberately do NOT use execution_detail.{generation,ranking}.cost sub-totals here:
// those are computed by per-agent costTracker.getTotalSpent() deltas which race against
// OTHER concurrent agents in the same iteration (the tracker is shared)... generate_from_seed_article
// is treated as 50/50 generation/ranking — a coarse approximation... The accurate split would
// require a non-shared per-call cost tracker, which is a follow-up.
let totalGenerationCost = 0;
let totalRankingCost = 0;
for (const inv of invocations) {
  const cost = Number(inv.cost_usd ?? 0);
  if (inv.agent_name === 'generate_from_seed_article') {
    totalGenerationCost += cost / 2;       // ← THE BUG
    totalRankingCost += cost / 2;
  } else if (inv.agent_name === 'swiss_ranking') {
    totalRankingCost += cost;
  } else if (inv.agent_name === 'generation') {
    totalGenerationCost += cost;
  } else if (inv.agent_name === 'ranking') {
    totalRankingCost += cost;
  }
}
await writeMetric(db, 'run', runId, 'total_generation_cost', totalGenerationCost, 'at_finalization');
await writeMetric(db, 'run', runId, 'total_ranking_cost', totalRankingCost, 'at_finalization');
```

### F2. The agent ALREADY labels its LLM calls correctly
- `evolution/src/lib/core/agents/generateFromSeedArticle.ts:207` → `llm.complete(prompt, 'generation', { invocationId, ... })`
- `evolution/src/lib/core/agents/SwissRankingAgent.ts:126` → `llm.complete(prompt, 'ranking', { ... })`
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts:169` → `llm.complete(prompt, 'ranking', { ... })` (called from `generateFromSeedArticle`'s ranking phase)

Both production agents pass literal strings — no dynamic agentName. Legacy agents (`evolution/src/lib/pipeline/setup/generateSeedArticle.ts:88,97` use `'seed_title'` / `'seed_article'`; `extractFeedback.ts` uses `'evolution'` but is dead code).

### F3. The cost tracker accumulator is race-free per phase key
**File:** `evolution/src/lib/pipeline/infra/trackBudget.ts:67-101`

`recordSpend(phase, actualCost, reservedAmount)` is fully synchronous:
```typescript
recordSpend(phase: string, actualCost: number, reservedAmount: number): void {
  totalReserved = Math.max(0, totalReserved - reservedAmount);
  totalSpent += actualCost;
  phaseCosts[phase] = (phaseCosts[phase] ?? 0) + actualCost;  // atomic in single-threaded JS
}
```

Because Node is single-threaded and there are no `await`s inside `recordSpend`, the `+=` is atomic. Different phase keys are independent. So `phaseCosts['generation']` is reliably the sum of every `'generation'` call across every concurrent agent, and `phaseCosts['ranking']` is the sum of every `'ranking'` call (including those from `SwissRankingAgent`).

### F4. The DB-persisted `agentCost:*` metric IS racy (separate concern)
**File:** `evolution/src/lib/pipeline/infra/createLLMClient.ts:85-100`

```typescript
costTracker.recordSpend(agentName, actual, margined);
if (db && runId) {
  const totalSpent = costTracker.getTotalSpent();
  const phaseCost = costTracker.getPhaseCosts()[agentName] ?? 0;
  await writeMetric(db, 'run', runId, 'cost', totalSpent, 'during_execution');
  await writeMetric(db, 'run', runId, `agentCost:${agentName}`, phaseCost, 'during_execution');
}
```

`writeMetric` upserts via Supabase with `onConflict: 'entity_type,entity_id,metric_name'` → `ON CONFLICT DO UPDATE SET value = EXCLUDED.value` (last-write-wins). With concurrent calls, an out-of-order network round-trip can overwrite a larger value with a smaller one. This means **the persisted `agentCost:generation` row in `evolution_metrics` cannot be trusted as the source of truth** — but the in-memory `phaseCosts['generation']` can.

**Conclusion:** Read from the in-memory tracker at finalization, not from the racy DB row. (A separate follow-up could add a `upsert_metric_max` RPC using `GREATEST(existing, new)` to fix the race for live during-execution displays — see Open Questions.)

### F5. Cost tracker is NOT currently passed to finalizeRun
**File:** `evolution/src/lib/pipeline/finalize/persistRunResults.ts:96-104`

```typescript
export async function finalizeRun(
  runId: string,
  result: EvolutionResult,
  run: RunContext,
  db: SupabaseClient,
  durationSeconds: number,
  logger?: EntityLogger,
  runnerId?: string,
): Promise<void>
```

Only `result.totalCost: number` is available — `result.phaseCosts` does not exist yet. The single in-process caller is `claimAndExecuteRun.ts:247` (called immediately after `evolveArticle()` returns). There is **no out-of-process / crash-recovery finalization path**, so an in-memory tracker IS available wherever `finalizeRun` is called. **The fix is to extend `EvolutionResult` and `runIterationLoop.ts:518` to include `phaseCosts: costTracker.getPhaseCosts()`**.

### F6. Metrics catalog has the metric names but missing `listView`
**File:** `evolution/src/lib/core/metricCatalog.ts:73-82`

```typescript
total_generation_cost: { name: 'total_generation_cost', label: 'Generation Cost', category: 'cost', formatter: 'cost', timing: 'at_finalization', description: '...' },
total_ranking_cost:    { name: 'total_ranking_cost', label: 'Ranking Cost', category: 'cost', formatter: 'cost', timing: 'at_finalization', description: '...' },
```

Neither has `listView: true`. To make them appear as columns on entity list pages, override with `listView: true` in `RunEntity.atFinalization`, `StrategyEntity.atPropagation`, and `ExperimentEntity.atPropagation`.

### F7. Strategy/experiment propagation defs are missing
**Files:**
- `evolution/src/lib/core/entities/StrategyEntity.ts:50-93` — has `total_cost` propagation but NOT `total_generation_cost`/`total_ranking_cost`.
- `evolution/src/lib/core/entities/ExperimentEntity.ts:34-77` — same gap.

Pattern to add:
```typescript
{ ...METRIC_CATALOG.total_generation_cost,
  listView: true,
  sourceEntity: 'run', sourceMetric: 'total_generation_cost',
  aggregate: aggregateSum, aggregationMethod: 'sum' },
{ ...METRIC_CATALOG.total_ranking_cost,
  listView: true,
  sourceEntity: 'run', sourceMetric: 'total_ranking_cost',
  aggregate: aggregateSum, aggregationMethod: 'sum' },
```

`propagateMetrics()` is called from `persistRunResults.ts:377-411` immediately after run-level finalization metrics are written, so propagation will pick up the new defs automatically.

### F8. UI auto-renders on three of four surfaces; experiments page is hardcoded
- **Run list** (`src/app/admin/evolution/runs/page.tsx`): uses `createRunsMetricColumns()` → reads `getListViewMetrics('run')`. Once `listView: true` is set on `RunEntity` for these metrics, columns appear automatically. Data is batch-fetched via `getBatchMetricsAction('run', ids, metricNames)`.
- **Strategy list** (`src/app/admin/evolution/strategies/page.tsx:52-58`): uses `createMetricColumns<StrategyListItem>('strategy')`. Auto-renders.
- **Experiments list** (`src/app/admin/evolution/experiments/page.tsx:68-108`): **hardcoded `COLUMNS` array — no `createMetricColumns` call**. Must be manually extended (or refactored to use `createMetricColumns`).
- **Run detail metrics tab** (`EntityMetricsTab.tsx`): generic — auto-renders any `evolution_metrics` row with `category: 'cost'` under the "Cost" group. Will work as soon as the rows exist.
- **Strategy / experiment detail metrics tabs**: same `EntityMetricsTab` — auto-render after propagation writes.

### F9. Tests that will need updating
- `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — has a test `'writes total_generation_cost and total_ranking_cost from invocation rows'` that asserts the 50/50 split. Must be rewritten to assert exact phase-cost values from a fixture-supplied `phaseCosts`.
- `evolution/src/lib/pipeline/infra/createLLMClient.test.ts` — has cost-write tests; should remain valid.
- `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` (if exists) — needs an assertion that `phaseCosts` flows into `EvolutionResult`.
- `evolution/src/lib/metrics/recomputeMetrics.test.ts` — propagation tests; add cases for new propagated metrics.
- E2E `src/__tests__/e2e/specs/09-admin/admin-evolution-*.spec.ts` — verify new columns visible.
- No test fixtures currently populate `evolution_agent_invocations.cost_usd` for end-to-end finalization tests.

### F10. `MetricName` type accommodates new metrics with no schema change
**File:** `evolution/src/lib/metrics/types.ts:20-41`

```typescript
export const STATIC_METRIC_NAMES = [
  'cost', ..., 'total_generation_cost', 'total_ranking_cost', ...
] as const;
export type MetricName = StaticMetricName | DynamicMetricName;  // DynamicMetricName = `agentCost:${string}`
```

Both metric names are already in `STATIC_METRIC_NAMES`. No type or migration changes needed.

### F11. `evolution_metrics` schema accommodates this with no migration
The table is EAV (rows keyed by `entity_type, entity_id, metric_name`). Adding new metric names is purely a code-side concern. No migration needed for the basic fix.

## Documents Read

### Core Docs
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`

### Evolution Docs (manually tagged)
- `evolution/docs/README.md`
- `evolution/docs/architecture.md`
- `evolution/docs/data_model.md`
- `evolution/docs/entities.md`
- `evolution/docs/metrics.md` — confirmed `total_generation_cost`/`total_ranking_cost` are written by `persistRunResults.finalizeRun()` from per-invocation `cost_usd`
- `evolution/docs/visualization.md` — admin page inventory; confirmed run cost has `listView: false` on registry and is fetched directly from `evolution_agent_invocations`
- `evolution/docs/cost_optimization.md`
- `evolution/docs/strategies_and_experiments.md`
- `evolution/docs/rating_and_comparison.md`
- `evolution/docs/arena.md`, `logging.md`, `curriculum.md`, `reference.md`, `minicomputer_deployment.md`, `agents/overview.md`

## Code Files Read

### LLM client / cost tracking
- `src/config/llmPricing.ts` — pricing table; not directly modified
- `src/lib/services/llms.ts` — V1 `callLLM` and `llmCallTracking` writes; `evolution_invocation_id` FK
- `src/lib/services/llmSemaphore.ts` — limits concurrent evolution LLM calls to 20 (not strict serialization)
- `evolution/src/lib/pipeline/infra/createLLMClient.ts` — V2 wrapper; line 87 `recordSpend(agentName, ...)`; lines 95-96 awaited writeMetric
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — `V2CostTracker`; sync `recordSpend`, `getTotalSpent`, `getPhaseCosts`

### Agents
- `evolution/src/lib/core/agents/generateFromSeedArticle.ts` — lines 181-325; lines 207, 282 are the LLM call sites
- `evolution/src/lib/core/agents/SwissRankingAgent.ts` — line 126
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` — line 169
- `evolution/src/lib/pipeline/setup/generateSeedArticle.ts` — legacy seed generation
- `evolution/src/lib/pipeline/loop/extractFeedback.ts` — dead code (not in active loop)

### Pipeline / finalization
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — `finalizeRun` lines 96-411; the 50/50 logic at 295-321
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — `evolveArticle`; line 192 cost tracker creation; line 518 `EvolutionResult` return
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — `executePipeline`, lines 158-172 LLM provider, line 247 `finalizeRun` call

### Metrics infrastructure
- `evolution/src/lib/metrics/registry.ts` — secondary registry (entities are now authoritative)
- `evolution/src/lib/metrics/types.ts` — `MetricName` union; `STATIC_METRIC_NAMES` array
- `evolution/src/lib/core/metricCatalog.ts` — base catalog; lines 73-82 for our metrics
- `evolution/src/lib/core/entities/RunEntity.ts` — `metrics.atFinalization` lines 38-52
- `evolution/src/lib/core/entities/StrategyEntity.ts` — `metrics.atPropagation` lines 50-93
- `evolution/src/lib/core/entities/ExperimentEntity.ts` — `metrics.atPropagation` lines 34-77
- `evolution/src/lib/core/entities/entityRegistry.ts` — `getEntity`, `getEntityListViewMetrics`
- `evolution/src/lib/metrics/writeMetrics.ts` — upsert with last-write-wins
- `evolution/src/lib/metrics/readMetrics.ts` — `getMetricsForEntities` batch reader
- `evolution/src/lib/metrics/recomputeMetrics.ts` — `recomputeRunEloMetrics`, `recomputePropagatedMetrics`
- `evolution/src/lib/metrics/metricColumns.tsx` — `createMetricColumns`, `createRunsMetricColumns`

### UI surfaces
- `evolution/src/components/evolution/tables/RunsTable.tsx` — base columns; cost column at lines 108-132
- `evolution/src/components/evolution/tabs/EntityMetricsTab.tsx` — generic metrics tab; auto-groups by category
- `src/app/admin/evolution/runs/page.tsx` — run list page; uses `createRunsMetricColumns()`
- `src/app/admin/evolution/strategies/page.tsx` — strategy list page; uses `createMetricColumns`
- `src/app/admin/evolution/experiments/page.tsx` — experiments list page; **hardcoded columns**
- `src/app/admin/evolution/runs/[runId]/page.tsx` — run detail; uses `EntityMetricsTab`
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx` — strategy detail; uses `EntityMetricsTab`
- `src/app/admin/evolution-dashboard/page.tsx` — dashboard

### Services / actions
- `evolution/src/services/evolutionActions.ts` — `getEvolutionRunsAction`; lines 234-251 cost batch fetch
- `evolution/src/services/metricsActions.ts` — `getBatchMetricsAction` (lines 70-122)

### Tests
- `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts`
- `evolution/src/lib/pipeline/infra/createLLMClient.test.ts`
- `evolution/src/lib/pipeline/infra/trackBudget.test.ts`
- `evolution/src/lib/pipeline/infra/trackInvocations.test.ts`
- `evolution/src/lib/metrics/recomputeMetrics.test.ts`
- `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts`
- `src/__tests__/integration/evolution-cost-fallback.integration.test.ts`
- `src/__tests__/integration/evolution-experiment-completion.integration.test.ts`
- `src/__tests__/e2e/specs/09-admin/admin-evolution-invocations.spec.ts`

## Decisions (resolved 2026-04-08)

1. **Fix `agentCost:*` write race — IN SCOPE.** Add a `upsert_metric_max(p_entity_type, p_entity_id, p_metric_name, p_value)` RPC using `ON CONFLICT DO UPDATE SET value = GREATEST(evolution_metrics.value, EXCLUDED.value)`. Apply to monotonically-increasing metrics: `cost`, `agentCost:*`, and (defensively) `total_generation_cost`/`total_ranking_cost`.

2. **Refactor experiments page** to use `createMetricColumns<ExperimentListItem>('experiment')` instead of the hardcoded `COLUMNS` array, matching the strategies page pattern. New propagated metrics will then surface automatically.

3. **Add totals + averages (4 propagated metrics)** to `StrategyEntity.atPropagation` and `ExperimentEntity.atPropagation`:
   - `total_generation_cost` (sum), `avg_generation_cost_per_run` (avg)
   - `total_ranking_cost` (sum), `avg_ranking_cost_per_run` (avg)
   Mirrors the existing `total_cost`/`avg_cost_per_run` pattern. Requires adding `avg_generation_cost_per_run` and `avg_ranking_cost_per_run` to `metricCatalog.ts` and `STATIC_METRIC_NAMES`.

4. **Backfill — leave historical 50/50 values as-is.** Going forward, new runs will record accurate values; historical runs retain the approximation.

## Open Questions (still need planning-time decisions)

- **Strategy list display width:** With `total_cost`, `total_generation_cost`, `total_ranking_cost` all `listView: true`, the strategy/experiment list rows get 3 cost columns side-by-side. Decide whether to (a) show all three, (b) hide `total_cost` and let users sum the split, or (c) replace with a single stacked cell. (Decide during plan brainstorm.)

- **Run list `total_cost_usd`** is currently fetched from invocations directly (not metrics). Keep dual path or migrate the total to metrics for consistency? (Decide during plan brainstorm.)
