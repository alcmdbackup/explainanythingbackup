# Simplify Supabase Evolution Set Research

## Problem Statement
The evolution pipeline's Supabase schema has grown bloated with redundancies. Agent information is duplicated across `evolution_checkpoints` and `evolution_agent_invocations` tables. This project will audit the full evolution database schema, identify redundancies and duplication, and simplify/deduplicate where possible to reduce storage overhead and maintenance burden.

## Requirements (from GH Issue #504)
- Investigate duplication between `evolution_checkpoints` and `evolution_agent_invocations` tables
- Audit the full evolution schema for other redundancies (e.g., data stored in both JSONB blobs and normalized columns)
- Propose and implement simplifications that reduce schema bloat without breaking pipeline functionality
- Ensure checkpoint/resume, visualization, and admin UI features continue working after deduplication

## High Level Summary

The evolution pipeline uses **8 tables** plus **2 JSONB columns** on the runs table. Research reveals significant data duplication across these storage locations. The duplication falls into three categories:

1. **Agent execution data** duplicated across `evolution_checkpoints`, `evolution_agent_invocations`, and `evolution_run_agent_metrics` (three tables storing overlapping agent cost/execution data)
2. **Run-level metadata** cached on `content_evolution_runs` columns that duplicates data available in checkpoints (iteration, phase, pool size, cost)
3. **Variant data** stored in full in both `content_evolution_variants` and `evolution_checkpoints.state_snapshot` JSONB

---

## Evolution Schema: Complete Table Inventory

### Tables (8)

| Table | Purpose | Created |
|-------|---------|---------|
| `content_evolution_runs` | Run lifecycle, config, status, cost | `20260131000001` |
| `content_evolution_variants` | Persisted variants with final Elo scores | `20260131000002` |
| `evolution_checkpoints` | Full state snapshots for crash recovery | `20260131000003` |
| `evolution_run_agent_metrics` | Per-agent cost/Elo aggregates per run | `20260205000001` |
| `evolution_run_logs` | Structured per-entry log records | `20260211000001` |
| `evolution_agent_invocations` | Per-agent-per-iteration execution records | `20260212000001` |
| `hall_of_fame_topics` | Prompt-based grouping | `20260201000001` |
| `hall_of_fame_entries` | Generated articles for cross-method comparison | `20260201000001` |
| `hall_of_fame_comparisons` | Head-to-head match history | `20260201000001` |
| `hall_of_fame_elo` | Per-topic OpenSkill ratings | `20260201000001` |

### JSONB Columns on `content_evolution_runs`

| Column | Purpose | Created |
|--------|---------|---------|
| `config` | Run configuration overrides (from strategy) | `20260131000001` |
| `run_summary` | Post-run analytics digest | `20260131000010` |
| `cost_estimate_detail` | Pre-run cost estimate breakdown | Added later |
| `cost_prediction` | Estimated vs actual cost comparison | Added later |

---

## Finding 1: Three Tables Store Agent Cost/Execution Data

### The Three Tables

**A. `evolution_agent_invocations`** — Per-agent-per-iteration records
- Written by `persistAgentInvocation()` in `pipelineUtilities.ts:49-75`
- Called after EVERY agent execution in both minimal and full pipelines
- Stores: `agent_name`, `iteration`, `cost_usd`, `success`, `skipped`, `error_message`, `execution_detail` (JSONB up to 100KB)
- Unique on `(run_id, iteration, agent_name)`
- **Read by:** Timeline tab (cost attribution), Budget tab (cumulative burn), agent detail drill-down

**B. `evolution_run_agent_metrics`** — Per-agent-per-run aggregates
- Written by `persistAgentMetrics()` in `metricsWriter.ts:171-212`
- Called ONCE at run finalization in `finalizePipelineRun()`
- Stores: `agent_name`, `cost_usd`, `variants_generated`, `avg_elo`, `elo_gain`, `elo_per_dollar`
- Unique on `(run_id, agent_name)`
- **Read by:** Elo budget optimization dashboard, unified explorer (task/matrix/trend modes)

**C. `evolution_checkpoints.state_snapshot`** — Full serialized state
- Written by `persistCheckpoint()` in `persistence.ts:14-60`
- Called after EVERY agent execution (same cadence as invocations)
- Contains the complete pool, ratings, match history, critiques, diversity, etc.
- **Read by:** Timeline tab (checkpoint diffing for per-agent metrics), Elo history, lineage DAG, comparison view, step scores, tree search, variant detail, and checkpoint-based resume

### Overlap Analysis

| Data Point | `agent_invocations` | `agent_metrics` | `checkpoints` |
|------------|---------------------|-----------------|---------------|
| Agent name per iteration | ✓ | — | ✓ (via `last_agent` column) |
| Cost per agent per iteration | ✓ (`cost_usd`) | — | — |
| Cost per agent per run | ✓ (sum of iterations) | ✓ (`cost_usd`) | — |
| Success/failure per agent | ✓ | — | — |
| Execution detail JSONB | ✓ (100KB truncated) | — | — |
| Variants generated per agent | — | ✓ | ✓ (pool delta between checkpoints) |
| Avg Elo per agent | — | ✓ | ✓ (ratings in state_snapshot) |
| Elo per dollar | — | ✓ | — (computable from checkpoint + invocations) |
| Full pool state | — | — | ✓ |
| Match history | — | — | ✓ |
| Diversity score | — | — | ✓ |

**Key Finding:** `evolution_run_agent_metrics` is fully derivable from `evolution_agent_invocations` (for cost) + `evolution_checkpoints` (for Elo/variant data). It exists purely as a pre-computed cache for the explorer dashboard.

### Timeline Tab Double-Query Pattern

The Timeline tab (`getEvolutionRunTimelineAction` at `evolutionVisualizationActions.ts:356-465`) queries BOTH:
1. `evolution_checkpoints` — all checkpoints for the run, diffing sequential snapshots to compute variants added, matches played, rating changes per agent
2. `evolution_agent_invocations` — cost per agent per iteration (for cost attribution)

This is the clearest evidence of duplication: the timeline reconstructs per-agent metrics from two sources because neither source alone has all the data.

---

## Finding 2: Run-Level Columns Duplicate Checkpoint Data

The `content_evolution_runs` table has several columns that mirror data available in the latest checkpoint:

| Column | Also In | Written By | Read By | Can Be Derived? |
|--------|---------|-----------|---------|-----------------|
| `current_iteration` | `evolution_checkpoints.iteration` | `persistCheckpoint()` — every agent | Dashboard, explorer | YES — latest checkpoint's iteration |
| `phase` | `evolution_checkpoints.phase` | `persistCheckpoint()` — every agent | Dashboard, run detail | YES — latest checkpoint's phase |
| `total_cost_usd` | Sum of `agent_invocations.cost_usd` | `persistCheckpoint()`, finalize | Dashboard, explorer, cost analytics | YES — sum of invocations |
| `total_variants` | `state_snapshot.pool.length` | Finalization only | Dashboard, explorer | YES — pool size in checkpoint |
| `variants_generated` | Same as `total_variants` | Finalization only | Dashboard, explorer | YES — identical to total_variants |
| `runner_agents_completed` | `state_snapshot.pool.length` | `persistCheckpoint()` — every agent | **NEVER READ** | YES — and currently unused |

**Key Finding:** `runner_agents_completed` is written after every checkpoint but never read by any application code. Its name is misleading (it stores pool size, not agent count).

**Key Finding:** `total_variants` and `variants_generated` are set to the same value (`ctx.state.getPoolSize()`) at finalization. The backfill migration `20260201000002` explicitly sets `variants_generated = total_variants` for older runs.

---

## Finding 3: Variant Data Stored in Three Places

Variant data exists in:

### A. `content_evolution_variants` table (normalized)
- Written ONCE at run finalization by `persistVariants()` in `persistence.ts:62-94`
- Stores: `variant_content` (full text), `elo_score` (final), `generation`, `parent_variant_id` (FIRST parent only), `agent_name`, `match_count`, `is_winner`
- **Limitation:** Only stores first parent (`parentIds[0]`), losing multi-parent lineage

### B. `evolution_checkpoints.state_snapshot.pool` (JSONB)
- Written after EVERY agent execution
- Stores the FULL `TextVariation[]` including: `id`, `text` (full), `version`, `parentIds[]` (ALL parents), `strategy`, `createdAt`, `iterationBorn`, `costUsd`
- Also stores: full `ratings` map (mu/sigma), `matchCounts`, `matchHistory` (up to 5000), `allCritiques`, `dimensionScores`, `similarityMatrix`, `debateTranscripts`, `treeSearchResults`, `treeSearchStates`, `sectionState`

### C. `content_evolution_runs.run_summary` (JSONB)
- Written ONCE at finalization
- Stores summary only: `topVariants[].{id, strategy, ordinal, isBaseline}` (top 5), `strategyEffectiveness`, `matchStats`
- Does NOT contain variant text or full ratings

### Comparison

| Data | Variants Table | Checkpoint | Run Summary |
|------|---------------|------------|-------------|
| Full variant text | ✓ | ✓ | ✗ |
| Parent lineage | First parent only | Full `parentIds[]` | ✗ |
| Ratings (mu/sigma) | ✗ (only final Elo) | ✓ Full | ✗ (ordinal only, top 5) |
| Match count | ✓ | ✓ | ✓ (aggregated) |
| Strategy | ✓ | ✓ | ✓ (top 5 + effectiveness) |
| Iteration born | ✗ | ✓ | ✗ |
| Per-variant cost | ✗ | ✓ (optional) | ✗ |
| is_winner flag | ✓ | ✗ | Implicit (top rank) |
| Critique data | ✗ | ✓ | ✗ |

**Key Finding:** The checkpoint JSONB contains a superset of what the variants table stores, plus full lineage, ratings, and critique data. The variants table exists for quick queries (sorted by Elo) and the `is_winner` flag, but its data is always reconstructable from checkpoints via `buildVariantsFromCheckpoint()` (already implemented as a fallback).

---

## Finding 4: Logs Table Has Minor Cost Overlap

`evolution_run_logs` stores per-log-entry `cost_usd` and `duration_ms` columns (added in migration `20260215000005`). These are extracted from logger context and overlap with `evolution_agent_invocations.cost_usd` at an aggregate level. However, logs serve a distinct purpose (debugging/audit trail) and the cost column is nullable/best-effort, so this is acceptable overlap rather than true duplication.

---

## Finding 5: Hall of Fame Tables Are Clean

The 4 Hall of Fame tables (`hall_of_fame_topics`, `hall_of_fame_entries`, `hall_of_fame_comparisons`, `hall_of_fame_elo`) have no significant internal redundancy. They serve distinct purposes and don't duplicate evolution pipeline data (entries link to pipeline data via optional FKs).

---

## Data Flow Summary

```
Pipeline Execution:
  Per agent:
    → persistCheckpoint()        → evolution_checkpoints (full JSONB state)
    → persistAgentInvocation()   → evolution_agent_invocations (cost, detail, success)
    → LogBuffer.append()         → evolution_run_logs (buffered, flush at 20)

    Also updates content_evolution_runs:
      current_iteration, phase, last_heartbeat, runner_agents_completed, total_cost_usd

  At finalization (once):
    → persistVariants()          → content_evolution_variants (variant text + final Elo)
    → persistAgentMetrics()      → evolution_run_agent_metrics (per-agent cost/Elo aggregates)
    → buildRunSummary()          → content_evolution_runs.run_summary (analytics digest)
    → persistCostPrediction()    → content_evolution_runs.cost_prediction (estimate vs actual)
    → linkStrategyConfig()       → strategy_configs (aggregate update)
    → autoLinkPrompt()           → hall_of_fame_topics (link prompt)
    → feedHallOfFame()           → hall_of_fame_entries (top 3 variants)
```

---

## Redundancy Matrix

| Redundancy | Tables Involved | Severity | Notes |
|-----------|-----------------|----------|-------|
| Agent cost per run | `agent_invocations` ↔ `agent_metrics` | HIGH | `agent_metrics` is fully derivable from `agent_invocations` |
| Agent Elo/variants per run | `agent_metrics` ↔ `checkpoints` | HIGH | Elo/variant data computable from checkpoints |
| Per-agent timeline metrics | `checkpoints` ↔ `agent_invocations` | MEDIUM | Timeline queries both tables; could be unified |
| Run iteration/phase | `runs.current_iteration/phase` ↔ `checkpoints.iteration/phase` | LOW | Cached for quick UI access |
| Run total cost | `runs.total_cost_usd` ↔ sum of `agent_invocations.cost_usd` | LOW | Cached aggregate |
| `total_variants` ↔ `variants_generated` | Both on `runs` table | LOW | Identical values, redundant columns |
| `runner_agents_completed` | `runs` column, never read | LOW | Dead column |
| Full variant data | `variants` table ↔ `checkpoints` JSONB | MEDIUM | Variants table is a materialized view of checkpoint data |
| Log cost ↔ invocation cost | `run_logs.cost_usd` ↔ `agent_invocations.cost_usd` | LOW | Different granularity, acceptable |

---

## Deep Dive: UI Component → Table Dependency Matrix

Mapping which UI pages and server actions depend on each table, to assess blast radius of schema changes.

### `content_evolution_runs` — Highest Fan-Out

| Consumer | Columns Used |
|----------|-------------|
| `getEvolutionRunsAction` | status, current_iteration, phase, total_cost_usd, total_variants, config, created_at |
| `getEvolutionRunDetailAction` | All columns including run_summary, cost_prediction |
| `getUnifiedExplorerAction` (task mode) | status, total_cost_usd, total_variants, config |
| `getUnifiedExplorerAction` (matrix mode) | strategy (from config), total_cost_usd |
| `getUnifiedExplorerAction` (trend mode) | created_at, total_cost_usd, total_variants |
| `getCostAnalyticsAction` | total_cost_usd, cost_estimate_detail, cost_prediction |
| `getEvolutionRunSummaryAction` | run_summary |
| Dashboard cards | status, current_iteration, total_cost_usd |
| Run detail page | All columns |
| Explorer table/matrix/trend | Various subsets |

**Blast radius:** 10 server actions, 8+ components, 6 page routes. Removing cached columns here requires updating all consumers to join/aggregate from source tables.

### `evolution_checkpoints` — 10 Read Consumers

| Consumer | Data Extracted |
|----------|---------------|
| Timeline tab | Sequential checkpoint diffing → variants added, matches played, rating changes per agent |
| Elo history chart | `state_snapshot.ratings` across iterations |
| Lineage DAG | `state_snapshot.pool[].parentIds` (full lineage, not available elsewhere) |
| Comparison view | `state_snapshot.pool[].text` for side-by-side |
| Step scores | `state_snapshot.dimensionScores` per iteration |
| Tree search viz | `state_snapshot.treeSearchResults`, `treeSearchStates` (checkpoint-only) |
| Variant detail | Full variant data from checkpoint pool |
| `buildVariantsFromCheckpoint()` | Fallback when variants table is empty |
| `loadCheckpointForResume()` | Full state deserialization for crash recovery |
| `checkpointAndMarkContinuationPending()` | Latest checkpoint for Vercel continuation |

**Key:** Many fields are checkpoint-only — `parentIds[]` (full lineage), `treeSearchResults`, `treeSearchStates`, `allCritiques`, `debateTranscripts`, `similarityMatrix`. These have NO other storage location.

### `evolution_agent_invocations` — 3 Read Consumers

| Consumer | Data Used |
|----------|-----------|
| Timeline tab | `cost_usd` per agent per iteration (cost attribution bars) |
| Budget tab | Cumulative `cost_usd` burn over iterations |
| Agent detail drill-down | `execution_detail` JSONB, `success`, `error_message` |

### `evolution_run_agent_metrics` — 5 Read Consumers

| Consumer | Data Used |
|----------|-----------|
| `getAgentROILeaderboardAction` | `cost_usd`, `elo_gain`, `elo_per_dollar` per agent |
| `getOptimizationSummaryAction` | Aggregated `cost_usd`, `elo_per_dollar` across runs |
| `getUnifiedExplorerAction` (task) | `agent_name`, `cost_usd` joined with run data |
| `getUnifiedExplorerAction` (matrix) | `agent_name` as row dimension |
| `getUnifiedExplorerAction` (trend) | `agent_name` for per-agent trend lines |

### `content_evolution_variants` — 4 Read Consumers

| Consumer | Data Used |
|----------|-----------|
| `getEvolutionVariantsAction` | All columns (with checkpoint fallback) |
| `applyWinnerAction` (RPC) | `variant_content`, sets `is_winner = true` |
| Hall of Fame linking | `variant_content` for top variants |
| Comparison view | `is_winner` flag for winner highlighting |

**Critical:** The `is_winner` flag is the key differentiator — it's set atomically via RPC and is NOT stored in checkpoints. The variants table is the source of truth for which variant was applied as the winner.

---

## Deep Dive: Checkpoint JSONB Size Analysis

### Size per Checkpoint Row

Based on `serializeState()` in `state.ts:111-155` and the `SerializedPipelineState` type:

| Component | Estimated Size (iteration 10) | Notes |
|-----------|-------------------------------|-------|
| `pool` (TextVariation[]) | ~1.5 MB | ~30 variants × ~50KB each (full article text + metadata) |
| `ratings` map | ~10 KB | mu/sigma per variant |
| `matchHistory` | ~500 KB | Up to MAX_MATCH_HISTORY=5000 entries |
| `allCritiques` | ~800 KB | Limited to MAX_CRITIQUE_ITERATIONS=5 but rich text |
| `dimensionScores` | ~50 KB | Per-variant dimension analysis |
| `similarityMatrix` | ~100 KB | N×N float matrix |
| `treeSearchResults` | ~100 KB | Optional, only for tree search runs |
| `debateTranscripts` | ~50 KB | Optional, only for debate agent |
| **Total per row** | **~3.1 MB** | At mid-run (iteration 10 of 15) |

### Growth per Run

| Metric | Value |
|--------|-------|
| Checkpoints per iteration | ~13 (one per agent execution) |
| Iterations per run | ~15 (typical full run) |
| Total rows per run | ~195 |
| Size per row (average) | ~1.5 MB (grows from ~200KB at iter 1 to ~3.1MB at iter 10+) |
| **Total per run** | **~305 MB** |

### No Cleanup Mechanism

There is **no TTL, garbage collection, or pruning** on checkpoints. Every checkpoint ever written persists indefinitely. For a production deployment running multiple evolution jobs, this accumulates quickly:

- 10 runs → ~3 GB of checkpoint data
- 100 runs → ~30 GB
- The `state_snapshot` JSONB column accounts for >99% of the table's storage

**Observation:** Only the LATEST checkpoint per run is needed for resume. Historical checkpoints are used for visualization (timeline diffing, Elo history charts) but could potentially be pruned after finalization.

---

## Deep Dive: Exhaustive Consumer Traces

### `evolution_run_agent_metrics` — Derivability Assessment

All 5 consumers read pre-aggregated per-agent-per-run data. This data IS derivable at query time from:
- **Cost per agent:** `SELECT agent_name, SUM(cost_usd) FROM evolution_agent_invocations WHERE run_id = ? GROUP BY agent_name`
- **Elo/variant data:** Diff first and last checkpoints per run per agent to compute `avg_elo`, `elo_gain`, `variants_generated`

**Trade-off:** The agent_metrics table exists as a materialized aggregate. Replacing it with runtime queries would:
- Add ~200ms to each explorer query (join + aggregate across invocations + 2 checkpoint reads per run)
- Work correctly for historical runs (data is in invocations/checkpoints)
- Eliminate a finalization-only write path

### `runner_agents_completed` — Confirmed Dead Column

Exhaustive grep confirms: this column is written in `persistCheckpoint()` but has **zero reads** in any server action, component, or script. It stores `ctx.state.getPoolSize()` (pool size), not agent count — the name itself is misleading. Safe to drop.

### `total_variants` vs `variants_generated` — Confirmed Redundant

Both are set to `ctx.state.getPoolSize()` at finalization. The backfill migration `20260201000002` explicitly sets `variants_generated = total_variants` for older runs, confirming they are always identical. One can be dropped.

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/feature_deep_dives/testing_setup.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/visualization.md

## Code Files Read

### Migrations (all evolution-related)
- `supabase/migrations/20260131000001_content_evolution_runs.sql`
- `supabase/migrations/20260131000002_content_evolution_variants.sql`
- `supabase/migrations/20260131000003_evolution_checkpoints.sql`
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql`
- `supabase/migrations/20260211000001_evolution_run_logs.sql`
- `supabase/migrations/20260212000001_evolution_agent_invocations.sql`
- `supabase/migrations/20260131000008_evolution_runs_optional_explanation.sql`
- `supabase/migrations/20260131000010_add_evolution_run_summary.sql`
- `supabase/migrations/20260214000001_claim_evolution_run.sql`
- `supabase/migrations/20260215000002_apply_evolution_winner_rpc.sql`
- `supabase/migrations/20260215000004_evolution_runs_status_index.sql`
- `supabase/migrations/20260215000005_evolution_logs_tracing.sql`
- `supabase/migrations/20260215000006_delete_evolution_feature_flags.sql`
- `supabase/migrations/20260220000001_inter_agent_timeout_checkpoint.sql`

### Pipeline Core (via sub-agents)
- `evolution/src/lib/core/persistence.ts` — persistCheckpoint(), persistVariants(), loadCheckpointForResume(), checkpointAndMarkContinuationPending()
- `evolution/src/lib/core/pipeline.ts` — executeMinimalPipeline(), executeFullPipeline(), finalizePipelineRun(), buildRunSummary(), persistCheckpointWithSupervisor()
- `evolution/src/lib/core/pipelineUtilities.ts` — persistAgentInvocation(), truncateDetail()
- `evolution/src/lib/core/metricsWriter.ts` — persistAgentMetrics(), persistCostPrediction(), linkStrategyConfig(), STRATEGY_TO_AGENT mapping
- `evolution/src/lib/core/state.ts` — serializeState(), deserializeState()
- `evolution/src/lib/core/logger.ts` — LogBuffer, createDbEvolutionLogger()
- `evolution/src/lib/types.ts` — SerializedPipelineState, TextVariation, EvolutionRunSummary, AgentExecutionDetail types

### Server Actions (via sub-agents)
- `evolution/src/services/evolutionVisualizationActions.ts` — all 12 visualization actions
- `evolution/src/services/evolutionActions.ts` — run CRUD, variant queries, summary, logs
- `evolution/src/services/eloBudgetActions.ts` — agent ROI leaderboard, optimization summary
- `evolution/src/services/unifiedExplorerActions.ts` — explorer table/matrix/trend modes
- `evolution/src/services/costAnalyticsActions.ts` — cost analytics (reads runs table cost columns)

### Deep Dive Traces (round 2, via sub-agents)
- All UI components consuming `content_evolution_runs` columns
- All UI components consuming `evolution_checkpoints` (10 consumers mapped)
- All UI components consuming `evolution_run_agent_metrics` (5 consumers mapped)
- All UI components consuming `content_evolution_variants` (4 consumers mapped)
- All UI components consuming `evolution_agent_invocations` (3 consumers mapped)
- Checkpoint JSONB size estimation via `state.ts` serialization path

---

## Finding 6: No RLS — Application-Level Security Only

Evolution tables do **not** have Row Level Security (RLS) enabled. This is intentional — the `article_bank.sql` migration explicitly states "No RLS: admin-only access via service client in server actions (requireAdmin guard)."

All evolution tables rely on:
- **Service-role Supabase client** in server actions
- **`requireAdmin()` guard** in TypeScript before any DB access
- No RLS policies on any of: `content_evolution_runs`, `content_evolution_variants`, `evolution_checkpoints`, `evolution_run_logs`, `evolution_agent_invocations`, `evolution_run_agent_metrics`, or Hall of Fame tables

**Implication for simplification:** Schema changes don't need to consider RLS policy migrations — there are none to update.

---

## Finding 7: Complete Index Inventory

### Core Evolution Tables

**`content_evolution_runs`** (10 indexes):
| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `idx_evolution_runs_pending` | `(created_at ASC)` WHERE `status='pending'` | Partial | Batch runner claim |
| `idx_evolution_runs_heartbeat` | `(last_heartbeat)` WHERE `status IN ('claimed','running')` | Partial | Watchdog stale check |
| `idx_evolution_runs_explanation` | `(explanation_id, created_at DESC)` | Composite | Admin UI article lookups |
| `idx_evolution_runs_batch` | `(batch_run_id)` | Simple | Batch relationship |
| `idx_evolution_runs_prompt` | `(prompt_id)` | Simple | Prompt registry lookup |
| `idx_evolution_runs_strategy` | `(strategy_config_id)` | Simple | Strategy tracking |
| `idx_evolution_runs_status` | `(status, created_at DESC)` | Composite | Dashboard queries |
| `idx_evolution_runs_continuation` | `(created_at ASC)` WHERE `status='continuation_pending'` | Partial | Continuation queue |
| `idx_evolution_runs_explorer` | `(prompt_id, pipeline_type, strategy_config_id)` | Composite | Explorer filter |
| `idx_evolution_runs_summary_gin` | GIN on `(run_summary)` WHERE NOT NULL | GIN | JSONB analytics |

**`content_evolution_variants`** (2 indexes):
| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_variants_run_elo` | `(run_id, elo_score DESC)` | Top variants query |
| `idx_variants_parent` | `(parent_variant_id)` WHERE NOT NULL | Lineage tracking |

**`evolution_checkpoints`** (2 indexes):
| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_checkpoints_run_latest` | `(run_id, created_at DESC)` | Resume: latest checkpoint |
| `idx_checkpoints_unique_agent` | UNIQUE `(run_id, iteration, last_agent)` | Prevent duplicates |

**`evolution_run_agent_metrics`** (4 indexes):
| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_agent_metrics_run_id` | `(run_id)` | Per-run lookup |
| `idx_agent_metrics_elo_per_dollar` | `(elo_per_dollar DESC NULLS LAST)` | Cost-efficiency sort |
| `idx_agent_metrics_agent_name` | `(agent_name)` | Per-agent aggregation |
| UNIQUE constraint | `(run_id, agent_name)` | One row per agent per run |

**`evolution_run_logs`** (6 indexes):
| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_run_logs_run_id` | `(run_id, created_at DESC)` | Primary log lookup |
| `idx_run_logs_iteration` | `(run_id, iteration)` | Timeline sections |
| `idx_run_logs_agent` | `(run_id, agent_name)` | Agent log filtering |
| `idx_run_logs_variant` | `(run_id, variant_id)` | Variant log filtering |
| `idx_run_logs_level` | `(run_id, level)` | Error filtering |
| `idx_run_logs_request_id` | `(run_id, request_id)` WHERE NOT NULL | Distributed tracing |

**`evolution_agent_invocations`** (3 indexes):
| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_agent_invocations_run` | `(run_id, iteration)` | Per-iteration lookup |
| `idx_agent_invocations_agent` | `(run_id, agent_name)` | Per-agent history |
| UNIQUE constraint | `(run_id, iteration, agent_name)` | One row per agent per iteration |

**Implication for simplification:** Dropping `evolution_run_agent_metrics` removes 4 indexes. Dropping columns on `content_evolution_runs` (e.g., `runner_agents_completed`, `variants_generated`) doesn't require index changes since those columns aren't indexed.

---

## Finding 8: Foreign Key Dependency Graph

```
content_evolution_runs
├── explanation_id → explanations(id) [CASCADE]
├── batch_run_id → batch_runs(id) [NO ACTION]
├── prompt_id → article_bank_topics(id) [NO ACTION]
└── strategy_config_id → strategy_configs(id) [NO ACTION]

content_evolution_variants
├── run_id → content_evolution_runs(id) [CASCADE]
├── explanation_id → explanations(id) [CASCADE]
└── parent_variant_id → content_evolution_variants(id) [SET NULL]

evolution_checkpoints
└── run_id → content_evolution_runs(id) [CASCADE]

evolution_agent_invocations
└── run_id → content_evolution_runs(id) [CASCADE]

evolution_run_agent_metrics
└── run_id → content_evolution_runs(id) [CASCADE]

evolution_run_logs
└── run_id → content_evolution_runs(id) [CASCADE]

hall_of_fame_entries
├── topic_id → hall_of_fame_topics(id) [CASCADE]
├── evolution_run_id → content_evolution_runs(id) [SET NULL]
└── evolution_variant_id → content_evolution_variants(id) [SET NULL]

hall_of_fame_comparisons
├── topic_id → hall_of_fame_topics(id) [CASCADE]
├── entry_a_id → hall_of_fame_entries(id) [CASCADE]
├── entry_b_id → hall_of_fame_entries(id) [CASCADE]
└── winner_id → hall_of_fame_entries(id) [SET NULL]

hall_of_fame_elo
├── topic_id → hall_of_fame_topics(id) [CASCADE]
└── entry_id → hall_of_fame_entries(id) [CASCADE]
```

**Key cascade behavior:** Deleting a `content_evolution_runs` row cascades to variants, checkpoints, invocations, metrics, and logs. Hall of Fame entries SET NULL on run/variant delete (preserving the entry itself).

**Implication for simplification:** Dropping `evolution_run_agent_metrics` is safe — only FK is to runs (CASCADE). No other table references it.

---

## Finding 9: RPC Functions Inventory

### 4 Evolution RPCs

| RPC | Purpose | Tables Touched | Migration |
|-----|---------|---------------|-----------|
| `claim_evolution_run(p_runner_id)` | Atomic run claim with `FOR UPDATE SKIP LOCKED` | `content_evolution_runs` (R/W) | 20260214, updated 20260216 |
| `apply_evolution_winner(p_explanation_id, p_variant_id, p_run_id, p_applied_by)` | Atomic winner application (3 ops in 1 txn) | `content_history` (W), `explanations` (W), `content_evolution_variants` (W) | 20260215000002 |
| `checkpoint_and_continue(p_run_id, p_iteration, p_phase, p_state_snapshot, ...)` | Atomic checkpoint + continuation transition | `evolution_checkpoints` (upsert), `content_evolution_runs` (W) | 20260216, updated 20260220 |
| `update_strategy_aggregates(p_strategy_id, p_cost_usd, p_final_elo)` | Incremental strategy metric rollup | `strategy_configs` (R/W) | 20260205000005 |

**No triggers or views** exist on evolution tables.

**Implication for simplification:** `checkpoint_and_continue` writes `runner_agents_completed` — if that column is dropped, the RPC must be updated. `claim_evolution_run` doesn't touch any of the redundant columns identified for removal.

---

## Finding 10: TypeScript Type Gaps vs DB Schema

### Key Divergences

| Gap | DB | TypeScript | Risk |
|-----|-----|-----------|------|
| Parent lineage | `parent_variant_id UUID` (single) | `TextVariation.parentIds: string[]` (multi) | Multi-parent lineage lost in variants table; only preserved in checkpoint JSONB |
| Agent invocation row | Full table schema | No exported `AgentInvocation` TS type | Ad-hoc queries with inline types |
| Agent metrics row | Full table schema | No exported `AgentMetrics` TS type | Computed inline in `metricsWriter.ts` |
| Quality scores | `quality_scores JSONB` on variants | No explicit `QualityScores` type | Treated as `Record<string, number>` ad-hoc |
| Rating format | `elo_score NUMERIC` (display scale) | `Rating = { mu, sigma }` (OpenSkill) | Conversion via `ordinalToEloScale()` — column name is legacy |
| Legacy checkpoint fields | May have `eloRatings` | `eloRatings?: Record<string, number>` deprecated | V1→V2 transform handles this; backward compat maintained |

### Zod Validation Coverage

| Type | Has Zod Schema? | Location |
|------|----------------|----------|
| EvolutionRunSummary (V1+V2) | YES | `types.ts:621-710` |
| RunCostEstimate | YES | `costEstimator.ts:31-36` |
| CostPrediction | YES | `costEstimator.ts` |
| SerializedPipelineState | YES (lightweight) | `evolutionVisualizationActions.ts:28-34` |
| StrategyConfig input | YES | `strategyConfig.ts:115-123` |
| AgentExecutionDetail | NO | Discriminated union only |
| AgentInvocation row | NO | No type exists |

**Implication for simplification:** If `evolution_run_agent_metrics` is dropped and replaced with runtime queries, no existing TS type needs to change (there isn't one). New query results would need a new type definition.

---

## Deep Dive: Resume & Continuation Flow

### Resume Mechanics

`loadCheckpointForResume()` in `persistence.ts:167-206`:
1. Queries `evolution_checkpoints` filtering for `last_agent IN ('iteration_complete', 'continuation_yield')`
2. Gets LATEST checkpoint only (DESC order, limit 1)
3. Deserializes via `deserializeState()` → full `PipelineState`
4. Returns `CheckpointResumeData`: state + supervisorState + costTrackerTotalSpent + comparisonCacheEntries + resumeAgentNames

### Continuation Flow (Vercel Timeout)

`checkpointAndMarkContinuationPending()` in `persistence.ts:116-155`:
1. Serializes current state + supervisorState + costTracker + comparisonCache
2. Calls `checkpoint_and_continue` RPC which atomically:
   - Upserts checkpoint (ON CONFLICT `run_id, iteration, last_agent`)
   - Transitions run to `continuation_pending`, clears `runner_id`, increments `continuation_count`
3. Two patterns: `iteration_complete` (between iterations) and `continuation_yield` (mid-iteration timeout)

### Inter-Agent Timeout (Migration 20260220000001)

Pipeline checks `isNearTimeout()` between agent executions:
- Safety margin = 10% of elapsed time (60-120s minimum)
- On timeout: saves `resumeAgentNames` (remaining agents) to checkpoint
- Next claim resumes with only the unfinished agents

### Checkpoint Data: Resume-Critical vs Visualization-Only

**Resume-critical** (pipeline breaks without these):
- `pool` + `ratings` + `matchCounts` + `matchHistory` + `originalText`
- `supervisorState` (phase detection, plateau)
- `costTrackerTotalSpent` (budget enforcement)

**Visualization-only** (UI features degrade but pipeline runs fine):
- `allCritiques`, `dimensionScores`, `diversityScore`, `metaFeedback`
- `debateTranscripts`, `treeSearchResults/States`, `sectionState`
- `similarityMatrix`

---

## Deep Dive: Cost Prediction/Estimation Data Flow

### Pre-Run (Queue Time)
1. `estimateRunCostWithAgentModels()` in `costEstimator.ts:145-226` — fetches `agent_cost_baselines`, scales by text length, applies per-agent budget caps
2. Result validated via `RunCostEstimateSchema`
3. Stored as: `estimated_cost_usd` (NUMERIC) + `cost_estimate_detail` (JSONB) on `content_evolution_runs`
4. If estimate > budget_cap, run rejected at queue time

### Post-Run (Finalization)
1. `persistCostPrediction()` in `metricsWriter.ts:127-168` reads `cost_estimate_detail` back
2. Computes `CostPrediction`: `{ estimatedUsd, actualUsd, deltaUsd, deltaPercent, confidence, perAgent }`
3. Stored as `cost_prediction` JSONB on `content_evolution_runs`
4. Read by `getCostAccuracyOverviewAction()` in `costAnalyticsActions.ts`

### Strategy Config Linkage

`linkStrategyConfig()` in `metricsWriter.ts:41-102`:
1. Extracts normalized config from run, hashes it (12-char SHA256 of generationModel + judgeModel + iterations + enabledAgents + singleArticle)
2. Upserts into `strategy_configs` table (dedup by hash)
3. Links run via `strategy_config_id` FK
4. Updates strategy aggregates via `update_strategy_aggregates()` RPC

**Not duplicated:** `strategy_configs.config` is the canonical normalized config; `content_evolution_runs.config` may have run-specific overrides (budgets, agent models). The hash ignores these overrides.

---

## Deep Dive: Checkpoint Pruning Impact

If checkpoints were pruned to **latest only per run**:

| Feature | Impact | Severity |
|---------|--------|----------|
| Pipeline resume | Works — only needs latest | NONE |
| Timeline tab | Broken — needs all checkpoints for sequential diffing | HIGH |
| Elo history chart | Broken — needs per-iteration ratings snapshots | HIGH |
| Lineage DAG | Works — uses latest checkpoint's pool.parentIds | NONE |
| Comparison view | Works — uses latest checkpoint | NONE |
| Step scores | Broken — needs per-iteration dimensionScores | MEDIUM |
| Tree search viz | Works — uses latest checkpoint | NONE |
| Variant detail | Works — uses latest checkpoint | NONE |
| Budget burn chart | Partially works — can use agent_invocations for cost, but loses checkpoint-derived metrics | LOW |

If checkpoints were pruned to **one per iteration** (latest agent per iteration):

| Feature | Impact | Severity |
|---------|--------|----------|
| Timeline tab | Degraded — loses per-agent granularity within iterations | MEDIUM |
| Elo history | Works — queries latest per iteration | NONE |
| All other features | Works | NONE |

**Potential strategy:** Keep one checkpoint per iteration (latest agent) for completed runs, all checkpoints for active/recent runs.

---

## Code Files Read (round 3)

### Migrations (newly analyzed)
- All evolution-related migrations for RLS, indexes, FKs, RPCs, triggers, views, constraints
- `20260214000001_claim_evolution_run.sql` — claim RPC
- `20260216000001_add_continuation_pending_status.sql` — continuation flow
- `20260220000001_inter_agent_timeout_checkpoint.sql` — mid-iteration yield
- `20260205000005_add_strategy_configs.sql` — strategy management
- `20260210000001_add_cost_estimate_columns.sql` — cost prediction

### Pipeline Core (newly analyzed)
- `evolution/src/lib/core/costEstimator.ts` — cost estimation + prediction types
- `evolution/src/lib/core/strategyConfig.ts` — strategy config types + hashing
- `evolution/src/lib/core/persistence.ts` — resume/continuation mechanics
- `evolution/src/lib/core/pipeline.ts` — inter-agent timeout logic
- `evolution/src/services/evolutionRunnerCore.ts` — claim and execute flow

### Type Definitions (newly analyzed)
- `evolution/src/lib/types.ts` — complete type audit (TextVariation, SerializedPipelineState, AgentExecutionDetail union, EvolutionRunSummary V1/V2, Zod schemas)
- `evolution/src/lib/core/rating.ts` — Rating type (mu/sigma)
- `evolution/src/lib/section/types.ts` — SectionEvolutionState
- `evolution/src/lib/treeOfThought/types.ts` — TreeNode, TreeSearchResult, TreeState
- `evolution/src/services/evolutionActions.ts` — EvolutionRun, EvolutionVariant service types
- `evolution/src/services/evolutionVisualizationActions.ts` — Dashboard, Timeline, Elo, Lineage, Budget data types
