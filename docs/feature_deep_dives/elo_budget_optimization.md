# Elo Budget Optimization

This feature maximizes Elo improvement per dollar spent by measuring agent effectiveness, tracking costs, and enabling systematic experimentation with model/iteration configurations.

## Overview

The evolution pipeline previously used hardcoded budget allocations and lacked visibility into which configurations produce the best Elo/dollar ratio. This feature adds:

1. **Cost Attribution** - Per-agent and per-variant cost tracking
2. **Cost Estimation** - Data-driven predictions from historical LLM calls
3. **Batch Experiments** - JSON-driven combinatorial exploration
4. **Adaptive Allocation** - ROI-based budget shifting
5. **Strategy Analysis** - Dashboard for Pareto-optimal configuration discovery

### The Optimization Loop

```
Measure → Instrument → Predict → Explore → Optimize → Measure...
    ↑__________________________________________|
```

## Key Files

### Core Infrastructure

| File | Purpose |
|------|---------|
| `src/lib/evolution/core/costTracker.ts` | Budget tracking with `getAllAgentCosts()` |
| `src/lib/evolution/core/costEstimator.ts` | Data-driven cost predictions |
| `src/lib/evolution/core/adaptiveAllocation.ts` | ROI-based budget allocation |
| `src/lib/evolution/core/strategyConfig.ts` | Strategy hashing and labeling |

### Configuration & Execution

| File | Purpose |
|------|---------|
| `src/config/batchRunSchema.ts` | Zod schemas for batch config |
| `scripts/run-batch.ts` | CLI for batch experiments |

### Server Actions

| File | Purpose |
|------|---------|
| `src/lib/services/eloBudgetActions.ts` | Dashboard data queries |

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

## Implementation

### Cost Attribution

The `CostTracker` interface was extended with `getAllAgentCosts()`:

```typescript
// src/lib/evolution/types.ts
export interface CostTracker {
  // ... existing methods
  getAllAgentCosts(): Record<string, number>;
}
```

At the end of each pipeline run, agent metrics are persisted to `evolution_run_agent_metrics`:

```typescript
// src/lib/evolution/core/pipeline.ts
async function persistAgentMetrics(
  runId: string,
  costTracker: CostTracker,
  state: PipelineState
): Promise<void>
```

### Cost Estimation

The `costEstimator.ts` module provides data-driven predictions:

```typescript
// Estimate cost for a run with per-agent model overrides
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

### Strategy Identity

Each unique configuration gets a stable hash for deduplication:

```typescript
// src/lib/evolution/core/strategyConfig.ts
const hash = hashStrategyConfig({
  generationModel: 'deepseek-chat',
  judgeModel: 'gpt-4.1-nano',
  agentModels: { tournament: 'gpt-4.1-mini' },
  iterations: 10,
  budgetCaps: { generation: 0.25, ... }
});
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

Expands to: 2 prompts × 2 models × 1 judge × 3 iterations × 2 variants = **24 runs**

Run with:
```bash
npx tsx scripts/run-batch.ts --config experiments/my-batch.json --dry-run
```

### Adaptive Allocation

Automatically shifts budget toward high-ROI agents:

```typescript
// src/lib/evolution/core/adaptiveAllocation.ts
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
npx tsx scripts/evolution-runner.ts --max-runs 1
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
npx tsx scripts/run-batch.ts --config experiments/my_experiment.json --dry-run
```

This shows estimated costs, run order, and which runs fit within budget.

**Note**: Full batch execution (with `--confirm`) currently simulates runs. Integration with the actual pipeline is planned.

4. **View results** at `/admin/quality/optimization`

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

## Testing

```bash
# Unit tests
npm test -- src/lib/evolution/core/costTracker.test.ts
npm test -- src/lib/evolution/core/costEstimator.test.ts
npm test -- src/lib/evolution/core/adaptiveAllocation.test.ts
npm test -- src/lib/evolution/core/strategyConfig.test.ts
npm test -- src/lib/services/eloBudgetActions.test.ts
npm test -- src/config/batchRunSchema.test.ts

# All Elo optimization tests
npm test -- --testPathPatterns="costTracker|costEstimator|adaptiveAllocation|strategyConfig|eloBudgetActions|batchRunSchema"
```

## Known Limitations

1. **Per-agent model overrides not yet in pipeline**: The `agentModels` field is defined in the batch schema but not yet wired through the evolution pipeline. For now, use `generationModel` and `judgeModel` for all agents.

2. **Secondary dashboard components partially implemented**: Remaining components:
   - StrategyComparison (side-by-side strategy comparison)
   - StrategyRecommender (budget-aware recommendation UI)
   - AgentCostByModel (per-model cost breakdown)
   - AgentBudgetOptimizer (suggested budget allocation UI)

   Implemented components:
   - StrategyDetail (full run history for a strategy) ✅
   - CostBreakdownPie (cost distribution chart) ✅

3. **Integration tests**: E2E tests for the dashboard are not yet written.

4. **Strategy metrics require runs**: The strategy_configs table aggregates metrics from evolution runs. With no runs, the dashboard shows empty states.

## Related Documentation

- [Evolution Pipeline](./evolution_pipeline.md) - Core evolution system
- [Hierarchical Decomposition Agent](./hierarchical_decomposition_agent.md) - Section-level editing agent with 10% budget cap (`budgetCaps.sectionDecomposition`)
- [Comparison Infrastructure](./comparison_infrastructure.md) - Elo ranking system
- [Project Workflow](../docs_overall/project_workflow.md) - Development process
