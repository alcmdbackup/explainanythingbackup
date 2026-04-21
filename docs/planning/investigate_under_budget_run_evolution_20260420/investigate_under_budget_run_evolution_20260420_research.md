# Investigate Under-Budget Run Evolution Research

## Problem Statement
Help me investigate why so few agents were launched (6 total) for run `2fd03e7f-3464-4b68-8f3d-397ba5878b9f` on stage. With gemini 2.5 flash lite model, strategy creation prediction says 20+ agents should be created, but the run features <7.

## Requirements (from GH Issue #NNN)
Use @docs/docs_overall/debugging.md to see how to query supabase dev to investigate.

- Query staging Supabase (`npm run query:staging`) following debugging.md patterns.
- Start from run `2fd03e7f-3464-4b68-8f3d-397ba5878b9f`: fetch status, `budget_cap_usd`, `strategy_id`, `run_summary`, `error_message`.
- Pull the strategy config (`evolution_strategies.config`) to see `iterationConfigs[]`, `generationModel` (gemini-2.5-flash-lite), `budgetUsd`, `generationGuidance`, and the budget-floor fields (`minBudgetAfterParallel*`, `minBudgetAfterSequential*`).
- Read `evolution_metrics` for the run: `cost`, `generation_cost`, `ranking_cost`, `seed_cost`, `agent_cost_projected`, `agent_cost_actual`, `parallel_dispatched`, `sequential_dispatched`, `estimated_cost`, `cost_estimation_error_pct`.
- List `evolution_agent_invocations` rows by iteration + agent_name + success to confirm the agent count (~6) and which iterations they landed in.
- Correlate against `evolution_logs` for `kill_check`, `budget`, `iteration_budget_exceeded`, and `seed_failed` events.
- Reconcile the strategy creation wizard's predicted 20+ agents with actual dispatch — likely branches: (a) budget-floor gating (parallel/sequential floor too conservative for flash-lite pricing), (b) wizard's `estimateAgentCost()` underestimating flash-lite cost vs runtime actual, (c) per-iteration budget exhaustion, (d) seed_failed short-circuit, (e) run killed/cancelled early.
- Identify the root cause and propose a fix (wizard prediction, runtime dispatch math, or budget-floor defaults).

## High Level Summary
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- evolution/docs/* (all 15 canonical evolution docs read via Glob)

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/multi_iteration_strategies.md
- docs/feature_deep_dives/evolution_metrics.md

## Code Files Read
- [list of code files reviewed]
