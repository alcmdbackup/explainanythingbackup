# Cost Optimization

Cost tracking, adaptive allocation, Pareto frontier analysis, and batch experiments for maximizing Elo improvement per dollar spent.

## Overview

The evolution pipeline previously used hardcoded budget allocations and lacked visibility into which configurations produce the best Elo/dollar ratio. This feature adds:

1. **Cost Attribution** — Per-agent and per-variant cost tracking
2. **Cost Estimation** — Data-driven predictions from historical LLM calls
3. **Batch Experiments** — JSON-driven combinatorial exploration
4. **Adaptive Allocation** — ROI-based budget shifting
5. **Strategy Analysis** — Dashboard for Pareto-optimal configuration discovery

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
// evolution/src/lib/core/pipeline.ts
async function persistAgentMetrics(
  runId: string,
  costTracker: CostTracker,
  state: PipelineState
): Promise<void>
```

**Checkpoint restore**: When resuming from continuation, `CostTracker.restoreSpent(amount)` sets the `totalSpent` baseline from the checkpoint without touching per-agent tracking or reservations. The factory `createCostTrackerFromCheckpoint(config, restoredTotalSpent)` creates a pre-loaded tracker. This ensures budget enforcement is accurate across continuation boundaries.

### Cost Estimation

The `costEstimator.ts` module provides data-driven predictions:

```typescript
const estimate = await estimateRunCostWithAgentModels({
  generationModel: 'deepseek-chat',
  judgeModel: 'gpt-4.1-nano',
  maxIterations: 10,
  agentModels: { tournament: 'gpt-4.1-mini' }
}, textLength);

// Result: { totalUsd, perAgent, perIteration, confidence }
```

Features:
- In-memory cache with 5-minute TTL
- Minimum 50 samples for high-confidence baselines
- Text length scaling for proportional estimates
- Heuristic fallback when no baseline exists

### Pre-Run Cost Estimate UI

The `StartRunCard` on the evolution admin page calls `estimateRunCostAction` (debounced 500ms) when a strategy is selected. It displays total estimated cost, confidence level, budget-exceeded warnings, and a collapsible per-agent breakdown with bar charts.

### Cost Prediction at Completion

When a pipeline run completes, `finalizePipelineRun()` computes a `CostPrediction` comparing the pre-run estimate to actual costs. This is stored in `content_evolution_runs.cost_prediction` (JSONB) and includes `deltaPercent`, per-agent estimated vs actual, and overall confidence. After writing the prediction, `refreshAgentCostBaselines(30)` is called (non-blocking) to update the baselines used for future estimates.

### Cost Accuracy Dashboard

The optimization dashboard includes a **Cost Accuracy** tab (`CostAccuracyPanel`) that shows:
- Confidence calibration cards (avg |delta%| per confidence level)
- Delta trend line chart over recent runs
- Per-agent accuracy table (avg estimated vs avg actual)
- Outlier list (runs >50% off estimate, linked to run detail)

Data is served by `getCostAccuracyOverviewAction` in `costAnalyticsActions.ts`. Strategy-level accuracy stats are shown in `StrategyDetailRow` via `getStrategyAccuracyAction`.

### Strategy Identity

Each unique configuration gets a stable hash for deduplication:

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

### Batch Configuration

JSON-based experiment definition with Cartesian product expansion:

```json
{
  "name": "model_comparison_experiment",
  "totalBudgetUsd": 50.00,
  "matrix": {
    "prompts": ["Explain photosynthesis", "Explain blockchain"],
    "generationModels": ["deepseek-chat", "gpt-4.1-mini"],
    "judgeModels": ["gpt-4.1-nano"],
    "iterations": [5, 10, 15],
    "agentModelVariants": [
      {},
      { "tournament": "gpt-4.1-mini" }
    ]
  }
}
```

Expands to: 2 prompts x 2 models x 1 judge x 3 iterations x 2 variants = **24 runs**

Run with:
```bash
npx tsx evolution/scripts/run-batch.ts --config experiments/my-batch.json --dry-run
```

### Adaptive Allocation (Intentionally Unused)

> **Note:** This module (`evolution/src/lib/core/adaptiveAllocation.ts`) is implemented but intentionally not wired into the pipeline. It exists as an experimental prototype for future ROI-based budget shifting. The pipeline currently uses static budget caps from `DEFAULT_EVOLUTION_CONFIG`.

Design intent — shifts budget toward high-ROI agents:

```typescript
// evolution/src/lib/core/adaptiveAllocation.ts (NOT ACTIVE)
const caps = await computeAdaptiveBudgetCaps(
  lookbackDays: 30,
  minFloor: 0.05,    // No agent below 5%
  maxCeiling: 0.40   // No agent above 40%
);
// => { generation: 0.35, calibration: 0.15, tournament: 0.20, ... }
```

### Dashboard

Access at `/admin/quality/optimization` with three tabs:

**Tab 1: Strategy Analysis**
- Sortable leaderboard by Elo, Elo/$, runs, consistency
- Pareto frontier scatter plot (cost vs Elo)
- Click-to-expand config details

**Tab 2: Agent Analysis**
- Agent ROI leaderboard with bar visualization
- Insights on which agents to invest in

**Tab 3: Cost Analysis**
- Summary cards: total runs, total spent, best Elo/$

## Usage

### Running Experiments

#### Option A: Manual Evolution Runs (Recommended for now)

The full batch execution integration is pending. For now, use the existing workflow:

1. **Create an explanation** with your target content
2. **Queue an evolution run** via the admin UI or API
3. **Run the evolution runner**:
```bash
npx tsx evolution/scripts/evolution-runner.ts --max-runs 1
```

#### Option B: Batch Planning (Preview Mode)

Use the batch CLI to plan experiments and estimate costs:

1. **Create batch config** in `experiments/`:
```json
{
  "name": "my_experiment",
  "totalBudgetUsd": 20.00,
  "matrix": {
    "prompts": ["Your topic here"],
    "generationModels": ["deepseek-chat"],
    "judgeModels": ["gpt-4.1-nano"],
    "iterations": [5, 10]
  }
}
```

2. **Preview execution plan** with `--dry-run`:
```bash
npx tsx evolution/scripts/run-batch.ts --config experiments/my_experiment.json --dry-run
```

3. **View results** at `/admin/quality/optimization`

### Interpreting Results

**Pareto frontier**: Points on the frontier represent optimal cost-Elo tradeoffs. Non-dominated strategies have no other strategy that is both cheaper AND higher Elo.

**Elo/dollar**: Higher is better. A strategy with 2000 Elo/$ produces twice as much improvement per dollar as one with 1000 Elo/$.

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
| `evolution/src/lib/core/costTracker.ts` | Budget tracking with `getAllAgentCosts()` |
| `evolution/src/lib/core/costEstimator.ts` | Data-driven cost predictions |
| `evolution/src/lib/core/adaptiveAllocation.ts` | ROI-based budget allocation |
| `evolution/src/lib/core/strategyConfig.ts` | Strategy hashing and labeling |

### Configuration & Execution
| File | Purpose |
|------|---------|
| `src/config/batchRunSchema.ts` | Zod schemas for batch config |
| `evolution/scripts/run-batch.ts` | CLI for batch experiments |

### Server Actions
| File | Purpose |
|------|---------|
| `evolution/src/services/eloBudgetActions.ts` | Dashboard data queries |
| `evolution/src/services/costAnalyticsActions.ts` | `getCostAccuracyOverviewAction`, `getStrategyAccuracyAction` for Cost Accuracy tab |

### Dashboard UI
| File | Purpose |
|------|---------|
| `src/app/admin/quality/optimization/page.tsx` | Main dashboard page |
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
| `20260205000003_add_agent_cost_baselines.sql` | `agent_cost_baselines` table |
| `20260205000004_add_batch_runs.sql` | `batch_runs` table |
| `20260205000005_add_strategy_configs.sql` | `strategy_configs` table |

## Testing

```bash
# Unit tests
npm test -- evolution/src/lib/core/costTracker.test.ts
npm test -- evolution/src/lib/core/costEstimator.test.ts
npm test -- evolution/src/lib/core/adaptiveAllocation.test.ts
npm test -- evolution/src/lib/core/strategyConfig.test.ts
npm test -- evolution/src/services/eloBudgetActions.test.ts
npm test -- src/config/batchRunSchema.test.ts

# All Elo optimization tests
npm test -- --testPathPatterns="costTracker|costEstimator|adaptiveAllocation|strategyConfig|eloBudgetActions|batchRunSchema"
```

## Known Limitations

1. **Per-agent model overrides not yet in pipeline**: The `agentModels` field is defined in the batch schema but not yet wired through the evolution pipeline. For now, use `generationModel` and `judgeModel` for all agents.
2. **Secondary dashboard components partially implemented**: Remaining: StrategyComparison, StrategyRecommender, AgentCostByModel, AgentBudgetOptimizer. Implemented: StrategyDetail, CostBreakdownPie.
3. **Integration tests**: E2E tests for the dashboard are not yet written.
4. **Strategy metrics require runs**: The strategy_configs table aggregates metrics from evolution runs. With no runs, the dashboard shows empty states.

## Related Documentation

- [Architecture](./architecture.md) — Core evolution pipeline
- [Hall of Fame](./hall_of_fame.md) — Elo ranking system for cross-method comparison
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating used within pipeline runs
- [Visualization](./visualization.md) — Dashboard and visualization components
- [Reference](./reference.md) — Budget caps, configuration, database schema
- [Strategy Experiments](./strategy_experiments.md) — Factorial design for finding Elo-optimal configurations
