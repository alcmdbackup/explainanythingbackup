# Evaluate Batch Evolution Experimentation Strategy Plan

## Background
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

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/strategy_experiments.md` - Update with orchestration layer details
- `evolution/docs/evolution/cost_optimization.md` - Update batch execution and adaptive allocation sections
- `evolution/docs/evolution/architecture.md` - Update pipeline modes section if new orchestration mode added
- `evolution/docs/evolution/data_model.md` - Update if new tables/columns needed for experiment state
- `evolution/docs/evolution/rating_and_comparison.md` - Likely no changes
- `evolution/docs/evolution/hall_of_fame.md` - Update if prompt bank integration changes
- `evolution/docs/evolution/reference.md` - Update CLI commands, config, key files sections
- `evolution/docs/evolution/visualization.md` - Update if new dashboard views added
- `evolution/docs/evolution/agents/overview.md` - Likely no changes
