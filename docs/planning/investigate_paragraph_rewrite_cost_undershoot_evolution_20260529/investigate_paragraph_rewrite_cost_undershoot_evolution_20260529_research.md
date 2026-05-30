# Investigate Paragraph Rewrite Cost Undershoot Evolution Research

## Problem Statement
Investigate why paragraph rewrite invocations are undershooting their budget by so much by querying Supabase stage.

## Requirements (from GH Issue #NNN)
Investigate why paragraph rewrite invocations are undershooting their budget by so much by querying Supabase stage.

## High Level Summary
TBD — populate via `/research` after querying staging Supabase for the actual cost/budget data on recent `paragraph_recombine` invocations and tracing the budget enforcement and dispatch paths.

Initial hypotheses to explore (from reading the relevant evolution docs):
- Per-slot self-abort at `0.9 × perSlotBudgetUsd` may be firing too aggressively given the per-slot budget of `perInvocationCap / paragraphCount` (~$0.033 at defaults).
- `length_under` rewrite drops (recently mitigated in `investigate_paragraph_recombine_invocation_20260529`) may be skipping per-slot rank LLM calls and thus draining far less budget than the projector expected.
- Per-slot LLM client carries no `db`/`runId`, so per-call live writes don't fire — only the once-per-invocation SUM write via `writeMetricMax`. The aggregate `paragraph_recombine_cost` should still reflect the truth, but it's worth confirming.
- Pre-final-ranking gate at `0.9 × perInvocationCap` may be aborting before the article-level ranking call, leaving budget on the table.
- `estimateParagraphRecombineCost` uses a 1.3× upper-bound margin — sustained undershoot may simply be the projector being conservative.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/debugging.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/agents/overview.md
- evolution/docs/cost_optimization.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/metrics.md
- evolution/docs/arena.md
- evolution/docs/entities.md
- evolution/docs/reference.md
- evolution/docs/visualization.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/curriculum.md
- evolution/docs/logging.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/variant_lineage.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/criteria_agents.md
- evolution/docs/editing_agents.md
- evolution/docs/evolution_metrics.md

## Code Files Read
- TBD — populate during `/research` phase as Supabase queries identify the affected invocations and code paths.
