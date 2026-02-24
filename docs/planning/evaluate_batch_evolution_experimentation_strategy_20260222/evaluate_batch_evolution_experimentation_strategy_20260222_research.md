# Evaluate Batch Evolution Experimentation Strategy Research

## Problem Statement
The evolution pipeline has mature but manually-orchestrated experimentation infrastructure: L8 factorial screening, batch config sweeps, Pareto frontier analysis, and strategy recommendation. These systems each answer a different question about cost-effectiveness but require manual chaining. This project will evaluate the existing experimentation capabilities and build an automatic orchestration layer that, given a fixed budget, determines which pipeline factors are most cost-effective for boosting Elo — from screening through refinement to final recommendation — in a single command.

## Requirements (from GH Issue #TBD)
1. **Evaluate existing experimentation infrastructure** — Audit current L8 screening, batch runner, Pareto analysis, strategy recommendation, prompt bank, and cost estimation systems for completeness and gaps
2. **Automatic orchestration** — Build a single command/workflow that chains:
   - Round 1: L8 screening (8 runs) to identify which factors matter most
   - Analysis: Compute main effects, rank factors, lock negligible ones at cheap levels
   - Round 2: Full/fractional factorial on important factors with expanded levels
   - Pareto + recommendation: Identify optimal tradeoffs and recommend best config for budget
3. **Budget-constrained optimization** — The orchestrator must respect a total experiment budget, allocating across rounds intelligently (e.g., 30% screening, 60% refinement, 10% confirmation)
4. **Resume/interrupt support** — Long-running multi-round experiments must be resumable from any checkpoint
5. **Results reporting** — Clear output of which factors matter, optimal configs, and cost-efficiency rankings
6. **Close existing gaps** — Address known gaps: prompt-based batch runs (null explanation_id), per-agent model overrides, adaptive allocation prototype

## High Level Summary
[Summary of findings — to be populated during /research]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/agents/overview.md

## Code Files Read
- scripts/run-strategy-experiment.ts
- evolution/src/experiments/evolution/factorial.ts
- evolution/src/experiments/evolution/analysis.ts
- evolution/scripts/run-batch.ts
- src/config/batchRunSchema.ts
- evolution/scripts/evolution-runner.ts
- evolution/src/lib/core/strategyConfig.ts
- evolution/src/lib/core/costEstimator.ts
- evolution/src/services/eloBudgetActions.ts
- evolution/src/config/promptBankConfig.ts
- evolution/scripts/run-prompt-bank.ts
- src/app/admin/quality/optimization/page.tsx
- .github/workflows/evolution-batch.yml
