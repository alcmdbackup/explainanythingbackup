# Simplify Evolution Pipeline Research

## Problem Statement
The evolution pipeline's database tables in staging and production are bloated and use inconsistent naming conventions. Tables are spread across multiple prefixes (`content_evolution_*`, `hall_of_fame_*`, `agent_*`, `batch_*`, `strategy_*`, `content_*`) making it hard to identify which tables belong to the evolution system. All evolution-specific tables should follow the `evolution_` prefix convention, and any stale or unused tables should be deleted.

## Requirements (from GH Issue #505)
1. All evolution-specific database tables must start with the `evolution_` prefix
2. Delete any stale or unused evolution tables
3. Rename tables that don't follow the convention via Supabase migrations
4. Update all TypeScript code references to use the new table names

## High Level Summary

### Live Database Inventory (from Supabase MCP)

16 evolution-related tables across 6 different prefixes. 4 of those 16 already use the correct `evolution_` prefix.

### Tables That Need Renaming → `evolution_*`

| Current Name | Rows | New Name | TS Files Referencing | FK Constraints |
|---|---|---|---|---|
| `content_evolution_runs` | 56 | `evolution_runs` | ~32 | 11 inbound FKs |
| `content_evolution_variants` | 364 | `evolution_variants` | ~11 | 4 inbound FKs |
| `hall_of_fame_topics` | 2,016 | `evolution_hall_of_fame_topics` | ~16 | 4 inbound FKs |
| `hall_of_fame_entries` | 36 | `evolution_hall_of_fame_entries` | ~13 | 7 inbound FKs |
| `hall_of_fame_comparisons` | 230 | `evolution_hall_of_fame_comparisons` | ~6 | 4 inbound FKs |
| `hall_of_fame_elo` | 34 | `evolution_hall_of_fame_elo` | ~8 | 2 inbound FKs |
| `strategy_configs` | 1,970 | `evolution_strategy_configs` | ~21 | 1 inbound FK |
| `batch_runs` | 5 | `evolution_batch_runs` | 1 | 1 inbound FK |
| `agent_cost_baselines` | **0** | `evolution_agent_cost_baselines` | 2 | 0 FKs |

### Tables Already Correctly Prefixed (no rename needed)

| Name | Rows |
|---|---|
| `evolution_checkpoints` | 889 |
| `evolution_run_agent_metrics` | 15 |
| `evolution_run_logs` | 4,622 |
| `evolution_agent_invocations` | 202 |

### Empty Evolution-Adjacent Tables (candidates for deletion or rename)

| Table | Rows | TS Files | Purpose | Recommendation |
|---|---|---|---|---|
| `agent_cost_baselines` | **0** | 2 (`costEstimator.ts`, `eloBudgetActions.ts`) | Cost estimation baselines per agent/model | **Rename** → `evolution_agent_cost_baselines`. Has active code references for cost prediction. |
| `content_history` | **0** | 5 (`evolutionActions.ts`, `contentQualityActions.ts`, integration tests, test helpers) | Content rollback history for evolution + manual edits | **Rename** → `evolution_content_history`. Used by `applyWinnerAction` and `rollbackEvolutionAction`. |
| `content_quality_scores` | **0** | 6 (`contentQualityEval.ts`, `contentQualityActions.ts`, cron route, tests) | Per-article quality dimension scores | **Rename** → `evolution_content_quality_scores`. Used by quality eval cron that feeds into evolution auto-queue. |
| `content_eval_runs` | **0** | 2 (`contentQualityEval.ts`, `contentQualityActions.ts`) | Batch quality eval run tracking | **Rename** → `evolution_content_eval_runs`. Used by quality eval cron. |

### RPC Functions That Reference Table Names

| RPC | Referenced Tables | Migration |
|---|---|---|
| `claim_evolution_run` | `content_evolution_runs` | `20260214000001` |
| `checkpoint_and_continue` | `content_evolution_runs`, `evolution_checkpoints` | `20260216000001` |
| `get_source_citation_counts` | Non-evolution | N/A |
| `get_co_cited_sources` | Non-evolution | N/A |

### FK Constraint Names (still using old `article_bank_*` prefix from pre-rename)

Many FK constraints still reference the old `article_bank_*` table names from before the `hall_of_fame` rename. Examples:
- `article_bank_entries_evolution_run_id_fkey`
- `article_bank_entries_topic_id_fkey`
- `article_bank_comparisons_topic_id_fkey`
- `article_bank_elo_topic_id_fkey`

These should be cleaned up as part of this project.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/agents/support.md
- evolution/docs/evolution/agents/flow_critique.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/reference.md

## Code Files Read
- Codebase-wide grep for all 16 table names across *.ts, *.tsx, *.sql files
- Supabase MCP `list_tables` for live row counts and FK constraints
