# Prod Evolution Budget Issue Debug Research

## Problem Statement
Production evolution experiment runs are hitting budget exceeded errors because the total experiment budget ($0.50) is evenly split across all runs ($0.0625/run), which is too small for even a single iteration. Need to add a run preview to the experiment UI showing per-run budget, factor combinations, and strategy details before starting.

## Requirements (from GH Issue #585)
1. Add a run preview table/panel to ExperimentForm showing each L8 row with its factor values, strategy label, estimated cost, and per-run budget
2. Show the per-run budget calculation (totalBudget / numRuns) prominently with a warning when it's below a minimum threshold
3. Show redistributed per-agent budget caps for each run config (accounting for enabledAgents)
4. Surface which agents are active vs disabled per run
5. Leverage existing validateExperimentConfig() which already returns expandedConfigs

## High Level Summary

The experiment UI currently computes full `expandedConfigs` (8 resolved EvolutionRunConfig objects) during validation but only surfaces a summary count and total estimated cost. All the data needed for a run preview already exists — it just needs to be passed through the server action and rendered.

Key findings:
1. `validateExperimentConfig()` returns `expandedConfigs: ExpandedRunConfig[]` with full configs, but `validateExperimentConfigAction` discards this, only returning `expandedRunCount` and `estimatedCost`
2. The L8 design in `factorial.ts` provides per-row factor values and pipeline args (`ExperimentRunConfig.factors` and `.pipelineArgs`)
3. `computeEffectiveBudgetCaps()` can compute redistributed per-agent caps from any config
4. The per-run budget is calculated as `input.budget / totalRunCount` in `experimentActions.ts:216` — this is what needs to be previewed
5. `estimateBatchCost()` already estimates per-config costs but only returns a total

## Current Data Flow Gap

```
ExperimentForm → validateExperimentConfigAction → validateExperimentConfig()
                                                     ↓
                                              expandedConfigs (FULL configs)
                                              estimatedTotalCost
                                                     ↓
                                              Action DISCARDS expandedConfigs
                                              Returns only: count + total cost
```

## Key Data Available for Preview (Not Currently Surfaced)

Per L8 row:
- `factors`: Record of factor name → resolved value (e.g., `{genModel: "deepseek-chat", iterations: 2}`)
- `pipelineArgs`: `{model, judgeModel, iterations, enabledAgents}`
- Full `EvolutionRunConfig` with budgetCaps, expansion config, etc.
- Estimated cost per row (available from `estimateBatchCost` internals)
- Redistributed budget caps (computable from config.enabledAgents + config.budgetCaps)

## Key Files for Implementation

| File | Role |
|------|------|
| `evolution/src/experiments/evolution/experimentValidation.ts` | Returns `expandedConfigs` — needs per-row cost estimates added |
| `evolution/src/services/experimentActions.ts` | Server action — needs to pass through row-level data |
| `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` | UI — needs new preview panel |
| `evolution/src/experiments/evolution/factorial.ts` | L8 design — `ExperimentRunConfig` has `factors` + `pipelineArgs` |
| `evolution/src/lib/core/budgetRedistribution.ts` | `computeEffectiveBudgetCaps()` for showing redistributed caps |
| `evolution/src/lib/core/costEstimator.ts` | `estimateRunCostWithAgentModels()` for per-row estimates |

## Existing Types

```typescript
// From experimentValidation.ts
interface ExpandedRunConfig {
  row: number;
  config: EvolutionRunConfig;  // Full resolved config
}

interface ExperimentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  expandedConfigs: ExpandedRunConfig[];
  estimatedTotalCost: number;
}

// From factorial.ts
interface ExperimentRunConfig {
  row: number;
  factors: Record<string, string | number>;  // e.g. {genModel: "deepseek-chat", iterations: 2}
  pipelineArgs: {
    model: string;
    judgeModel: string;
    iterations: number;
    enabledAgents: string[];
  };
}

// From factorRegistry.ts
interface FactorTypeDefinition {
  key: string;
  label: string;
  type: 'model' | 'integer' | 'agent_set' | 'enum';
  getValidValues(): (string | number)[];
  validate(value: string | number): boolean;
}
```

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md
- evolution/docs/evolution/agents/flow_critique.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/agents/support.md
- docs/docs_overall/debugging.md

## Code Files Read
- evolution/src/lib/core/budgetRedistribution.ts — budget redistribution logic, computeEffectiveBudgetCaps()
- evolution/src/lib/core/costTracker.ts — per-agent budget enforcement, reserveBudget(), CostTrackerImpl
- evolution/src/services/experimentActions.ts — experiment run creation, perRunBudget calculation (line 216), validateExperimentConfigAction discards expandedConfigs (line 88-96)
- evolution/src/experiments/evolution/experimentValidation.ts — validation pipeline, returns full expandedConfigs, estimateBatchCost()
- evolution/src/experiments/evolution/factorial.ts — L8 design generation, mapFactorsToPipelineArgs(), ExperimentRunConfig type
- evolution/src/experiments/evolution/factorRegistry.ts — FACTOR_REGISTRY with 5 factors, expandAroundWinner()
- evolution/src/lib/core/costEstimator.ts — estimateRunCostWithAgentModels(), RunCostEstimate type
- evolution/src/lib/config.ts — resolveConfig(), deepMerge, DEFAULT_EVOLUTION_CONFIG
- src/app/admin/quality/optimization/_components/ExperimentForm.tsx — current form UI, only shows count + total cost
- src/app/admin/quality/optimization/_components/ExperimentStatusCard.tsx — status display with round progress
- src/app/admin/quality/optimization/_components/ExperimentHistory.tsx — collapsible card with chevron toggle
- src/app/admin/quality/optimization/_components/StrategyLeaderboard.tsx — expandable row pattern
- src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx — 3-column config grid
- src/app/admin/quality/evolution/page.tsx — StartRunCard with per-agent cost breakdown bars
- src/app/api/cron/experiment-driver/route.ts — experiment state machine, round analysis, next-round generation
- evolution/src/experiments/evolution/analysis.ts — analyzeExperiment(), main effects, factor ranking
- scripts/query-prod.ts — prod query tool

## Test Files Read
- evolution/src/experiments/evolution/experimentValidation.test.ts — validation guards, error/warning patterns
- evolution/src/experiments/evolution/factorial.test.ts — L8 array verification
- evolution/src/experiments/evolution/factorRegistry.test.ts — factor validation, expandAroundWinner
- evolution/src/services/experimentActions.test.ts — Supabase mock chains, server action flow
- src/__tests__/integration/strategy-experiment.integration.test.ts — full L8→analysis pipeline
- src/app/admin/quality/optimization/_components/CostAccuracyPanel.test.tsx — component test pattern
- src/app/admin/quality/optimization/_components/StrategyConfigDisplay.test.tsx — config display test

## Production Investigation
- Queried runs af3af872 and 0080d2d2 via `query:prod`
- Both runs: budgetCapUsd=$0.0625, enabledAgents=["iterativeEditing","reflection"]
- Run 0080d2d2: "Budget exceeded for calibration: spent $0.0166, cap $0.0166"
- Run af3af872: "Budget exceeded for iterativeEditing: spent $0.0051, cap $0.0055"
- Root cause: experiment total_budget_usd=$0.50 / 8 runs = $0.0625/run
- Budget redistribution is working correctly (scale factor 1.769x for 6 active agents)
- The budget is simply too small for any meaningful pipeline execution

## Deep Research Findings

### handleStart() Submission Flow

**Client → Server data path:**
1. `ExperimentForm.handleStart()` sends `{name, factors, promptIds, budget, target, maxRounds}` to `startExperimentAction`
2. Server resolves prompt IDs → text, validates config, generates L8 design
3. Creates experiment + batch + round + individual runs in DB
4. Per-run budget = `input.budget / (design.runs.length * prompts.length)` (line 216)

**Budget validation gap:** No check that estimated cost <= budget. Client only checks `budget >= $0.01`. Server only checks `budget > 0`. Runs are created even if estimated cost vastly exceeds budget.

**Debounced validation (500ms):** Triggers on factor/prompt changes. Sends `{factors, promptIds}` (NO budget). Returns `{valid, errors, warnings, expandedRunCount, estimatedCost}`. Budget is never compared against estimate.

**Button disabled logic:** Only checks `clientErrors.length > 0 || starting || (validation !== null && !validation.valid)` — does NOT check budget sufficiency.

### validateExperimentConfigAction: What's Discarded

Lines 74-104 of experimentActions.ts strip `expandedConfigs` to just a count:
```
result.expandedConfigs → expandedRunCount: result.expandedConfigs.length
result.estimatedTotalCost → estimatedCost (scalar)
```

**Lost:** Full EvolutionRunConfig per row, per-agent cost breakdowns, individual row validation details. To pass through, need to add `expandedConfigs` to `ValidateExperimentOutput` interface and serialize the configs.

### estimateBatchCost: Per-Row Extraction

Currently accumulates into a single `total`. Internally loops over expandedConfigs and calls `estimateRunCostWithAgentModels()` per row which returns `{totalUsd, perAgent, perIteration, confidence}`. Minimal refactoring to return per-row array instead of aggregate — just collect results in array.

### Budget Redistribution: Pure Function

`computeEffectiveBudgetCaps(defaultCaps, enabledAgents, singleArticle)` is synchronous, no DB calls, pure computation. Can be called client-side or server-side for preview. Separates REQUIRED agents (generation, calibration, tournament, proximity) from OPTIONAL agents, filters by enabledAgents, scales proportionally to preserve original sum.

### 2-Factor L8 Edge Case

L8 always generates 8 rows regardless of factor count. With 2 factors, only columns 0-1 are used; columns 2-6 are reported as interaction columns but don't affect run generation. This means 2 factors x 1 prompt = 8 runs (some are duplicates from the user's perspective since unused columns create identical factor combos).

### configDefaults Propagation

`configDefaults?: Partial<EvolutionRunConfig>` flows from `StartExperimentInput` → `validateExperimentConfig()` → `resolveConfig()`. Merged BEFORE factor-derived values, so factors override configDefaults. Not exposed in UI (only API/tests). Applied twice: once in validation, once in run creation.

### Experiment State Machine & Round Transitions

9 states: `pending → round_running → round_analyzing → pending_next_round → round_running` (loop), with terminal states: `converged, budget_exhausted, max_rounds, failed, cancelled`.

**Round 2+ design:** Switches from L8 to full-factorial. Factors ranked by Elo effect magnitude. Negligible factors (< 15% of top effect) locked at cheap level. Important factors expanded via `expandAroundWinner()` which returns 2-3 levels around the winning value (adjacent neighbors in ordered valid-values list).

### Test Patterns

| File | Tests | Key Pattern |
|------|-------|-------------|
| `experimentValidation.test.ts` | 182 lines | Guard checks, validation errors/warnings |
| `factorial.test.ts` | 193 lines | L8 orthogonal array verification |
| `factorRegistry.test.ts` | 155 lines | Factor validation, expandAroundWinner |
| `experimentActions.test.ts` | 550 lines | Supabase mock chains, server action mocking |
| `strategy-experiment.integration.test.ts` | 117 lines | Full pipeline L8→analysis |

**ExperimentForm.tsx has NO tests yet.** Server action tests use `mockReturnThis()` chain pattern for Supabase. Component tests use `@testing-library/react` with `jest.mock()` for server actions. Test helpers in `src/testing/utils/`.

### UI Patterns Available for Reuse

- **Expandable rows:** `StrategyLeaderboard.tsx` — `expandedId` state, colSpan, bg-surface-elevated
- **Collapsible cards:** `ExperimentHistory.tsx` — chevron toggle, lazy-loaded detail
- **Cost breakdown bars:** `StartRunCard` in evolution page — per-agent cost bars with percentage widths
- **Config display grid:** `StrategyConfigDisplay.tsx` — 3-column grid, ConfigRow component, enabled/disabled dots
- **Design tokens:** `--status-error`, `--status-warning`, `--status-success`, `--accent-gold` for budget warnings
