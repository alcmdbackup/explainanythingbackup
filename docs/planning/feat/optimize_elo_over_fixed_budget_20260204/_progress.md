# Optimize Elo Over Fixed Budget Progress

## Phase 1: Establish Baselines
### Work Done
- Created `scripts/query-elo-baselines.ts` to query existing data
- Queried article_bank_entries + article_bank_elo for method effectiveness
- Queried llmCallTracking for agent cost baselines

### Baseline Results
**Method Effectiveness (sorted by Elo/dollar):**
| Method | Model | Count | Avg Elo | Avg Cost | Elo/Dollar |
|--------|-------|-------|---------|----------|------------|
| evolution_winner | deepseek-chat | 15 | 1247.7 | $0.029 | 2160.2 |
| evolution_winner | grounding_enhance | 1 | 1178.0 | $0.060 | -365.8 |
| oneshot | gpt-4.1-mini | 5 | 1188.3 | $0.007 | -2072.0 |

**Agent Costs (30-day window):**
| Agent | Model | Calls | Avg Cost | Total Cost |
|-------|-------|-------|----------|------------|
| calibration | deepseek-chat | 812 | $0.000231 | $0.19 |
| generation | deepseek-chat | 144 | $0.000302 | $0.04 |

**Key Finding:** evolution_winner with deepseek-chat achieves 2160 Elo/dollar - this is our best current configuration to beat.

### Issues Encountered
- None - baseline queries executed successfully

## Phase 2: Instrument Cost Attribution
### Work Done
- Added `getAllAgentCosts()` to CostTracker interface in `types.ts`
- Implemented method in `CostTrackerImpl` (`core/costTracker.ts`)
- Added `costUsd?: number` to `TextVariation` interface
- Created migration `20260205000001_add_evolution_run_agent_metrics.sql`:
  - New table with run_id, agent_name, cost_usd, variants_generated, avg_elo, elo_gain, elo_per_dollar
- Created migration `20260205000002_add_variant_cost.sql`:
  - Added cost_usd column to evolution_variants
- Added `persistAgentMetrics()` function to pipeline.ts
- Integrated into both `executeMinimalPipeline` and `executeFullPipeline`
- Updated all 12 test files with mock `getAllAgentCosts()` method
- Added tests for `getAllAgentCosts()` in costTracker.test.ts

### Files Modified
- `src/lib/evolution/types.ts`
- `src/lib/evolution/core/costTracker.ts`
- `src/lib/evolution/core/pipeline.ts`
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql` (new)
- `supabase/migrations/20260205000002_add_variant_cost.sql` (new)
- 12 test files updated with mock changes

### Tests
- All costTracker tests pass (11/11)
- Build succeeds

## Phase 3: Data-Driven Cost Estimation
### Work Done
- Created migration `20260205000003_add_evolution_agent_cost_baselines.sql`:
  - New table for storing historical cost averages per agent/model
  - Added estimated_cost_usd column to evolution_runs
- Created `src/lib/evolution/core/costEstimator.ts` with:
  - `getAgentBaseline()` - Fetch cached baseline from DB
  - `estimateAgentCost()` - Estimate single agent call cost
  - `estimateRunCostWithAgentModels()` - Full run estimation with per-agent model overrides
  - `estimateRunCost()` - Backward-compatible wrapper
  - `refreshAgentCostBaselines()` - Populate baselines from llmCallTracking
  - `computeCostPrediction()` - Compare predicted vs actual costs
- Features:
  - In-memory cache with 5-minute TTL
  - Minimum 50 samples required for high-confidence baselines
  - Text length scaling for proportional cost estimates
  - Heuristic fallback using llmPricing when no baseline
- Created comprehensive tests (13 tests passing)

### Files Modified
- `supabase/migrations/20260205000003_add_evolution_agent_cost_baselines.sql` (new)
- `src/lib/evolution/core/costEstimator.ts` (new)
- `src/lib/evolution/core/costEstimator.test.ts` (new)

## Phase 4: JSON Batch Config
### Work Done
- Created `src/config/batchRunSchema.ts` with Zod schemas:
  - `AgentBudgetCapsSchema` - Agent budget allocation (percentages)
  - `AgentModelsSchema` - Per-agent model overrides
  - `BatchRunSpecSchema` - Single run specification
  - `BatchConfigSchema` - Full batch config with matrix expansion
  - `expandBatchConfig()` - Cartesian product expansion
  - `filterByBudget()` - Greedy budget-constrained filtering
- Created `scripts/run-batch.ts` CLI:
  - Loads and validates JSON config
  - Builds execution plan with cost estimates
  - Displays run preview with budget breakdown
  - Supports --dry-run and --confirm flags
  - Creates evolution_batch_runs records in database
- Created `supabase/migrations/20260205000004_add_evolution_batch_runs.sql`:
  - New table for batch tracking (status, spent, results)
  - Added batch_run_id FK to evolution_runs
- Created `experiments/example-batch.json` sample config
- Created comprehensive tests (18 tests passing)

### CLI Usage
```bash
npx tsx scripts/run-batch.ts --config experiments/example-batch.json --dry-run
```

## Phase 5: Adaptive Budget Allocation
### Work Done
- Created `src/lib/evolution/core/adaptiveAllocation.ts` with:
  - `getAgentROILeaderboard()` - Fetch and aggregate agent metrics
  - `computeAdaptiveBudgetCaps()` - Proportional allocation with bounds
  - `budgetPressureConfig()` - Dynamic multiplier for budget pressure
  - `mergeWithConfig()` - Merge adaptive with explicit overrides
- Features:
  - Queries `evolution_run_agent_metrics` for historical Elo/dollar
  - Minimum 10 samples required per agent for qualification
  - Floor (5%) and ceiling (40%) bounds on allocation
  - Normalization ensures caps sum to 1.0
  - Graceful fallback to defaults when no data
- Created comprehensive tests (14 tests passing)

### Files Modified
- `src/lib/evolution/core/adaptiveAllocation.ts` (new)
- `src/lib/evolution/core/adaptiveAllocation.test.ts` (new)

## Phase 6: Reporting Dashboard
### Work Done
- Created migration `20260205000005_add_evolution_strategy_configs.sql`:
  - New `evolution_strategy_configs` table with config_hash, name, label, config JSONB
  - Aggregated metrics: run_count, total_cost_usd, avg/best/worst_final_elo, stddev, avg_elo_per_dollar
  - Added `strategy_config_id` FK to evolution_runs
  - Created `update_strategy_aggregates()` function for incremental updates
- Created `src/lib/evolution/core/strategyConfig.ts`:
  - `hashStrategyConfig()` - SHA256-based 12-char hash for deduplication
  - `labelStrategyConfig()` - Auto-generated summary ("Gen: ds-chat | Judge: 4.1-nano | 10 iters")
  - `defaultStrategyName()` - Default name with hash prefix
  - `extractStrategyConfig()` - Extract StrategyConfig from EvolutionRunConfig
  - `diffStrategyConfigs()` - Compare two configs and list differences
- Created `src/lib/services/eloBudgetActions.ts` with server actions:
  - Agent-level: `getAgentROILeaderboardAction()`, `getAgentCostByModelAction()`
  - Strategy-level: `getStrategyLeaderboardAction()`, `resolveStrategyConfigAction()`, `updateStrategyAction()`
  - Analysis: `getStrategyParetoAction()`, `getRecommendedStrategyAction()`, `getOptimizationSummaryAction()`
- Created comprehensive tests:
  - `strategyConfig.test.ts` - 24 tests passing
  - `eloBudgetActions.test.ts` - 24 tests passing

### Files Modified
- `supabase/migrations/20260205000005_add_evolution_strategy_configs.sql` (new)
- `src/lib/evolution/core/strategyConfig.ts` (new)
- `src/lib/evolution/core/strategyConfig.test.ts` (new)
- `src/lib/services/eloBudgetActions.ts` (new)
- `src/lib/services/eloBudgetActions.test.ts` (new)

### Server Actions API
| Action | Purpose |
|--------|---------|
| `getAgentROILeaderboardAction()` | Agent Elo/dollar rankings |
| `getAgentCostByModelAction()` | Cost breakdown per model for an agent |
| `getStrategyLeaderboardAction()` | Strategy config rankings |
| `resolveStrategyConfigAction()` | Get or create strategy config entry |
| `updateStrategyAction()` | Update strategy name/description |
| `getStrategyParetoAction()` | Cost vs Elo Pareto frontier |
| `getRecommendedStrategyAction()` | Budget-aware strategy recommendation |
| `getOptimizationSummaryAction()` | Dashboard summary stats |

---

## Phase 7: Dashboard UI Implementation
### Status
Complete

### Work Done
- Created dashboard page at `src/app/admin/quality/optimization/page.tsx`
- Created 5 components in `_components/` directory:
  - `CostSummaryCards.tsx` - Metric cards for totals and best performers
  - `StrategyLeaderboard.tsx` - Sortable table with expandable config rows
  - `StrategyParetoChart.tsx` - SVG scatter plot with Pareto frontier
  - `StrategyConfigDisplay.tsx` - Detailed config breakdown view
  - `AgentROILeaderboard.tsx` - Agent ROI ranking with bar visualization
- Added navigation link in `AdminSidebar.tsx`

### Features
- **Tab 1: Strategy Analysis**
  - Summary metric cards (runs, spent, Elo/$, best strategy)
  - Sortable leaderboard (by Elo, Elo/$, runs, stddev)
  - Click-to-expand config details
  - Pareto frontier scatter plot with hover tooltips

- **Tab 2: Agent Analysis**
  - Agent ROI leaderboard with bar visualization
  - Ranking badges for top performers
  - Actionable insights section

- **Tab 3: Cost Analysis**
  - Expanded summary cards
  - Placeholder for additional charts

### Files Created
```
src/app/admin/quality/optimization/
├── page.tsx
└── _components/
    ├── CostSummaryCards.tsx
    ├── StrategyLeaderboard.tsx
    ├── StrategyParetoChart.tsx
    ├── StrategyConfigDisplay.tsx
    └── AgentROILeaderboard.tsx
```

### Tests
- ESLint: passes
- TypeScript: passes
- Build: passes

---

## Summary

All 7 phases complete. Total new tests: 104 passing (11 + 13 + 18 + 14 + 24 + 24).

**Key Deliverables:**
1. **Baselines**: Established 2160 Elo/dollar as target to beat
2. **Cost Attribution**: Per-agent cost tracking with `getAllAgentCosts()`
3. **Cost Estimation**: Data-driven predictions with baseline caching
4. **Batch Config**: JSON-based experiment definition with combinatorial expansion
5. **Adaptive Allocation**: ROI-based budget caps with floor/ceiling bounds
6. **Reporting**: Server actions for dashboard analytics and Pareto analysis

**Migrations Created:**
- `20260205000001_add_evolution_run_agent_metrics.sql`
- `20260205000002_add_variant_cost.sql`
- `20260205000003_add_evolution_agent_cost_baselines.sql`
- `20260205000004_add_evolution_batch_runs.sql`
- `20260205000005_add_evolution_strategy_configs.sql`
