# Investigate Sequential Paragraph Recombine Performance Research

## Problem Statement
Investigate performance of most recent 4 paragraph recombine runs on stage and understand why performance is generally negative.

## Requirements (from GH Issue #NNN)
Investigate performance of most recent 4 paragraph recombine runs on stage and understand why performance is generally negative.

## High Level Summary
_To be populated during /research phase._

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (tracked in _status.json, to be read during /research)
- docs/feature_deep_dives/judge_evaluation.md — Judge Lab evaluation framework, decisiveness rates, pair-bank testing, A/B comparison methodology
- docs/feature_deep_dives/metrics_analytics.md — Raw metrics tracking and metrics calculation; performance scoring signals
- docs/feature_deep_dives/admin_panel.md — Evolution admin dashboard for viewing runs, strategies, and experiment data
- docs/feature_deep_dives/search_generation_pipeline.md — Core generation orchestration, LLM integration, structured output
- docs/feature_deep_dives/request_tracing_observability.md — Request-ID propagation; correlating LLM calls
- docs/feature_deep_dives/error_handling.md — Error categorization; why runs might score negatively
- docs/feature_deep_dives/testing_pipeline.md — A/B framework for recording pipeline step outputs
- docs/feature_deep_dives/debugging_skill.md — Systematic debugging methodology
- evolution/docs/paragraph_recombine.md — Agent deep dive: multi-dispatch, projector-vs-actual instrumentation, slot pipeline
- evolution/docs/cost_optimization.md — Budget event logger; 402 wipeouts; paragraph-recombine cost notes (Options F/G/H/I/J/K)
- evolution/docs/rating_and_comparison.md — Elo / OpenSkill rating math
- evolution/docs/arena.md — Cross-method quality comparison; head-to-head matches
- evolution/docs/architecture.md — V2 3-op flat loop (generate→rank→evolve); kill mechanism
- evolution/docs/data_model.md — Prompt + strategy = run; arena; strategy registry
- evolution/docs/metrics.md — Run-level metric writers
- evolution/docs/evolution_metrics.md — Metric definitions
- evolution/docs/criteria_agents.md — Evaluation criteria
- evolution/docs/editing_agents.md — Editing agent overview
- evolution/docs/multi_iteration_strategies.md — Multi-iteration loop config
- evolution/docs/variant_lineage.md — Variant parentage
- evolution/docs/strategies_and_experiments.md — Strategy registry, experiment lifecycle
- evolution/docs/logging.md — Entity logger
- evolution/docs/reference.md — Reference index incl. CostTracker, testing utilities

## Code Files Read
_To be populated during /research phase._

## Investigation Plan (high-level)

1. **Identify the 4 most recent paragraph_recombine runs on staging** via `npm run query:staging` against `evolution_agent_invocations` (agent_name = 'paragraph_recombine') and `evolution_runs`.
2. **Pull per-run cost + variant counts** (sum invocation costs, count variants, error_code, status, run_summary.stopReason).
3. **Pull per-rewrite instrumentation** from `execution_detail` (G1-G7 cost/temperature/drop-reason fields) — see debugging.md "paragraph_recombine cost-undershoot" section.
4. **Pull arena scoring outcomes** — `evolution_arena_comparisons` rows for slot-topic prompts; check `arena_match_count`, win/loss/draw distribution, Elo / uncertainty deltas vs seed.
5. **Quantify "negative performance"** — define: are variants losing arena matches vs the seed paragraph? Is `score_delta` (post - seed Elo) systematically < 0? Is `match_count` too low to be statistically meaningful?
6. **Identify failure mode(s)** — pick from the known set: 402 wipeout (cost_optimization.md), high length_under drop rate (debugging.md), iteration budget under-utilized, low decisiveness from judge (judge_evaluation.md), structured-output misses (project_openrouter_structured_output_gap memory), per-rewrite cost cap mismatch.
7. **Read planning doc for Sequential Context-Aware Generation** (recent commits e0026d653, 252119c5d, e5d7dbb5d) to understand if those changes introduced or unmasked the negative performance.
