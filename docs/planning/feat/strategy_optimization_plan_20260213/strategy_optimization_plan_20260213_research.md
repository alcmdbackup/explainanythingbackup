# Strategy Optimization Plan Research

## Problem Statement
Build a systematic way to learn insights about which strategies are most effective for generating high Elo articles via the evolution pipeline. This involves analyzing strategy performance data, identifying patterns in configuration choices that lead to higher quality outputs, and surfacing actionable recommendations for optimizing pipeline runs.

## Requirements (from GH Issue #419)
_To be defined after research phase._

## High Level Summary

The codebase already has substantial infrastructure for strategy tracking, cost optimization, and cross-method comparison. Six major subsystems are relevant:

1. **Strategy Config System** — Hash-based dedup, 3 presets (Economy/Balanced/Quality), enabledAgents gating, singleArticle mode, auto-linking at run completion with aggregate updates (run_count, avg_final_elo, avg_elo_per_dollar, stddev)
2. **Strategy Analytics Dashboard** — 4-tab optimization page with strategy leaderboard, Pareto frontier chart, agent ROI leaderboard, cost accuracy tracking, and budget-aware strategy recommendations
3. **Agent Metrics & Invocations** — Per-agent cost/Elo/ROI tracked in `evolution_run_agent_metrics`, per-agent-per-iteration execution detail (JSONB) in `evolution_agent_invocations` with 12 type-specific detail schemas
4. **Hall of Fame** — Cross-method Elo comparison (Swiss-style pairwise), prompt bank coverage matrix (5 prompts × 12 method slots), per-method stats (avg Elo, cost, elo/$, win rate), auto-insertion of top 3 from each run
5. **Dimensional Explorer** — 3 view modes (table/matrix/trend) × 3 units (run/article/task) with multi-dimensional filters (prompt, strategy, pipeline type, agent) plus attribute filters (difficulty, domain, model, budget, date)
6. **Batch Experiments** — JSON-driven Cartesian product expansion, budget filtering with priority sort, prompt bank generation pipeline with coverage detection and resume support

### What Data Is Already Captured

| Data Point | Source Table | Granularity |
|-----------|-------------|-------------|
| Strategy config hash + full config | `strategy_configs` | Per unique config |
| Avg/best/worst/stddev Elo per strategy | `strategy_configs` (aggregates) | Per strategy |
| Elo per dollar per strategy | `strategy_configs.avg_elo_per_dollar` | Per strategy |
| Per-agent cost per run | `evolution_run_agent_metrics` | Per agent per run |
| Per-agent Elo gain & ROI | `evolution_run_agent_metrics` | Per agent per run |
| Execution detail (12 types) | `evolution_agent_invocations.execution_detail` | Per agent per iteration |
| Run summary with strategy effectiveness | `content_evolution_runs.run_summary` | Per run |
| Cross-method Elo ratings | `hall_of_fame_elo` | Per entry per topic |
| Prompt bank coverage | `hall_of_fame_entries` + `hall_of_fame_topics` | Per prompt × method |
| Cost predictions vs actuals | `content_evolution_runs.cost_prediction` | Per run |
| Ordinal + diversity history | `run_summary.ordinalHistory/diversityHistory` | Per iteration per run |
| MetaFeedback (within-run) | `run_summary.metaFeedback` | Per run |

---

## Detailed Findings

### 1. Strategy Configuration System

**Key files:**
- `src/lib/evolution/core/strategyConfig.ts` — StrategyConfig type, hashStrategyConfig() (12-char SHA256), labelStrategyConfig()
- `src/lib/services/strategyRegistryActions.ts` — CRUD: create (hash dedup + promotion path), update (version-on-edit), clone, archive, delete, 3 presets
- `src/lib/evolution/core/budgetRedistribution.ts` — Agent classification (4 required, 8 optional), dependency graph, mutex constraints, proportional budget scaling
- `src/lib/evolution/core/pipeline.ts:154-217` — linkStrategyConfig() auto-creates or links strategies at run completion, updateStrategyAggregates() via RPC

**StrategyConfig fields hashed:** generationModel, judgeModel, agentModels, iterations, budgetCaps, enabledAgents (sorted), singleArticle (only when true)

**3 Presets:**
- Economy: deepseek-chat + gpt-4.1-nano, 2 iters, required agents only, minimal pipeline
- Balanced: default models, 3 iters, 6 optional agents, full pipeline
- Quality: gpt-4.1 + gpt-4.1-mini, 5 iters, all agents + outlineGeneration, full pipeline

**Aggregate metrics on strategy_configs table:** run_count, total_cost_usd, avg_final_elo, avg_elo_per_dollar (baseline-adjusted: (avg_elo - 1200) / total_cost), best/worst/stddev_final_elo

### 2. Strategy Analytics & Optimization Dashboard

**Key files:**
- `src/lib/services/eloBudgetActions.ts` — getStrategyLeaderboardAction (sortable by avg_elo/elo_per_dollar/best_elo/consistency), getStrategyParetoAction (O(n²) dominance check), getRecommendedStrategyAction (budget-constrained, requires ≥3 runs), getOptimizationSummaryAction
- `src/lib/evolution/core/adaptiveAllocation.ts` — computeAdaptiveBudgetCaps: 30-day lookback, proportional ROI allocation with iterative min/max clamping (5%-40%)
- `src/lib/evolution/core/costEstimator.ts` — estimateRunCostWithAgentModels: baseline cache (5min TTL, 50+ samples), text length scaling, per-agent call multipliers, 3 confidence levels
- `src/lib/services/costAnalyticsActions.ts` — getCostAccuracyOverviewAction: confidence calibration, per-agent accuracy, delta trends, outlier detection (>50% error)

**Dashboard tabs** (`/admin/quality/optimization`):
1. Strategy Analysis — leaderboard + Pareto scatter
2. Agent Analysis — ROI bar chart with insights
3. Cost Analysis — donut chart + summary cards
4. Cost Accuracy — prediction calibration + trend + outliers

**Strategy recommendation:** Filters strategies with ≥3 runs, constrains by budget, optimizes for elo/elo_per_dollar/consistency.

### 3. Agent Metrics & Invocation Tracking

**Key files:**
- `supabase/migrations/20260205000001` — evolution_run_agent_metrics: cost_usd, variants_generated, avg_elo, elo_gain, elo_per_dollar per agent per run
- `supabase/migrations/20260212000001` — evolution_agent_invocations: run_id, iteration, agent_name, execution_order, success, cost_usd, skipped, execution_detail JSONB (unique on run_id+iteration+agent_name)
- `src/lib/evolution/types.ts:135-342` — 12 discriminated union detail types: generation, calibration, tournament, iterativeEditing, reflection, debate, sectionDecomposition, evolution, treeSearch, outlineGeneration, proximity, metaReview

**MetaReviewAgent** (`agents/metaReviewAgent.ts`): Pure analysis (no LLM calls). Computes:
- Successful strategies: above-average ordinal
- Weaknesses: strategies in ≥50% of bottom quartile
- Failure patterns: strategies with avg parent→child delta < -3
- Priority improvements: diversity thresholds, ordinal range, stagnation, strategy coverage

**Detail truncation:** 100KB limit with two-phase: type-specific array slicing → base-field-only fallback.

### 4. Hall of Fame & Cross-Method Comparison

**Key files:**
- `src/lib/services/hallOfFameActions.ts` — 14 server actions including getCrossTopicSummaryAction (per-method avg Elo/cost/win rate), getPromptBankCoverageAction (coverage matrix), getPromptBankMethodSummaryAction (sortable method stats), runHallOfFameComparisonAction (Swiss-style with bias mitigation)
- `src/config/promptBankConfig.ts` — 5 prompts (easy/medium/hard), 3 oneshot + 3 evolution methods × 3 checkpoints = 12 columns, 60-cell coverage matrix
- `src/lib/evolution/core/pipeline.ts:555-687` — feedHallOfFame(): auto-inserts top 3 variants, initializes Elo from OpenSkill ordinal, triggers 1 auto-comparison round

**Elo per dollar:** `(elo_rating - 1200) / total_cost_usd`. Negative = underperforms baseline relative to cost.

**Coverage grid UI:** Green check (compared), yellow dot (exists uncompared), grey (missing). Method summary table with gold highlighting for best values.

### 5. Run Summaries & Dimensional Explorer

**Key files:**
- `src/lib/evolution/types.ts:550-673` — EvolutionRunSummary v2: ordinalHistory[], diversityHistory[], matchStats, topVariants[], baselineRank, strategyEffectiveness (count+avgOrdinal per strategy), metaFeedback
- `src/lib/evolution/core/pipeline.ts:294-354` — buildRunSummary(): aggregates top 5 variants, baseline rank, match stats (avg confidence, decisive rate), strategy effectiveness, supervisor histories
- `src/lib/services/unifiedExplorerActions.ts` — 3 views (table/matrix/trend), 3 units (run/article/task), attribute→entity filter resolution (difficulty, domain, model, budget → IDs), batch label resolution, pagination

**Explorer filters:** promptIds, strategyIds, pipelineTypes, agentNames, difficultyTiers, domainTags, models, budgetRange, dateRange.

**Matrix view:** Row × column dimensions (any of prompt/strategy/pipelineType/agent), metric (avgElo/totalCost/runCount/avgEloDollar/successRate), cell = aggregated value + run count.

**Trend view:** Time-series grouped by dimension, bucketed by day/week/month, top 10 series + "Other".

### 6. Batch Experiment Infrastructure

**Key files:**
- `src/config/batchRunSchema.ts` — BatchConfigSchema: matrix (prompts × models × judges × iterations × agentModelVariants), Cartesian expansion, budget filtering with priority sort (cost_asc/elo_per_dollar_desc/random)
- `scripts/run-batch.ts` — CLI: config loading, plan building, cost estimation, sequential execution, batch_runs table tracking
- `scripts/run-prompt-bank.ts` — Coverage matrix detection, oneshot generation via oneshotGenerator, evolution via child process (run-evolution-local.ts --bank --bank-checkpoints)
- `scripts/run-prompt-bank-comparisons.ts` — All-pairs Swiss comparison per topic, Elo updates with K=32, aggregate summary by method

**Batch execution:** Sequential runs, each creates temp explanation, queues with status='claimed', executes inline, records results. Budget tracking per batch.

**Prompt bank:** Resumable — coverage matrix detects existing entries and skips them. Evolution checkpoints parsed but intermediate snapshot during execution not yet fully implemented.

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/evolution/cost_optimization.md
- docs/evolution/architecture.md
- docs/evolution/reference.md
- docs/evolution/rating_and_comparison.md
- docs/evolution/data_model.md
- docs/evolution/agents/tree_search.md
- docs/evolution/agents/generation.md
- docs/evolution/visualization.md
- docs/evolution/hall_of_fame.md

## Code Files Read
- src/lib/evolution/core/strategyConfig.ts — Strategy hashing, labeling, diffing
- src/lib/services/strategyRegistryActions.ts — Strategy CRUD, presets, version-on-edit
- src/lib/evolution/core/budgetRedistribution.ts — Agent classification, budget scaling
- src/lib/evolution/core/supervisor.ts — Phase config, agent gating, enabledAgents
- src/lib/evolution/core/pipeline.ts — linkStrategyConfig, persistAgentMetrics, persistAgentInvocation, buildRunSummary, feedHallOfFame, finalizePipelineRun
- src/lib/services/eloBudgetActions.ts — Strategy/agent leaderboards, Pareto, recommendation, summary
- src/lib/evolution/core/adaptiveAllocation.ts — ROI-based budget allocation
- src/lib/evolution/core/costEstimator.ts — Cost prediction with baselines
- src/lib/services/costAnalyticsActions.ts — Cost accuracy tracking
- src/app/admin/quality/optimization/page.tsx — Dashboard UI
- src/lib/evolution/types.ts — All type definitions (ExecutionDetail union, RunSummary)
- src/lib/services/evolutionVisualizationActions.ts — Timeline, invocation detail retrieval
- src/components/evolution/agentDetails/AgentExecutionDetailView.tsx — 12 detail view components
- src/lib/evolution/agents/metaReviewAgent.ts — Strategy performance analysis
- src/lib/services/hallOfFameActions.ts — 14 Hall of Fame server actions
- src/config/promptBankConfig.ts — Prompt bank configuration
- src/lib/services/unifiedExplorerActions.ts — Explorer views, dimensional filtering
- src/app/admin/quality/explorer/page.tsx — Explorer UI
- src/config/batchRunSchema.ts — Batch run schema and expansion
- scripts/run-batch.ts — Batch runner CLI
- scripts/run-prompt-bank.ts — Prompt bank batch generation
- scripts/run-prompt-bank-comparisons.ts — Batch comparison runner
- scripts/run-evolution-local.ts — Local evolution CLI
- supabase/migrations/20260205000001 — Agent metrics table
- supabase/migrations/20260205000005 — Strategy configs table + RPC
- supabase/migrations/20260212000001 — Agent invocations table
- .github/workflows/evolution-batch.yml — Weekly batch schedule
