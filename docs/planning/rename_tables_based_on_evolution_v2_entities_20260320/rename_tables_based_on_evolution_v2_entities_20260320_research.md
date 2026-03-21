# Rename Tables Based on Evolution V2 Entities Research

## Problem Statement
Evolution V2 introduced clean entity names (Prompt, Strategy, Run, Variant, etc.) but several database tables still carry V1-era names that don't match. The biggest offender is `evolution_arena_topics` which is universally called "Prompt" in V2 code, and `evolution_strategy_configs` which maps to the "Strategy" entity. Additionally, the `evolution_arena_elo` table still exists in stage despite being merged into `evolution_arena_entries` during the V2 clean-slate migration.

## Requirements
1. Rename `evolution_arena_topics` → `evolution_prompts` (entity: Prompt)
2. Rename `evolution_strategy_configs` → `evolution_strategies` (entity: Strategy)
3. Drop `evolution_arena_elo` table (stale V1 artifact — verify gone, ensure migration covers it)
4. Drop `evolution_arena_batch_runs` table (completely unused — never-implemented rate-limiting feature)
5. Drop `difficulty_tier` and `domain_tags` columns from prompts table (unused categorization — remove from DB, types, actions, UI, tests)
6. Rename FK columns (`strategy_config_id` → `strategy_id`, `topic_id` → `prompt_id` on arena tables)
7. Update all code references (services, actions, types, components, tests)
8. Update all documentation (evolution docs, feature deep dives, architecture)

## High Level Summary

### Current Table → Entity Mapping

| V2 Entity | Current Table | Action |
|-----------|--------------|--------|
| Prompt | `evolution_arena_topics` | **Rename → `evolution_prompts`** |
| Strategy | `evolution_strategy_configs` | **Rename → `evolution_strategies`** |
| Arena Elo | `evolution_arena_elo` | **Drop** (merged into entries in V2 migration; should already be gone) |
| Arena Batch Run | `evolution_arena_batch_runs` | **Drop** (unused — no code, RPCs, or actions reference it) |
| Experiment | `evolution_experiments` | Clean |
| Run | `evolution_runs` | Clean |
| Variant | `evolution_variants` | Clean |
| Evolution Explanation | `evolution_explanations` | Clean |
| Agent Invocation | `evolution_agent_invocations` | Clean |
| Run Log | `evolution_run_logs` | Clean |
| Budget Event | `evolution_budget_events` | Clean |
| Arena Entry | `evolution_arena_entries` | Clean |
| Arena Comparison | `evolution_arena_comparisons` | Clean |
| Run Costs (view) | `evolution_run_costs` | Clean |

### `evolution_arena_elo` — Why It Should Be Dropped

The V2 clean-slate migration (`20260315000001_evolution_v2.sql`) already contains `DROP TABLE IF EXISTS evolution_arena_elo CASCADE` (line 38) and does NOT recreate it. Elo data (`mu`, `sigma`, `elo_rating`, `match_count`) was merged directly into `evolution_arena_entries`. No V2 code reads from or writes to the old table. The migration CI has run successfully after this was merged, so the table should already be gone in stage — but user reports seeing it, so we need to verify and ensure it's dropped.

Multiple docs (architecture.md, arena.md, reference.md) still reference `evolution_arena_elo` as a separate table — these are stale.

### `evolution_arena_batch_runs` — Why It Should Be Dropped

Created in the V2 migration for a planned arena batch comparison rate-limiting feature ("max 3 concurrent batch comparisons across all topics") that was never implemented:
- No TypeScript code references this table
- No RPCs reference it
- No server actions query or write to it
- The planned `runArenaBatchComparisonAction()` was documented but never built
- Only references are in the migration itself and RLS policies

### `difficulty_tier` and `domain_tags` — Why They Should Be Removed

These columns on `evolution_arena_topics` (soon `evolution_prompts`) provide optional categorization (difficulty: easy/medium/hard; domain tags: science, math, etc.) that adds complexity without clear value. Removing them simplifies the Prompt entity.

**Files affected (13 total):**

Types (2 files):
- `evolution/src/lib/types.ts` — `PromptMetadata` interface (lines 584-585)
- `evolution/src/services/arenaActions.ts` — `ArenaTopic` interface (lines 15-16), `PromptListItem` interface (lines 210-211)

Server actions (2 files):
- `evolution/src/services/arenaActions.ts` — createTopicSchema, createArenaTopicAction, createPromptSchema, createPromptAction, updatePromptSchema, updatePromptAction, listPromptsAction (difficulty filter), getArenaTopicsAction, getArenaTopicDetailAction, getPromptDetailAction
- `evolution/src/services/experimentActionsV2.ts` — getPromptsAction select clause (line 82)

UI pages (3 files):
- `src/app/admin/evolution/prompts/page.tsx` — column def, filter config, form fields, form submission
- `src/app/admin/evolution/prompts/[promptId]/page.tsx` — detail display (metrics + tags section)
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — detail display (MetricGrid)

Tests (5 files):
- `src/app/admin/evolution/prompts/page.test.tsx` — mock data, filter test
- `src/app/admin/evolution/arena/page.test.tsx` — mock data
- `src/app/admin/evolution/arena/[topicId]/page.test.tsx` — mock data
- `evolution/src/services/arenaActions.test.ts` — mock data, create topic test
- `evolution/src/lib/shared/strategyConfig.test.ts` — PromptMetadata validation tests

Docs (1 file):
- `evolution/docs/evolution/data_model.md` — 3 references (core primitives, dimensional model, migrations)

### FK Column Renames

| Current FK | New FK | Tables Affected |
|-----------|--------|----------------|
| `strategy_config_id` | `strategy_id` | `evolution_runs` |
| `topic_id` | `prompt_id` | `evolution_arena_entries`, `evolution_arena_comparisons` |

Note: `prompt_id` already exists on `evolution_runs` and `evolution_experiments` — those are clean.

### Complete V2 Evolution Tables (after this project)

After renames and drops, the final set of evolution tables will be:

| # | Table | Entity | Purpose |
|---|-------|--------|---------|
| 1 | `evolution_prompts` | Prompt | Registered topics with status. Case-insensitive unique prompt. |
| 2 | `evolution_strategies` | Strategy | Pipeline configs with hash-based dedup, aggregate metrics (run_count, avg/best/worst Elo, cost). |
| 3 | `evolution_experiments` | Experiment | Named experiment targeting one prompt. Status: draft→running→completed/cancelled/archived. |
| 4 | `evolution_runs` | Run | Single pipeline execution. Links prompt, strategy, experiment, evolution_explanation. Tracks status, heartbeat, run_summary JSONB. |
| 5 | `evolution_explanations` | Evolution Explanation | Decoupled seed content record. Source: 'explanation' (from explanations table) or 'prompt_seed' (LLM-generated). |
| 6 | `evolution_variants` | Variant | Generated text variants with Elo score, agent lineage, parent tracking, is_winner flag. |
| 7 | `evolution_agent_invocations` | Agent Invocation | Per-operation execution records: agent_name, iteration, cost_usd, execution_detail JSONB, duration. |
| 8 | `evolution_run_logs` | Run Log | Structured log entries: level, message, context JSONB, agent_name, iteration. |
| 9 | `evolution_budget_events` | Budget Event | Reserve-before-spend audit log: reserve/spend/release_ok/release_failed events per run. |
| 10 | `evolution_arena_entries` | Arena Entry | Articles with embedded Elo (mu, sigma, elo_rating, match_count). Linked to topic, optional run/variant. |
| 11 | `evolution_arena_comparisons` | Arena Comparison | Pairwise match results: entry_a vs entry_b, winner (a/b/draw), confidence, judge model. |

Plus 1 view:
| View | Purpose |
|------|---------|
| `evolution_run_costs` | Cost aggregation: SUM(cost_usd) from invocations grouped by run_id |

And 5 RPCs:
| RPC | Purpose |
|-----|---------|
| `claim_evolution_run(TEXT, UUID)` | Atomic run claiming with FOR UPDATE SKIP LOCKED |
| `update_strategy_aggregates(UUID, NUMERIC, NUMERIC)` | Update strategy metrics after run completion |
| `sync_to_arena(UUID, UUID, JSONB, JSONB)` | Atomic sync of pipeline results to arena entries/comparisons |
| `cancel_experiment(UUID)` | Cancel experiment + bulk-fail pending/claimed/running runs |
| `get_run_total_cost(UUID)` | Single-run cost from invocations (SECURITY DEFINER) |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/experimental_framework.md
- docs/feature_deep_dives/admin_panel.md
- docs/feature_deep_dives/server_action_patterns.md

## Code Files Read
- supabase/migrations/20260315000001_evolution_v2.sql (V2 clean-slate migration — confirmed arena_elo merged into entries)
- evolution/src/lib/pipeline/arena.ts (load/sync — references evolution_arena_entries only)
- evolution/src/services/arenaActions.ts (admin actions)
