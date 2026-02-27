# Analyze Initial Evolution Experiment Batch Research

## Problem Statement
Analyze our existing evolution experiments to get initial learnings and develop follow-up experiments.

## Requirements (from GH Issue #568)
1. Query completed evolution runs and extract key metrics (Elo, cost, iterations, stop reason)
2. Analyze which strategy factors (model, judge, iterations, agents) had the largest impact on quality
3. Compare cost-efficiency (elo_per_dollar) across strategies
4. Identify convergence patterns and failure modes
5. Document initial findings in research doc
6. Design follow-up experiments based on learnings
7. Create actionable recommendations for experiment round 2

## High Level Summary

The evolution system has two experiment pathways (CLI and automated) and a mature data model for tracking runs, strategies, agents, and quality metrics. An analysis script (`evolution/scripts/analyze-experiments.ts`) has been created to query completed runs and extract key metrics across 8 dimensions: run overview, strategy comparison, agent ROI, cost estimation accuracy, automated experiment results, hall of fame cross-method comparison, convergence patterns, and follow-up recommendations.

Key architectural findings:
- **Experiment system**: Taguchi L8 orthogonal array design testing 5 factors (genModel, judgeModel, iterations, editor, supportAgents) in 8 runs
- **Rating system**: OpenSkill Bayesian within-run and cross-run (Hall of Fame) rating; `ordinalToEloScale()` maps ordinal to 0-3000 display scale
- **Two experiment pathways**: CLI (`run-strategy-experiment.ts` with local JSON state) and automated (admin UI → DB → cron driver 9-state machine)
- **Cost tracking**: Per-agent attribution via CostTracker, cost estimation at start, cost prediction at completion
- **No experiments have been run yet via CLI** (no `experiments/strategy-experiment.json` state file exists)
- **No .env.local in this worktree** — database queries require running the script in a worktree with DB access

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md — project structure, conventions
- docs/docs_overall/architecture.md — overall architecture
- docs/docs_overall/project_workflow.md — workflow enforcement system

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md — pipeline overview, two-phase (EXPANSION→COMPETITION) design
- evolution/docs/evolution/architecture.md — pipeline agents (generation, reflection, iterativeEditing, treeSearch, tournament, proximity, eloBudget)
- evolution/docs/evolution/data_model.md — DB schema: evolution_runs, strategy_configs, agent_metrics, hall_of_fame_entries, experiments, experiment_rounds
- evolution/docs/evolution/strategy_experiments.md — Taguchi L8 factorial design, factor registry, analysis algorithms (main effects, interaction effects)
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill Bayesian rating, ordinalToEloScale, comparison framework
- evolution/docs/evolution/hall_of_fame.md — cross-method comparison, bias-mitigated pairwise comparisons
- evolution/docs/evolution/cost_optimization.md — budget-based iteration control, eloBudget agent, per-agent cost attribution
- evolution/docs/evolution/visualization.md — dashboard views, evolution detail panels

## Code Files Read

### Experiment System
- `evolution/src/experiments/evolution/factorial.ts` — L8 design generation, factor mapping, DEFAULT_ROUND1_FACTORS with 5 factors
- `evolution/src/experiments/evolution/analysis.ts` — Main effects computation (`computeMainEffects`), interaction effects, factor ranking, recommendation generation
- `evolution/src/experiments/evolution/factorRegistry.ts` — FACTOR_REGISTRY with type-safe factor definitions: genModel, judgeModel, iterations, editor, supportAgents
- `evolution/src/services/experimentActions.ts` — Server actions for experiment CRUD and lifecycle management
- `src/app/api/cron/experiment-driver/route.ts` — Cron state machine: 9 states (pending → round_running → round_analyzing → pending_next_round → terminal)

### Run/Strategy Data
- `evolution/src/services/evolutionActions.ts` — Evolution run CRUD, strategy config management
- `evolution/src/services/eloBudgetActions.ts` — Elo budget tracking, shouldContinueRun decisions
- `evolution/src/services/costAnalyticsActions.ts` — Cost analytics queries, per-agent cost breakdowns
- `evolution/src/services/unifiedExplorerActions.ts` — Unified explorer for runs, strategies, experiments
- `evolution/src/types/types.ts` — Core types: EvolutionRun, StrategyConfig, AgentMetrics
- `evolution/src/types/strategyConfig.ts` — Strategy config interface and validation

### CLI/Batch Tools
- `scripts/run-strategy-experiment.ts` — CLI orchestrator: plan/run/analyze/status commands, local JSON state tracking
- `evolution/scripts/run-batch.ts` — Batch runner with budget filtering and parallel execution
- `evolution/scripts/evolution-runner.ts` — Database-driven batch runner: claims pending runs, heartbeat, parallel execution
- `scripts/run-prompt-bank.ts` — Prompt bank runner for seeding content
- `scripts/run-prompt-bank-comparisons.ts` — Cross-method comparison runner

### Experiment Configs
- `experiments/example-batch.json` — Example batch config (3 topics, $1.50/run budget)
- `experiments/fixed-cost-comparison.json` — Fixed-cost A/B: deepseek-chat vs gpt-4.1-mini
- `experiments/strategy-comparison.json` — Multi-factor comparison (4 strategies)
- `experiments/quick-test.json` — Quick test config (1 topic, $0.20 budget)

## Key Findings (from Production Analysis)

### Model & Strategy Performance
1. **deepseek-chat is the clear winner**: The only strategy achieving positive Elo/$ (3502) uses deepseek-chat for both generation and judging with 5 iterations. All other model combinations produce below-baseline quality (avg Elo 667-781 vs 1500 baseline).

2. **gpt-5-mini as judge produces poor results**: All 4 strategies using gpt-5-mini as judge show negative Elo/$ (-1538 to -2153). The gpt-5-nano judge strategies are even worse (-4147 to -5222 Elo/$), suggesting judge quality is critical but expensive judges aren't necessarily better.

3. **More iterations significantly improve quality**: The single 5-iteration run achieved 29.8 top ordinal (Elo ~1677) while all 3-iteration runs ranged from 8.4-22.6 ordinal (Elo ~1335-1546). This is the strongest signal in the data.

### Experiment Infrastructure
4. **L8 Taguchi experiments work but budgets are too low**: Both automated experiments exhausted their budget ($0.50 and $1.00) in Round 1 and never reached Round 2. At $0.10/run and 8 runs/round, need $2-3 minimum for multi-round experiments.

5. **Contradictory factor rankings from two experiments**: "Initial experiment" (gpt-5-nano vs gpt-5-mini) found Judge Model has largest effect (-63 Elo). "Test" (deepseek vs claude-sonnet-4) found Generation Model has largest effect (+86 Elo). Different factor level ranges make these non-comparable, and "Test" had only 4/8 runs complete.

6. **50% failure rate needs fixing before scaling**: 17 of 34 runs failed. Causes: watchdog timeouts (continuation runs not resumed), batch runner incompatibility with prompt-based runs, duplicate triggers. Must fix reliability before investing in more experiments.

### Agent & Cost Analysis
7. **iterativeEditing is the workhorse agent**: 150 avg Elo gain per run (12 samples), but at $0.0144/run it's 8x more expensive than generation ($0.0018). The generation agent creates the initial pool cheaply, then iterativeEditing refines it substantially.

8. **Cost estimation barely exercised**: Only 1 completed run had a cost estimate (underestimated by 29%). The cost prediction system hasn't been validated in production.

### Data Gaps
9. **No oneshot baseline in production HoF**: All 16 HoF entries are from evolution. Can't compare evolution quality vs oneshot generation without running `run-prompt-bank-comparisons.ts` against production topics.

10. **High variance per strategy**: StdDevs of 943-1104 across experiment strategies (with only 2 runs each). Need more runs per strategy for reliable comparison — current N=2 is insufficient for statistical significance.

## Open Questions (Updated)

1. **Why does deepseek-chat outperform so dramatically?** — Is it the model quality, the cost efficiency (more iterations affordable), or both? Need to test deepseek-chat at 3 iterations vs 5 to isolate iteration count effect.
2. **Why are experiment factor rankings contradictory?** — Different factor ranges (gpt-5-nano/mini vs deepseek/claude-sonnet) and partial data. Need experiments with overlapping factor levels.
3. **What's the right budget for multi-round experiments?** — At $0.10/run and 8 runs/round, a 3-round experiment needs ~$2.40 minimum. Should target $3-5 per experiment.
4. **Can we reduce the 50% failure rate?** — Watchdog timeouts and batch runner issues are fixable. Need to track failure rates over time.
5. **What would oneshot baselines look like in production?** — Need to run prompt bank comparisons to establish the baseline that evolution should beat.
