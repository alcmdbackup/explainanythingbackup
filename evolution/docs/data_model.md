# Data Model

The evolution pipeline persists all state in Supabase (Postgres). This document covers the V2 schema (post-20260315 clean-slate migration), entity relationships, RPC functions, RLS policies, type definitions, and schema evolution history.

For how these tables are used at runtime, see [Architecture](./architecture.md). For the rating columns (`mu`, `sigma`, `elo_score`) — see [Rating System](./rating_and_comparison.md). Note that `evolution_variants.mu`/`sigma` are kept as DB columns (the stale trigger and `sync_to_arena` RPC depend on them), but the TypeScript layer exposes them as the abstract `Rating = {elo, uncertainty}` type via the `dbToRating` / `ratingToDb` boundary helpers.

---

## Tables

### `evolution_strategies`

Stores strategy configurations with aggregated performance metrics. Strategies are deduplicated by SHA-256 config hash.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default `gen_random_uuid()` | |
| `name` | TEXT | NOT NULL | Human-readable name |
| `label` | TEXT | NOT NULL, default `''` | Short label for UI |
| `description` | TEXT | | Optional long description |
| `config` | JSONB | NOT NULL | Full strategy configuration (`StrategyConfig`: generationModel, judgeModel, iterationConfigs[], strategiesPerRound, budgetUsd, generationGuidance). `iterationConfigs` is an ordered array of `{ agentType, budgetPercent, maxAgents?, generationGuidance? }` objects defining the iteration sequence. Per-iteration `generationGuidance` overrides the strategy-level setting for that iteration. See [Strategies](./strategies_and_experiments.md) for field details. |
| `config_hash` | TEXT | NOT NULL, UNIQUE | SHA-256 hash for dedup |
| `is_predefined` | BOOLEAN | NOT NULL, default `false` | System-provided strategy |
| `pipeline_type` | TEXT | default `'full'` | `'full'` or `'single'` |
| `status` | TEXT | NOT NULL, CHECK `('active','archived')` | |
| `created_by` | TEXT | NOT NULL, default `'system'` | |
| `run_count` | INT | NOT NULL, default `0` | Aggregate: total runs |
| `total_cost_usd` | NUMERIC | NOT NULL, default `0` | Aggregate: cumulative cost |
| `avg_final_elo` | NUMERIC | | Welford's running average |
| `best_final_elo` | NUMERIC | | Best Elo across all runs |
| `worst_final_elo` | NUMERIC | | Worst Elo across all runs |
| `stddev_final_elo` | NUMERIC | | Reserved (not yet computed) |
| `avg_elo_per_dollar` | NUMERIC | | Reserved (not yet computed) |
| `first_used_at` | TIMESTAMPTZ | NOT NULL, default `now()` | |
| `last_used_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Updated by `update_strategy_aggregates` |
| `is_test_content` | BOOLEAN | NOT NULL, default `false` | Populated by a BEFORE trigger calling `evolution_is_test_name(name)`. Replaces the admin UI's client-side `.not.in(<test strategy uuids>)` filter, which silently hit PostgREST URL length limits once staging accumulated ~1000 test strategies. Migration `20260415000001`. |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | |

> **Note:** `avg_final_elo` uses Welford's online algorithm via the `update_strategy_aggregates` RPC. The `stddev_final_elo` and `avg_elo_per_dollar` columns are reserved for future use.

> **Test-content filter:** the `evolution_is_test_name(text)` IMMUTABLE Postgres function matches exact lowercase `test`, bracketed `[TEST]`/`[E2E]`/`[TEST_EVO]` substrings, and the timestamp pattern `^.*-\d{10,13}-.*$`. It's called by a BEFORE INSERT/UPDATE-of-name trigger on `evolution_strategies` (since 20260415000001) and on `evolution_prompts` + `evolution_experiments` (since 20260423000001) that sets `is_test_content` via direct NEW mutation (no self-UPDATE, no recursion). The TS helper `isTestContentName` in `evolution/src/services/shared.ts` echoes this logic and is locked to the same fixture table via integration test for anti-drift protection. Admin UI filters via `applyTestContentColumnFilter` (`.eq('is_test_content', false)`) on tables that have the column directly, or via PostgREST embedded `!inner` join (`applyNonTestStrategyFilter`) on tables that join through `evolution_strategies` (e.g. `evolution_runs`).

### `evolution_prompts`

Prompt registry for evolution runs and arena topics. Renamed from `evolution_arena_topics` in 20260320.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `prompt` | TEXT | NOT NULL, UNIQUE (case-insensitive) | The prompt text |
| `name` | TEXT | NOT NULL, default `''` | Display name |
| `status` | TEXT | NOT NULL, CHECK `('active','archived')` | |
| `deleted_at` | TIMESTAMPTZ | | Soft delete timestamp |
| `archived_at` | TIMESTAMPTZ | | |
| `is_test_content` | BOOLEAN | NOT NULL, default `false` | Set by a BEFORE INSERT/UPDATE-OF-name trigger calling `evolution_is_test_name(name)`. Migration `20260423000001`. Backed by partial index `idx_evolution_prompts_non_test`. Used by `applyTestContentColumnFilter` for the prompts list and arena topics list. |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_experiments`

Groups multiple runs under a named experiment for batch execution.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `name` | TEXT | NOT NULL | |
| `prompt_id` | UUID | FK -> `evolution_prompts(id)` | Target prompt |
| `status` | TEXT | NOT NULL, CHECK `('draft','running','completed','cancelled','archived')` | |
| `config` | JSONB | | Optional experiment-level config |
| `evolution_explanation_id` | UUID | NOT NULL, FK -> `evolution_explanations(id)` | Seed article identity |
| `is_test_content` | BOOLEAN | NOT NULL, default `false` | Set by a BEFORE INSERT/UPDATE-OF-name trigger calling `evolution_is_test_name(name)`. Migration `20260423000001`. Backed by partial index `idx_evolution_experiments_non_test`. Used by `applyTestContentColumnFilter` for the experiments list. |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_runs`

Central table for pipeline executions. Each run belongs to exactly one strategy and optionally to an experiment.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `explanation_id` | BIGINT | FK -> `explanations(id)`, NULLABLE, ON DELETE SET NULL | Link to seed article in main app's `explanations` table |
| `prompt_id` | UUID | FK -> `evolution_prompts(id)` | |
| `experiment_id` | UUID | FK -> `evolution_experiments(id)` | NULL for standalone runs |
| `strategy_id` | UUID | NOT NULL, FK -> `evolution_strategies(id)` | Enforced NOT NULL since 20260318 |
| `budget_cap_usd` | NUMERIC(10,4) | default `1.00` | Per-run budget limit |
| `status` | TEXT | NOT NULL, CHECK `('pending','claimed','running','completed','failed','cancelled')` | See [Run Status Lifecycle](#run-status-lifecycle) |
| `pipeline_version` | TEXT | NOT NULL, default `'v2'` | |
| `runner_id` | TEXT | | ID of the claiming runner |
| `error_message` | TEXT | | Populated on failure |
| `run_summary` | JSONB | | V3 summary, see [Run Summary V3](#run-summary-v3) |
| `evolution_explanation_id` | UUID | NOT NULL, FK -> `evolution_explanations(id)` | Seed article identity |
| `last_heartbeat` | TIMESTAMPTZ | | Stale runner detection |
| `archived` | BOOLEAN | NOT NULL, default `false` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `completed_at` | TIMESTAMPTZ | | |

> **Note:** The inline `config` JSONB column was dropped in migration 20260318000002. Strategy config is now read exclusively from the `strategy_id` FK. `budget_cap_usd` was backfilled from the old config JSONB before the drop.

### `evolution_variants`

Text variants produced during a pipeline run. Since migration 20260321000002, this table also serves as the arena leaderboard (consolidating the former `evolution_arena_entries` table).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `run_id` | UUID | FK -> `evolution_runs(id)` ON DELETE CASCADE | |
| `explanation_id` | INT | | Legacy link |
| `variant_content` | TEXT | NOT NULL | The generated text |
| `elo_score` | NUMERIC | NOT NULL, default `1200` | Display Elo-scale score (projected from OpenSkill `mu`; matches the public `Rating.elo` up to display clamping) |
| `generation` | INT | NOT NULL, default `0` | Maps to `Variant.iterationBorn` — the iteration index (0-based) from `iterationConfigs[]` when this variant was created |
| `parent_variant_id` | UUID | | Self-referential FK. Populated for generated variants with the seed variant's ID. See [Lineage](#lineage) |
| `agent_name` | TEXT | | Creating agent tactic name (e.g. `'structural_transform'`, `'lexical_simplify'`) |
| `match_count` | INT | NOT NULL, default `0` | |
| `is_winner` | BOOLEAN | NOT NULL, default `false` | Highest `elo` at finalization |
| `mu` | NUMERIC | NOT NULL, default `25` | OpenSkill mu (legacy DB column; backs the public `Rating.elo` via `dbToRating` — unchanged because the stale trigger and `sync_to_arena` RPC depend on it). Now selected by `getEvolutionVariantsAction`, `listVariantsAction`, and `variantDetailActions` so the admin UI can render per-variant Elo ± uncertainty via `formatEloWithUncertainty` + `formatEloCIRange` (Phase 4b). |
| `sigma` | NUMERIC | NOT NULL, default `8.333` | OpenSkill sigma (legacy DB column; backs the public `Rating.uncertainty` via `dbToRating`). Selected by variant list/detail endpoints alongside `mu` for CI rendering (Phase 4b). |
| `prompt_id` | UUID | FK -> `evolution_prompts(id)` ON DELETE CASCADE | Arena prompt association |
| `synced_to_arena` | BOOLEAN | NOT NULL, default `false` | Whether this variant is visible in the arena |
| `arena_match_count` | INT | NOT NULL, default `0` | Number of arena comparison matches |
| `generation_method` | TEXT | NOT NULL, default `'pipeline'` | `'pipeline'`, `'manual'`, etc. |
| `model` | TEXT | | LLM model used |
| `cost_usd` | NUMERIC | | LLM cost for generating this variant |
| `archived_at` | TIMESTAMPTZ | | Soft archive for arena entries |
| `evolution_explanation_id` | UUID | FK -> `evolution_explanations(id)` | NULLABLE (oneshot entries have none) |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_tactics`

Thin entity table for tactic identity. Tactic prompt definitions live in code (`evolution/src/lib/core/tactics/generateTactics.ts`); this table provides UUIDs for metrics, admin UI, and future FK references. Synced from code via `evolution/scripts/syncSystemTactics.ts`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default `gen_random_uuid()` | |
| `name` | TEXT | NOT NULL, UNIQUE | Tactic identifier (e.g. `'structural_transform'`) |
| `label` | TEXT | NOT NULL, default `''` | Human-readable display label |
| `agent_type` | TEXT | NOT NULL | Agent group (e.g. `'generate_from_previous_article'`; renamed from `'generate_from_seed_article'` for backward compat) |
| `category` | TEXT | | Grouping: `'core'`, `'extended'`, `'depth'`, `'audience'`, `'structural'`, `'quality'`, `'meta'` |
| `is_predefined` | BOOLEAN | NOT NULL, default `true` | System-provided tactic |
| `status` | TEXT | NOT NULL, CHECK `('active','archived')` | |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | |

### `evolution_agent_invocations`

Per-agent-per-iteration cost and execution records. Primary source for cost tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `run_id` | UUID | NOT NULL, FK -> `evolution_runs(id)` ON DELETE CASCADE | |
| `agent_name` | TEXT | NOT NULL | e.g. `'generation'`, `'ranking'` |
| `iteration` | INT | NOT NULL, default `0` | |
| `execution_order` | INT | NOT NULL, default `0` | Order within iteration |
| `tactic` | TEXT | | Tactic name for generation invocations (e.g. `'structural_transform'`). NULL for ranking/merge agents. Indexed where non-null. |
| `success` | BOOLEAN | NOT NULL, default `false` | |
| `skipped` | BOOLEAN | NOT NULL, default `false` | |
| `cost_usd` | NUMERIC | | LLM cost for this invocation |
| `execution_detail` | JSONB | | Agent-specific detail (capped at 100KB) |
| `error_message` | TEXT | | |
| `duration_ms` | INT | | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_logs`

Structured log entries for pipeline debugging. Renamed from `evolution_run_logs` to support multi-entity logging across runs, experiments, strategies, and invocations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PK | Auto-increment for append performance |
| `entity_type` | TEXT | NOT NULL | `'run'`, `'invocation'`, `'experiment'`, `'strategy'` — which entity emitted this log |
| `entity_id` | UUID | NOT NULL | ID of the emitting entity |
| `run_id` | UUID | FK -> `evolution_runs(id)` ON DELETE CASCADE | Denormalized ancestor FK for run-level aggregation |
| `experiment_id` | UUID | FK -> `evolution_experiments(id)` | Denormalized ancestor FK for experiment-level aggregation |
| `strategy_id` | UUID | FK -> `evolution_strategies(id)` | Denormalized ancestor FK for strategy-level aggregation |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `level` | TEXT | NOT NULL, default `'info'` | `'info'`, `'warn'`, `'error'`, `'debug'` |
| `agent_name` | TEXT | | |
| `iteration` | INT | | |
| `variant_id` | TEXT | | |
| `message` | TEXT | NOT NULL | |
| `context` | JSONB | | Structured metadata |

The entity hierarchy enables aggregation queries without JOINs. For example, querying all logs for an experiment uses `WHERE experiment_id = ?` which returns logs from the experiment itself plus all its child runs and invocations, since each log row denormalizes its ancestor FKs at write time.

**Aggregation query patterns:**
- **Run logs**: `WHERE run_id = ?` — returns run-level logs + invocation logs within that run
- **Experiment logs**: `WHERE experiment_id = ?` — returns all logs across all runs in the experiment
- **Strategy logs**: `WHERE strategy_id = ?` — returns all logs across all runs using that strategy
- **Invocation logs**: `WHERE entity_type = 'invocation' AND entity_id = ?` — returns only that invocation's logs

### `evolution_arena_comparisons`

Pairwise comparison results between arena entries.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `prompt_id` | UUID | NOT NULL, FK -> `evolution_prompts(id)` ON DELETE CASCADE | |
| `entry_a` | UUID | NOT NULL | Variant ID (FK dropped in migration 20260409000001 — app-layer integrity via VariantEntity.ts) |
| `entry_b` | UUID | NOT NULL | Variant ID (FK dropped in migration 20260409000001 — app-layer integrity via VariantEntity.ts) |
| `winner` | TEXT | NOT NULL, CHECK `('a','b','draw')` | |
| `confidence` | NUMERIC | NOT NULL, default `0` | Judge confidence 0-1 |
| `run_id` | UUID | FK -> `evolution_runs(id)` ON DELETE SET NULL | |
| `status` | TEXT | NOT NULL, CHECK `('pending','completed','failed')` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_explanations`

Decoupled article identity table from the main app. Stores the seed text that started a run, whether sourced from an `explanations` row or generated from a prompt.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `explanation_id` | INT | FK -> `explanations(id)`, NULLABLE | NULL for prompt-based runs |
| `prompt_id` | UUID | FK -> `evolution_prompts(id)`, NULLABLE | NULL for explanation-based runs |
| `title` | TEXT | NOT NULL | |
| `content` | TEXT | NOT NULL | Seed text |
| `source` | TEXT | NOT NULL, CHECK `('explanation','prompt_seed')` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_metrics`

Unified EAV (entity-attribute-value) table for all evolution metrics. Replaces scattered metric storage across hardcoded columns, JSONB blobs, SQL VIEWs, and on-demand computation. Supports confidence intervals, lazy recomputation via stale flags, and parent-child metric propagation.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default `gen_random_uuid()` | |
| `entity_type` | TEXT | NOT NULL, CHECK `('run','invocation','variant','strategy','experiment','prompt','tactic')` | Type of entity this metric belongs to |
| `entity_id` | UUID | NOT NULL | FK to the entity's primary key |
| `metric_name` | TEXT | NOT NULL | e.g. `'cost'`, `'winner_elo'`, `'median_elo'`, `'agentCost:generation'` |
| `value` | DOUBLE PRECISION | NOT NULL | Metric value |
| `uncertainty` | DOUBLE PRECISION | | Elo-scale rating uncertainty from source variant (nullable; renamed from `sigma`) |
| `ci_lower` | DOUBLE PRECISION | | 95% CI lower bound (nullable) |
| `ci_upper` | DOUBLE PRECISION | | 95% CI upper bound (nullable) |
| `n` | INT | default `1` | Sample size / observation count |
| `origin_entity_type` | TEXT | | Entity type that produced this metric |
| `origin_entity_id` | UUID | | Specific source entity |
| `aggregation_method` | TEXT | | `'sum'`, `'avg'`, `'max'`, `'min'`, `'count'`, `'bootstrap_mean'`, `'bootstrap_percentile'`, or null (raw) |
| `source` | TEXT | | `'pipeline'`, `'finalization'`, `'bootstrap'`, `'manual'` |
| `stale` | BOOLEAN | default `false` | Lazy recompute flag |
| `created_at` | TIMESTAMPTZ | default `now()` | |
| `updated_at` | TIMESTAMPTZ | default `now()` | |

**Unique constraint:** `UNIQUE(entity_type, entity_id, metric_name)` — one row per metric per entity.

#### Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_metrics_entity` | `(entity_type, entity_id)` | Primary access: get all metrics for an entity |
| `idx_metrics_type_name` | `(entity_type, metric_name)` | Leaderboard/comparison queries across entities |
| `idx_metrics_origin` | `(origin_entity_type, origin_entity_id)` | Cascade staleness: find metrics derived from a source |
| `idx_metrics_stale` | `(stale) WHERE stale = true` | Partial index for recompute queue |

#### RLS Policies

Follows the existing evolution table pattern:

- **`service_role_all`** — full CRUD for `service_role` (server actions, pipeline worker)
- **`readonly_local`** — SELECT-only for `readonly_local` role (prod debugging)
- All other roles (`anon`, `authenticated`, `PUBLIC`) are revoked

#### Stale Flag Trigger

The `mark_elo_metrics_stale()` trigger fires when a variant's `mu` or `sigma` DB columns change on a completed run (these columns are unchanged; the TypeScript Rating abstraction sits above them). It cascades staleness:

1. Marks run-level elo metrics as stale (where `entity_type='run'` and `entity_id` matches the variant's `run_id`)
2. Marks strategy-level metrics as stale (via the run's `strategy_id`)
3. Marks experiment-level metrics as stale (via the run's `experiment_id`, if present)

This enables lazy recomputation: metrics are only recomputed when a server action reads them and detects `stale=true`.

### `evolution_cost_calibration`

Per-slice cost-calibration stats refreshed nightly from `evolution_agent_invocations.execution_detail`.
Replaces the hardcoded `EMPIRICAL_OUTPUT_CHARS` and `OUTPUT_TOKEN_ESTIMATES` constants when
`COST_CALIBRATION_ENABLED=true`; otherwise constants stay authoritative. See
[cost_optimization.md → Cost Calibration Table](./cost_optimization.md#cost-calibration-table-shadow-deploy-2026-04-14).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `strategy` | TEXT | NOT NULL, PK, default `'__unspecified__'` | Strategy label (sentinel when not applicable) |
| `generation_model` | TEXT | NOT NULL, PK, default `'__unspecified__'` | Generation LLM model |
| `judge_model` | TEXT | NOT NULL, PK, default `'__unspecified__'` | Judge LLM model |
| `phase` | TEXT | NOT NULL, PK, CHECK IN `('generation','ranking','seed_title','seed_article')` | Pipeline phase |
| `avg_output_chars` | NUMERIC | NOT NULL | Mean output chars for this slice |
| `avg_input_overhead_chars` | NUMERIC | NOT NULL | Mean input overhead beyond variable content |
| `avg_cost_per_call` | NUMERIC | NOT NULL | Mean USD cost per LLM call |
| `n_samples` | INT | NOT NULL CHECK ≥ 1 | Invocations contributing to this row |
| `last_refreshed_at` | TIMESTAMPTZ | NOT NULL, default `now()` | When the refresh script last wrote this row |

**Primary key:** `(strategy, generation_model, judge_model, phase)`.

Populated by `evolution/scripts/refreshCostCalibration.ts` (daily cron). RLS: deny-all +
`service_role_all` + conditional `readonly_local` SELECT (pattern matches other evolution
tables). Loader singleton lives in `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts`.

---

## Entity Relationships

For a visual diagram, see [`entities.md`](./entities.md) and [`entity_diagram.png`](./entity_diagram.png).

```
EXPERIMENT  ─── prompt_id ──────►  PROMPT (1:1)
EXPERIMENT  ─── experiment_id ──►  RUN    (1:N)
STRATEGY    ─── strategy_id ───►  RUN    (1:N, NOT NULL)
RUN         ─── prompt_id ──────►  PROMPT (N:1)
RUN         ─── run_id ────────►  VARIANT     (1:N, CASCADE)
RUN         ─── run_id ────────►  INVOCATION  (1:N, CASCADE)
RUN         ─── run_id ────────►  LOG         (1:N, CASCADE)
EXPERIMENT  ─── experiment_id ─►  LOG         (1:N, denormalized)
STRATEGY    ─── strategy_id ──►  LOG         (1:N, denormalized)
INVOCATION  ─── entity_id ────►  LOG         (1:N, via entity_type='invocation')
VARIANT     ─── parent_variant_id ► VARIANT  (self-ref, 0..1)
VARIANT     ─── prompt_id ──────►  PROMPT           (N:1, CASCADE)
VARIANT     ─── entry_a/b ─────►  ARENA_COMPARISON (1:N, CASCADE)
PROMPT      ─── prompt_id ──────►  ARENA_COMPARISON  (1:N, CASCADE)
METRICS     ─── entity_id ─────►  RUN/STRATEGY/EXPERIMENT/etc. (N:1, logical FK)
```

Key FK behaviors:
- **CASCADE deletes** on run children (variants, invocations, logs) — deleting a run cleans up all associated data.
- **CASCADE deletes** on arena comparisons from variants — deleting a variant removes its comparison history.
- **CASCADE deletes** on arena comparisons and variants from prompts — deleting a prompt removes its entire arena.

---

## RLS Policies

All evolution tables have RLS enabled with a **deny-all default**:

```sql
CREATE POLICY deny_all ON <table> FOR ALL USING (false) WITH CHECK (false);
```

Two additional policy layers:

1. **`service_role_all`** (20260321) — full CRUD bypass for `service_role`, used by the batch runner and E2E test seeds:
   ```sql
   CREATE POLICY service_role_all ON <table>
     FOR ALL TO service_role USING (true) WITH CHECK (true);
   ```

2. **`readonly_select`** (20260318) — SELECT-only access for `readonly_local` role, used by `npm run query:prod` / `npm run query:staging` for debugging. Skips gracefully when the role does not exist.

> **Warning:** The `deny_all` policy blocks `anon` and `authenticated` roles entirely. All evolution data access goes through `service_role` (server-side Supabase client). If you see empty query results in the browser, this is likely the cause.

---

## Key RPCs

All RPCs are `SECURITY DEFINER` with `search_path = public`, granted exclusively to `service_role`.

### `claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL)`

Atomically claims the oldest pending run using `FOR UPDATE SKIP LOCKED`. Returns the claimed run row. If `p_run_id` is provided, claims only that specific run.

```sql
-- Core locking pattern:
SELECT id FROM evolution_runs
WHERE status = 'pending'
  AND (p_run_id IS NULL OR id = p_run_id)
ORDER BY created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
```

### `update_strategy_aggregates(p_strategy_id UUID, p_cost_usd NUMERIC, p_final_elo NUMERIC)` *(deprecated)*

> **Deprecated:** Strategy aggregates are now computed by `propagateMetrics()` in TypeScript and stored in the `evolution_metrics` table. This RPC is retained for backward compatibility during the migration period but is no longer called by the pipeline.

Previously updated strategy aggregate metrics after run finalization using Welford's online algorithm.

### `sync_to_arena(p_prompt_id UUID, p_run_id UUID, p_entries JSONB, p_matches JSONB)`

Atomically upserts arena entries and inserts comparison records. Enforces size limits: max 200 entries, max 1000 matches per call. Uses `ON CONFLICT (id) DO UPDATE` for entry upserts. Migration `20260326000002_fix_sync_to_arena_match_count.sql` fixed the INSERT path to use `COALESCE((entry->>'arena_match_count')::INT, 0)` instead of hardcoded `0`, so `arena_match_count` is now properly persisted for entries that carry existing match history.

### `cancel_experiment(p_experiment_id UUID)`

Cancels an experiment and fails all its pending/claimed/running runs in a single transaction.

### `mark_elo_metrics_stale()` *(trigger function)*

Fired by a trigger on `evolution_variants` when the `mu` or `sigma` DB columns change on a variant belonging to a completed run (the public `Rating` abstraction sits above these columns — they remain as the trigger's anchor). Cascades staleness to run, strategy, and experiment metrics in `evolution_metrics` by setting `stale=true`. This enables lazy recomputation — metrics are only recomputed when read by a server action.

### `lock_stale_metrics(p_entity_type TEXT, p_entity_id UUID)`

Atomic claim-and-clear for stale metric recomputation. In a single statement, UPDATEs `stale=false` on matching rows and RETURNs the claimed rows. This ensures exactly one concurrent caller processes each stale batch — no advisory locks or `SELECT FOR UPDATE SKIP LOCKED` needed. If recomputation fails, the caller's catch block re-marks the rows `stale=true` so they are retried on the next read.

```sql
-- Atomic claim-and-clear pattern:
UPDATE evolution_metrics
SET stale = false, updated_at = now()
WHERE entity_type = p_entity_type
  AND entity_id = p_entity_id
  AND stale = true
RETURNING *;
```

### `get_run_total_cost(p_run_id UUID)`

Returns the sum of `cost_usd` from `evolution_agent_invocations` for a given run. There is also a companion view `evolution_run_costs` for batch queries on list pages.

> **Note:** Run cost is also available as a metric row in `evolution_metrics` with `entity_type='run'` and `metric_name='cost'`. The metrics table version is updated incrementally during execution and is the preferred source for new code.

---

## Run Status Lifecycle

```
pending ──► claimed ──► running ──► completed
                │           │
                │           ├──► failed
                │           │
                │           └──► cancelled
                │
                └──► failed (claim timeout)
```

- **pending**: Created by the admin UI or experiment runner. Waiting for a runner to claim.
- **claimed**: Atomically locked via `claim_evolution_run()`. `runner_id` and `last_heartbeat` are set.
- **running**: Pipeline execution in progress. Heartbeat updates detect stale runners.
- **completed**: Pipeline finished successfully. `run_summary` and `completed_at` populated.
- **failed**: Error during execution or stale heartbeat timeout. `error_message` populated.
- **cancelled**: Cancelled via `cancel_experiment()` or manual intervention.

---

## Cost Tracking

Cost flows through three layers:

1. **In-memory**: `V2CostTracker` (`evolution/src/lib/pipeline/infra/trackBudget.ts`) uses a reserve-before-spend pattern with a 1.3x safety margin. Reservations are synchronous to maintain parallel safety under the Node.js event loop.

2. **Per-invocation**: Each agent invocation writes its `cost_usd` to `evolution_agent_invocations`. This is the source of truth for cost attribution.

3. **Aggregation**:
   - `get_run_total_cost(p_run_id)` — RPC for single-run cost (retained but no longer used by the UI)
   - `evolution_run_costs` — view for batch list pages (`SELECT run_id, SUM(cost_usd)`) (retained but no longer used by the UI)
   - Run list view and detail page now query `evolution_agent_invocations` directly for cost display
   - Budget events table was dropped in V2; audit trail is now in-memory only

```typescript
// From evolution/src/lib/pipeline/infra/trackBudget.ts
export function createCostTracker(budgetUsd: number): V2CostTracker {
  // reserve() is synchronous — no awaits — for parallel safety
  reserve(phase: string, estimatedCost: number): number;
  recordSpend(phase: string, actualCost: number, reservedAmount: number): void;
  release(phase: string, reservedAmount: number): void;
}
```

The `BudgetEventLogger` type in `evolution/src/lib/types.ts` defines the event shape for in-memory budget tracking (the `evolution_budget_events` table was dropped during V2).

---

## Lineage

Variants track parentage differently in memory vs. the database:

- **In-memory** (`Variant`): `parentIds: string[]` — supports multiple parents (e.g., crossover between two variants).
- **Database** (`evolution_variants`): `parent_variant_id: UUID` — single nullable FK.

> **Warning:** Second parent is silently dropped at finalize. Only `parentIds[0]` is persisted to the database. See `finalizeRun()` in `evolution/src/lib/pipeline/finalize.ts`:
> ```typescript
> parent_variant_id: v.parentIds[0] ?? null,
> ```
> This means crossover lineage information (the second parent) is lost once a run is finalized.

The `generation` column maps to `Variant.iterationBorn` (the iteration index from `iterationConfigs[]` when the variant was created), and `agent_name` maps to `Variant.strategy`. Generated variants have `parentIds` set to `[seedVariantId]` in memory, and `parent_variant_id` is populated with the seed variant's UUID at finalization.

---

## Type Hierarchy

DB entity types are now generated from Zod schemas in `evolution/src/lib/schemas.ts` via `z.infer<>`. Each table has an `InsertSchema` (client-supplied fields with defaults) and a `FullDbSchema` (extends InsertSchema with server-generated fields like `id` and `created_at`). Internal pipeline types (`Variant`, `Critique`, `MetaFeedback`, `V2Match`, etc.) are also Zod-derived.

### `Variant`

The in-memory representation of a variant during pipeline execution. Defined in `evolution/src/lib/types.ts`:

```typescript
export interface Variant {
  id: string;
  text: string;
  version: number;
  parentIds: string[];
  strategy: string;
  createdAt: number;
  iterationBorn: number;
  costUsd?: number;
  fromArena?: boolean;
}
```

### `Rating`

Public rating type `{elo, uncertainty}` (both Elo-scale). See [Rating System](./rating_and_comparison.md) for the full rating model. The `elo_score` column in `evolution_variants` is a display-clamped version of `Rating.elo`. Arena ratings are persisted via the legacy `mu`/`sigma` DB columns on `evolution_variants`; the application layer translates via `dbToRating` / `ratingToDb` at the boundary.

### `agentExecutionDetailSchema` — `reflect_and_generate_from_previous_article` variant

A discriminated-union variant on `agentExecutionDetailSchema` for the
`ReflectAndGenerateFromPreviousArticleAgent` (Shape A: top-level enum value alongside
`generate` and `swiss`). Defined in `evolution/src/lib/schemas.ts` as
`reflectAndGenerateFromPreviousArticleExecutionDetailSchema`. Shape:

| Field | Type | Description |
|-------|------|-------------|
| `detailType` | literal `'reflect_and_generate_from_previous_article'` | Discriminator |
| `variantId` | string \| null | Variant produced (when surfaced) |
| `tactic` | string | Chosen tactic (denormalized from `reflection.tacticChosen` for SQL filters) |
| `reflection` | object (optional) | `{ candidatesPresented: string[]; tacticRanking: { tactic, reasoning }[]; tacticChosen: string; rawResponse?, parseError?; durationMs?; cost? }` |
| `generation` | object (optional) | Same shape as GFPA `generation` (cost / promptLength / textLength / formatValid / durationMs) |
| `ranking` | object (optional, nullable) | Same shape as GFPA `ranking` |
| `totalCost` | number (optional) | `reflection.cost + GFPA totalCost`, recomputed by the wrapper merge step |
| `surfaced` | boolean | Whether the variant survived the local-Elo cutoff |
| `discardReason` | object (optional) | `{ localElo, localTop15Cutoff }` when not surfaced |

Sub-objects are individually optional so partial-failure rows still validate (e.g.
reflection succeeds but generation throws → only `reflection` is populated). The
wrapper-error path relies on `trackInvocations.updateInvocation`'s partial-update
semantics to preserve the partially-written `execution_detail` when the catch handler
later writes only `cost_usd` / `success` / `error_message`.

### Run Summary V3

The `run_summary` JSONB column on `evolution_runs` stores an `EvolutionRunSummary` object. Current version is V3 with Elo-based fields:

```typescript
export interface EvolutionRunSummary {
  version: 3;
  stopReason: string;
  finalPhase: PipelinePhase;
  totalIterations: number;
  durationSeconds: number;
  eloHistory: number[];
  diversityHistory: number[];
  matchStats: { totalMatches: number; avgConfidence: number; decisiveRate: number };
  topVariants: Array<{ id: string; strategy: string; elo: number; isSeedVariant: boolean }>;
  seedVariantRank: number | null;
  seedVariantElo: number | null;
  strategyEffectiveness: Record<string, { count: number; avgElo: number }>;
  metaFeedback: { successfulStrategies; recurringWeaknesses; patternsToAvoid; priorityImprovements } | null;
  actionCounts?: Record<string, number>;
}
```

**Auto-migration on read**: The `EvolutionRunSummarySchema` is a Zod discriminated union that transforms legacy formats to V3:
- Legacy summaries written with `muHistory` / `baselineMu` / `avgMu` OpenSkill-scale fields are projected to the current Elo-scale `eloHistory` / `seedVariantElo` / `avgElo` shape on read.
- 2026-04-14: legacy V3 rows with `baselineRank` / `baselineElo` / `topVariants[].isBaseline` are auto-mapped to `seedVariantRank` / `seedVariantElo` / `isSeedVariant`. New writes emit only the new names.
- Earlier ordinal-based shapes are likewise migrated forward.
- **V3** passes through directly

This means database rows written by older pipeline versions are transparently upgraded when read by TypeScript code. No backfill migration needed.

---

## Schema Evolution Timeline

| Migration | Date | Description |
|-----------|------|-------------|
| `20260306000001_evolution_budget_events.sql` | 2026-03-06 | Budget event audit log table |
| `20260314000002_create_evolution_explanations.sql` | 2026-03-14 | `evolution_explanations` table + FK columns on runs/experiments/arena_entries |
| `20260315000001_evolution_v2.sql` | 2026-03-15 | **Clean-slate V2**: dropped all V1 objects, created 10 fresh tables with deny-all RLS and 4 RPCs |
| `20260318000001_evolution_readonly_select_policy.sql` | 2026-03-18 | `readonly_local` SELECT policies on all tables |
| `20260318000002_config_into_db.sql` | 2026-03-18 | Backfilled `budget_cap_usd`, enforced `strategy_id NOT NULL`, dropped `config` JSONB from runs |
| `20260319000001_evolution_run_cost_helpers.sql` | 2026-03-19 | `get_run_total_cost()` function + `evolution_run_costs` view + covering index |
| `20260320000001_rename_evolution_tables.sql` | 2026-03-20 | Renamed `strategy_configs` -> `strategies`, `arena_topics` -> `prompts`, FK column renames, dropped `evolution_arena_batch_runs` |
| `20260321000001_evolution_service_role_rls.sql` | 2026-03-21 | Explicit `service_role_all` RLS bypass on all tables |
| `20260321000002_consolidate_arena_entries.sql` | 2026-03-21 | Consolidated `evolution_arena_entries` into `evolution_variants` (added arena columns, migrated data, dropped `evolution_arena_entries`) |
| `20260322000001_fresh_schema_docs.sql` | 2026-03-22 | Fresh schema documentation migration |
| `20260322000002_prod_convergence.sql` | 2026-03-22 | Prod convergence migration |
| `20260415000001_evolution_is_test_content.sql` | 2026-04-15 | `evolution_strategies.is_test_content` column + `evolution_is_test_name(text)` function + BEFORE INSERT/UPDATE-OF-name trigger + partial index |
| `20260423000001_add_is_test_content_to_prompts_experiments.sql` | 2026-04-23 | Same `is_test_content` column + trigger + partial index pattern extended to `evolution_prompts` and `evolution_experiments`. Closes B17 (test rows leaked into prompts list, arena topics list, and start-experiment wizard pickers because `applyTestContentNameFilter` was substring-only and missed the timestamp regex). |

The V2 clean-slate migration (20260315) intentionally dropped all V1 tables, views, and functions. There is no backward migration path to V1.

### Historic-run Zod tolerance (2026-04-23)

Phase 1 of the `scan_codebase_for_bugs_20260422` project tightened Zod refinements on several numeric fields to reject `NaN` / `Infinity` / negative-refund values:

- `ratingSchema.elo` and `ratingSchema.uncertainty` — `.refine(Number.isFinite)`
- `evolution_variants.mu` / `sigma` / `elo_score` — `.refine(Number.isFinite)`
- `evolution_budget_events.amount_usd` — `.min(0).refine(Number.isFinite)`
- `evolution_budget_events.available_budget_usd` — `.refine(Number.isFinite)`
- `evolution_variants.generation_method` — `.min(1)` when non-null
- `evolution_run.error_message` and `evolution_agent_invocation.error_message` — `.max(10000)`

The app-layer read paths that consume these schemas all route through `.parse()` / `.safeParse()` with established `.safeParse() → log-and-skip` patterns in the metrics recompute + finalization code, so historic rows containing `NaN`/`Infinity` surface as log warnings rather than crashing callers. If you see a spike in Zod parse warnings after this migration, the staging/prod DB has a small number of legacy bad rows that should be surfaced via the admin UI's metric-error tab.

---

## Key Indexes

Notable indexes beyond standard FK indexes:

| Index | Table | Purpose |
|-------|-------|---------|
| `idx_runs_pending_claim` | runs | Partial index on `status='pending'` for `claim_evolution_run` |
| `idx_runs_heartbeat_stale` | runs | Partial index on `status='running'` for stale detection |
| `idx_variants_winner` | variants | Partial index on `is_winner=true` |
| `idx_variants_arena_active` | variants | Partial index on `synced_to_arena=true` excluding archived variants |
| `idx_invocations_run_cost` | agent_invocations | Covering index `(run_id, cost_usd)` for cost aggregation |
| `uq_arena_topic_prompt` | prompts | Case-insensitive unique on `lower(prompt)` |

For the full index list, see `supabase/migrations/20260315000001_evolution_v2.sql`.

---

## Generated Types

The file `src/lib/database.types.ts` contains auto-generated TypeScript types from the Supabase database schema. These types are used by all Supabase client instances via the `Database` generic parameter, providing compile-time type safety for all `.from()` queries.

### Type Coexistence

| Layer | File | Purpose |
|-------|------|---------|
| **DB query typing** | `src/lib/database.types.ts` (auto-generated) | Types `.from()` return values, catches column renames at compile time |
| **Runtime validation** | `evolution/src/lib/schemas.ts` (manual Zod) | Validates data at runtime, transforms versions (V1→V3), enforces business constraints |
| **Domain types** | `evolution/src/lib/types.ts` (manual) | In-memory pipeline types (Variant, Rating, ExecutionContext) |

### Regeneration

- **Local**: `npm run db:types` (requires `SUPABASE_ACCESS_TOKEN`)
- **CI**: Auto-generated on every PR push — the `generate-types` job regenerates and auto-commits if changed
- **Merge conflicts**: `.gitattributes` auto-resolves in favor of incoming version

---

## `parent_variant_id` as the predecessor pointer (Phase 2+)

Every variant carries a `parent_variant_id UUID NULL` column referencing another row in `evolution_variants` (self-FK is not currently declared in the generated types but is conventionally relied upon). Populated by:

- `GenerateFromPreviousArticleAgent` (agent type `generate_from_previous_article`; renamed from `generate_from_seed_article` for backward compat): set to the agent's input parent — either the seed variant or a pool-drawn variant, per the iteration's `sourceMode`.
- `CreateSeedArticleAgent`: `NULL` (root of the lineage chain).

The single-pointer design means lineage is a tree (not a DAG). In-memory `Variant.parentIds` is an array for future multi-parent agents, but today only index 0 is persisted.

## `agent_invocation_id` (Phase 5)

Column added by `20260418000003_variants_add_agent_invocation_id.sql`:

```sql
ALTER TABLE evolution_variants
  ADD COLUMN agent_invocation_id UUID
  REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL;
```

Threads each surfaced/discarded variant back to the agent invocation that produced it. Used by `experimentMetrics.computeEloAttributionMetrics` to group variants by `(agent_name, dimension)` for ELO-delta attribution. Historic rows have `NULL` here — no backfill per plan — and are naturally excluded from attribution aggregation.

## Lineage chain walk

The Postgres RPC `get_variant_full_chain(variant_id UUID)` (migration `20260418000002_variants_get_full_chain_rpc.sql`) walks `parent_variant_id` up to the root. Uses `WITH RECURSIVE` + array-path cycle detection + 20-hop cap (matches `iterationConfigs.max`). Returns rows ordered root-first.

An index on `evolution_variants(parent_variant_id)` (migration `20260418000001`) keeps the walk fast.
