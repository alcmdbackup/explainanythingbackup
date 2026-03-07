# Cost Optimization

Cost tracking, Pareto frontier analysis, and batch experiments for maximizing skill rating improvement per dollar spent.

## Overview

The evolution pipeline previously used hardcoded budget allocations and lacked visibility into which configurations produce the best Elo/dollar ratio. This feature adds:

1. **Cost Attribution** — Per-agent and per-variant cost tracking
2. **Cost Estimation** — Data-driven predictions from historical LLM calls
3. **Batch Experiments** — JSON-driven combinatorial exploration
4. **Strategy Analysis** — Dashboard for Pareto-optimal configuration discovery

### The Optimization Loop

```
Measure → Instrument → Predict → Explore → Optimize → Measure...
    ↑__________________________________________|
```

## Implementation

### Cost Attribution

The `CostTracker` interface was extended with `getAllAgentCosts()`:

```typescript
// evolution/src/lib/types.ts
export interface CostTracker {
  // ... existing methods
  getAllAgentCosts(): Record<string, number>;
}
```

At the end of each pipeline run, agent metrics are persisted to `evolution_run_agent_metrics`:

```typescript
// evolution/src/lib/core/metricsWriter.ts
async function persistAgentMetrics(
  runId: string,
  ctx: ExecutionContext,
  logger: EvolutionLogger
): Promise<void>
```


Agent ROI metrics (`avg_elo`, `elo_gain`, `elo_per_dollar`) use the Elo scale (0-3000) via `ordinalToEloScale(getOrdinal(rating))`, consistent with all other rating paths. Strategy-to-agent mapping is handled by `getAgentForStrategy()`, which supports direct lookups, prefix matching for `critique_edit_*`, `section_decomposition_*`, and `tree_search_*` strategies.

**Checkpoint restore**: When resuming from continuation, `CostTracker.restoreSpent(amount)` sets the `totalSpent` baseline from the checkpoint without touching per-agent tracking or reservations. The factory `createCostTrackerFromCheckpoint(config, restoredTotalSpent)` creates a pre-loaded tracker. This ensures budget enforcement is accurate across continuation boundaries.

**Reservation cleanup**: When an LLM call fails (network error, timeout, etc.), the pre-call reservation is released via `releaseReservation(agentName)`. This prevents orphaned reservations from permanently reducing available budget — a bug that previously caused premature budget exhaustion in production.

**Budget event audit log**: Every reserve, spend, and release event is logged to the `evolution_budget_events` table for post-mortem debugging. The event logger is wired via `CostTracker.setEventLogger()` in `preparePipelineRun()`. Query with:
```sql
SELECT event_type, agent_name, amount_usd, total_spent_usd, total_reserved_usd, available_budget_usd
FROM evolution_budget_events
WHERE run_id = '<run-id>'
ORDER BY created_at;
```

### Cost Estimation

The `costEstimator.ts` module provides data-driven predictions:

```typescript
const estimate = await estimateRunCostWithAgentModels({
  generationModel: 'deepseek-chat',
  judgeModel: 'gpt-4.1-nano',
  maxIterations: 10,
  agentModels: { tournament: 'gpt-4.1-mini' },
  enabledAgents: ['reflection', 'iterativeEditing', 'treeSearch'],
  singleArticle: false,
}, textLength);

// Result: { totalUsd, perAgent, perIteration, confidence }
```

Features:
- In-memory cache with 5-minute TTL
- Minimum 50 samples for high-confidence baselines
- Text length scaling for proportional estimates
- Heuristic fallback when no baseline exists
- `enabledAgents` filtering: only estimates agents that will actually run (required agents always included; optional agents only if in `enabledAgents`)
- `singleArticle` mode: skips `generation`, `outlineGeneration`, `evolution` agents (via `SINGLE_ARTICLE_DISABLED`)
- Estimates 11 agents total: 7 original (`generation`, `evolution`, `reflection`, `debate`, `iterativeEditing`, `calibration`, `tournament`) + 4 newly added (`treeSearch`, `outlineGeneration`, `sectionDecomposition`, `flowCritique`). `proximity` and `metaReview` make zero LLM calls so are not estimated

### Pre-Run Cost Estimate UI

The `StartRunCard` on the evolution admin page calls `estimateRunCostAction` (debounced 500ms) when a strategy is selected. It displays total estimated cost, confidence level, budget-exceeded warnings, and a collapsible per-agent breakdown with bar charts.

### Cost Prediction at Completion

When a pipeline run completes, `persistCostPrediction()` (in `metricsWriter.ts`) queries the `evolution_agent_invocations` table for actual per-agent costs (single source of truth), then calls `computeCostPrediction(estimated, actualTotalUsd, perAgentCosts)` to produce a `CostPrediction` comparing the pre-run estimate to actual costs. `computeCostPrediction` iterates the **union** of estimated and actual agent keys, so agents that ran but weren't estimated appear with `estimated: 0`, and agents that were estimated but didn't run appear with `actual: 0`. This is stored in `evolution_runs.cost_prediction` (JSONB) and includes `deltaPercent`, per-agent estimated vs actual, and overall confidence. After writing the prediction, `refreshAgentCostBaselines(30)` is called (non-blocking) to update the baselines used for future estimates.

### Cost Accuracy Dashboard

The optimization dashboard includes a **Cost Accuracy** tab (`CostAccuracyPanel`) that shows:
- Confidence calibration cards (avg |delta%| per confidence level)
- Delta trend line chart over recent runs
- Per-agent accuracy table (avg estimated vs avg actual) — includes all agents from the union of estimated and actual keys, so agents that ran but weren't originally estimated (e.g., `treeSearch`, `flowCritique`) now appear with their actual costs
- Outlier list (runs >50% off estimate, linked to run detail)

Data is served by `getCostAccuracyOverviewAction` in `costAnalyticsActions.ts`. Strategy-level accuracy stats are shown in `StrategyDetailRow` via `getStrategyAccuracyAction`.

### Strategy Identity and Pre-Registration

Each unique configuration gets a stable hash for deduplication. Strategies are pre-registered at run creation time by experiments (`created_by: 'experiment'`), making them visible in the leaderboard immediately rather than waiting for pipeline completion. The atomic `resolveOrCreateStrategyFromRunConfig()` in `strategyResolution.ts` uses an INSERT-first pattern to eliminate TOCTOU race conditions.

`normalizeEnabledAgents()` ensures consistent hashing: `undefined` → omit, `[]` → `undefined`, non-empty → sort alphabetically.

```typescript
// evolution/src/lib/core/strategyConfig.ts
const hash = hashStrategyConfig({
  generationModel: 'deepseek-chat',
  judgeModel: 'gpt-4.1-nano',
  iterations: 10,
  enabledAgents: ['reflection', 'iterativeEditing', ...],
  singleArticle: false,
});
// Note: agentModels and budgetCaps are excluded from the hash
// => "a1b2c3d4e5f6" (12-char SHA256 prefix)

const label = labelStrategyConfig(config);
// => "Gen: ds-chat | Judge: 4.1-nano | 10 iters | Overrides: tournament: 4.1-mini"
```

### Dashboard

Access at `/admin/evolution/analysis` with three tabs:

**Tab 1: Strategy Analysis**
- Sortable leaderboard by rating, elo/$, runs, consistency
- Pareto frontier scatter plot (cost vs rating)
- Click-to-expand config details

**Tab 2: Agent Analysis**
- Agent ROI leaderboard with bar visualization
- Insights on which agents to invest in

**Tab 3: Cost Analysis**
- Summary cards: total runs, total spent, best elo/$ (derived display metric)

## Usage

### Running Experiments

Use the admin UI at `/admin/evolution/analysis` to create experiments with factor selection, or queue individual runs via the evolution page. Runs execute via Vercel serverless (cron-driven). View results at `/admin/evolution/analysis`.

### Interpreting Results

**Pareto frontier**: Points on the frontier represent optimal cost-rating tradeoffs. Non-dominated strategies have no other strategy that is both cheaper AND higher rated.

**elo/dollar** (`elo_per_dollar`): Higher is better. Uses the derived `elo_rating` display value (0–3000 scale via `ordinalToEloScale`). A strategy with 2000 elo/$ produces twice as much display-rating improvement per dollar as one with 1000 elo/$.

**Consistency (stddev)**: Lower is better. Indicates how reliable results are across runs.

## Server Actions API

| Action | Purpose |
|--------|---------|
| `getAgentROILeaderboardAction()` | Agent Elo/$ rankings |
| `getAgentCostByModelAction()` | Cost by model for an agent |
| `getStrategyLeaderboardAction()` | Strategy rankings |
| `resolveStrategyConfigAction()` | Get/create strategy entry |
| `updateStrategyAction()` | Update strategy name/description |
| `getStrategyParetoAction()` | Cost vs Elo Pareto frontier |
| `getRecommendedStrategyAction()` | Budget-aware recommendation |
| `getOptimizationSummaryAction()` | Dashboard summary stats |
| `getStrategyRunsAction()` | Runs for a specific strategy |
| `getPromptRunsAction()` | Runs for a specific prompt |

## Key Files

### Core Infrastructure
| File | Purpose |
|------|---------|
| `evolution/src/lib/core/costTracker.ts` | Budget tracking with `getAllAgentCosts()` and per-invocation cost accumulation via `getInvocationCost(invocationId)` |
| `evolution/src/lib/core/llmClient.ts` | `estimateTokenCost()` — task-aware cost estimation with `taskType` discriminator |
| `evolution/src/lib/core/costEstimator.ts` | Data-driven cost predictions |
| `evolution/src/lib/core/strategyConfig.ts` | Strategy hashing, labeling, and `normalizeEnabledAgents()` |
| `evolution/src/services/strategyResolution.ts` | Atomic strategy resolution (INSERT-first upsert) for experiments |

### Server Actions
| File | Purpose |
|------|---------|
| `evolution/src/services/eloBudgetActions.ts` | Dashboard data queries |
| `evolution/src/services/costAnalyticsActions.ts` | `getCostAccuracyOverviewAction`, `getStrategyAccuracyAction` for Cost Accuracy tab |

### Dashboard UI
| File | Purpose |
|------|---------|
| `src/app/admin/evolution/analysis/page.tsx` | Main dashboard page |
| `_components/CostSummaryCards.tsx` | Metric summary cards |
| `_components/StrategyLeaderboard.tsx` | Sortable strategy table |
| `_components/StrategyParetoChart.tsx` | Cost vs Elo scatter plot |
| `_components/StrategyConfigDisplay.tsx` | Config detail view |
| `_components/AgentROILeaderboard.tsx` | Agent efficiency ranking |

### Database Migrations
| Migration | Creates |
|-----------|---------|
| `20260205000001_add_evolution_run_agent_metrics.sql` | `evolution_run_agent_metrics` table |
| `20260205000002_add_variant_cost.sql` | `cost_usd` column on variants |
| `20260205000003_add_evolution_agent_cost_baselines.sql` | `evolution_agent_cost_baselines` table |
| `20260205000005_add_strategy_configs.sql` | `evolution_strategy_configs` table |
| `20260306000001_evolution_budget_events.sql` | `evolution_budget_events` audit log |

## Testing

```bash
# Unit tests
npm test -- evolution/src/lib/core/costTracker.test.ts
npm test -- evolution/src/lib/core/costEstimator.test.ts
npm test -- evolution/src/lib/core/strategyConfig.test.ts
npm test -- evolution/src/services/eloBudgetActions.test.ts

# All cost optimization tests
npm test -- --testPathPatterns="costTracker|costEstimator|strategyConfig|eloBudgetActions"
```

## Known Limitations

1. **Per-agent model overrides**: The `agentModels` field in strategy configs is functional via `estimateRunCostWithAgentModels()` for cost estimation and can be used to route specific agents to different models.
2. **Secondary dashboard components partially implemented**: Remaining: StrategyComparison, StrategyRecommender, AgentCostByModel, AgentBudgetOptimizer. Implemented: StrategyDetail, CostBreakdownPie.
3. **Integration tests**: E2E tests for the dashboard are not yet written.
4. **Strategy metrics require runs**: The evolution_strategy_configs table aggregates metrics from evolution runs. With no runs, the dashboard shows empty states.

## Related Documentation

- [Architecture](./architecture.md) — Core evolution pipeline
- [Arena](./arena.md) — OpenSkill rating system for cross-method comparison
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating used within pipeline runs
- [Visualization](./visualization.md) — Dashboard and visualization components
- [Reference](./reference.md) — Budget caps, configuration, database schema
- [Strategy Experiments](./strategy_experiments.md) — Manual experiment system for comparing pipeline configurations
