# Further Investigate Paragraph Recombine Performance Research

## Problem Statement
Further investigate performance of the 5 most recent paragraph recombine runs.

## Requirements (from GH Issue #1153)
Further investigate performance of 5 most recent paragraph recombine runs.

## High Level Summary
[Summary of findings — populated during /research]

Context from doc review: `paragraph_recombine` is a per-paragraph rewrite-and-rank agent that splits a parent explanation into paragraph "slots", generates N temperature-varied rewrites per slot (`paragraph_rewrite`), ranks them in a per-slot arena (`paragraph_rank`), and stitches winners back together. Recent investigations (20260529–20260530) already addressed a persistence/display bug (migration `20260529000001`), a cost-undershoot (per-rewrite instrumentation G1-G7, tighten-directive I3), and an effectiveness analysis (`analyze_effectiveness_paragraph_recombine_20260530`). This project continues that line by examining the 5 most recent runs.

Key data sources for the investigation:
- `evolution_agent_invocations` — per-invocation `cost_usd`, `duration_ms`, `execution_detail` JSONB (per-slot/per-rewrite cost, status, dropReason, temperature, estimationErrorPct)
- `evolution_variants` — persisted arena columns (`arena_match_count`, `parent_variant_ids`, `generation`, `elo_score`, `mu`, `sigma`)
- `evolution_arena_comparisons` — head-to-head match results
- `evolution_metrics` — run-level `cost`, `cost_estimation_error_pct`
- Read-only DB access via `npm run query:staging` / `npm run query:prod`

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md (includes paragraph_recombine cost-undershoot + slot-leaderboard debugging sections)

### Evolution Docs (all read per request)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/operations.md
- evolution/docs/evolution/rating.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/experiments.md
- evolution/docs/evolution/paragraph_recombine.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/strategost.md
- evolution/docs/evolution/visualizations.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/tag_system.md
- docs/feature_deep_dives/manage_sources.md
- docs/feature_deep_dives/add_sources_citations.md
- docs/feature_deep_dives/user_testing.md
- docs/feature_deep_dives/iterative_planning_agent.md

## Code Files Read
- [list of code files reviewed during /research]
