# Data Model

The evolution pipeline persists all state in Supabase (Postgres). This document covers the V2 schema (post-20260315 clean-slate migration), entity relationships, RPC functions, RLS policies, type definitions, and schema evolution history.

For how these tables are used at runtime, see [Architecture](./architecture.md). For the rating columns (mu, sigma, elo_rating), see [Rating System](./rating_and_comparison.md).

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
| `config` | JSONB | NOT NULL | Full strategy configuration |
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
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | |

> **Note:** `avg_final_elo` uses Welford's online algorithm via the `update_strategy_aggregates` RPC. The `stddev_final_elo` and `avg_elo_per_dollar` columns are reserved for future use.

### `evolution_prompts`

Prompt registry for evolution runs and arena topics. Renamed from `evolution_arena_topics` in 20260320.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `prompt` | TEXT | NOT NULL, UNIQUE (case-insensitive) | The prompt text |
| `title` | TEXT | NOT NULL, default `''` | Display title |
| `status` | TEXT | NOT NULL, CHECK `('active','archived')` | |
| `deleted_at` | TIMESTAMPTZ | | Soft delete timestamp |
| `archived_at` | TIMESTAMPTZ | | |
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
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_runs`

Central table for pipeline executions. Each run belongs to exactly one strategy and optionally to an experiment.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `explanation_id` | INT | | Legacy FK to `explanations` table |
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

Text variants produced during a pipeline run. Also serves as the arena leaderboard when `synced_to_arena = true` (the `evolution_arena_entries` table was dropped; arena data now lives here).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `run_id` | UUID | FK -> `evolution_runs(id)` ON DELETE CASCADE | |
| `explanation_id` | INT | | Legacy link |
| `prompt_id` | UUID | FK -> `evolution_prompts(id)` | Set for prompt-based runs |
| `variant_content` | TEXT | NOT NULL | The generated text |
| `elo_score` | NUMERIC | NOT NULL, default `1200` | Elo-scale score (converted from TrueSkill mu) |
| `mu` | NUMERIC | NOT NULL, default `25` | TrueSkill mu |
| `sigma` | NUMERIC | NOT NULL, default `8.333` | TrueSkill sigma (uncertainty) |
| `generation` | INT | NOT NULL, default `0` | Iteration when created |
| `parent_variant_id` | UUID | | Self-referential FK, see [Lineage](#lineage) |
| `agent_name` | TEXT | | Creating agent/strategy name |
| `match_count` | INT | NOT NULL, default `0` | |
| `is_winner` | BOOLEAN | NOT NULL, default `false` | Highest mu at finalization |
| `synced_to_arena` | BOOLEAN | NOT NULL, default `false` | True for variants promoted to the arena leaderboard |
| `arena_match_count` | INT | NOT NULL, default `0` | Arena-level match count (separate from per-run match_count) |
| `generation_method` | TEXT | NOT NULL, default `'pipeline'` | `'pipeline'`, `'manual'`, etc. |
| `model` | TEXT | | LLM model used |
| `cost_usd` | NUMERIC | | Generation cost |
| `evolution_explanation_id` | UUID | FK -> `evolution_explanations(id)` | Seed article identity |
| `archived_at` | TIMESTAMPTZ | | Soft archive |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_agent_invocations`

Per-agent-per-iteration cost and execution records. Primary source for cost tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `run_id` | UUID | NOT NULL, FK -> `evolution_runs(id)` ON DELETE CASCADE | |
| `agent_name` | TEXT | NOT NULL | e.g. `'generation'`, `'ranking'` |
| `iteration` | INT | NOT NULL, default `0` | |
| `execution_order` | INT | NOT NULL, default `0` | Order within iteration |
| `success` | BOOLEAN | NOT NULL, default `false` | |
| `skipped` | BOOLEAN | NOT NULL, default `false` | |
| `cost_usd` | NUMERIC | | LLM cost for this invocation |
| `execution_detail` | JSONB | | Agent-specific detail (capped at 100KB) |
| `error_message` | TEXT | | |
| `duration_ms` | INT | | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_run_logs`

Structured log entries for pipeline debugging.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | PK | Auto-increment for append performance |
| `run_id` | UUID | NOT NULL, FK -> `evolution_runs(id)` ON DELETE CASCADE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `level` | TEXT | NOT NULL, default `'info'` | `'info'`, `'warn'`, `'error'`, `'debug'` |
| `agent_name` | TEXT | | |
| `iteration` | INT | | |
| `variant_id` | TEXT | | |
| `message` | TEXT | NOT NULL | |
| `context` | JSONB | | Structured metadata |

### `evolution_arena_comparisons`

Pairwise comparison results between arena entries.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK | |
| `prompt_id` | UUID | NOT NULL, FK -> `evolution_prompts(id)` ON DELETE CASCADE | |
| `entry_a` | UUID | NOT NULL, FK -> `evolution_variants(id)` ON DELETE CASCADE | |
| `entry_b` | UUID | NOT NULL, FK -> `evolution_variants(id)` ON DELETE CASCADE | |
| `winner` | TEXT | NOT NULL, CHECK `('a','b','draw')` | |
| `confidence` | NUMERIC | NOT NULL, default `0` | Judge confidence 0-1 |
| `run_id` | UUID | FK -> `evolution_runs(id)` ON DELETE SET NULL | |
| `status` | TEXT | NOT NULL, CHECK `('pending','completed','failed')` | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

### `evolution_budget_events`

Audit log for budget reserve/spend/release operations. Created in a separate migration (20260306).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGINT | PK, GENERATED ALWAYS AS IDENTITY | |
| `run_id` | UUID | NOT NULL, FK -> `evolution_runs(id)` ON DELETE CASCADE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `event_type` | TEXT | NOT NULL, CHECK `('reserve','spend','release_ok','release_failed')` | |
| `agent_name` | TEXT | NOT NULL | |
| `amount_usd` | NUMERIC(10,6) | NOT NULL | |
| `total_spent_usd` | NUMERIC(10,6) | NOT NULL | Running total at event time |
| `total_reserved_usd` | NUMERIC(10,6) | NOT NULL | |
| `available_budget_usd` | NUMERIC(10,6) | NOT NULL | |
| `invocation_id` | UUID | | Link to agent invocation |
| `iteration` | INTEGER | | |
| `metadata` | JSONB | default `'{}'` | |

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

---

## Entity Relationships

For a visual diagram, see [`entity_diagram.md`](./entity_diagram.md) and [`entity_diagram.png`](./entity_diagram.png).

```
EXPERIMENT  ─── prompt_id ──────►  PROMPT (1:1)
EXPERIMENT  ─── experiment_id ──►  RUN    (1:N)
STRATEGY    ─── strategy_id ───►  RUN    (1:N, NOT NULL)
RUN         ─── prompt_id ──────►  PROMPT (N:1)
RUN         ─── run_id ────────►  VARIANT     (1:N, CASCADE)
RUN         ─── run_id ────────►  INVOCATION  (1:N, CASCADE)
RUN         ─── run_id ────────►  LOG         (1:N, CASCADE)
RUN         ─── run_id ────────►  BUDGET_EVENT (1:N, CASCADE)
VARIANT     ─── parent_variant_id ► VARIANT  (self-ref, 0..1)
VARIANT     ─── synced_to_arena ──► (boolean flag; arena entries are variants with synced_to_arena=true)
PROMPT      ─── prompt_id ──────►  ARENA_COMPARISON  (1:N, CASCADE)
```

Key FK behaviors:
- **CASCADE deletes** on run children (variants, invocations, logs, budget events) — deleting a run cleans up all associated data.
- **CASCADE deletes** on arena comparisons from prompts — deleting a prompt removes its arena comparisons.

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

2. **`readonly_select`** (20260318) — SELECT-only access for `readonly_local` role, used by `npm run query:prod` for debugging. Skips gracefully when the role does not exist.

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

### `update_strategy_aggregates(p_strategy_id UUID, p_cost_usd NUMERIC, p_final_elo NUMERIC)`

Updates strategy aggregate metrics after run finalization. Uses Welford's online algorithm for `avg_final_elo` and `GREATEST`/`LEAST` for best/worst tracking. Called from `finalizeRun()` in `evolution/src/lib/pipeline/finalize.ts`.

### `sync_to_arena(p_prompt_id UUID, p_run_id UUID, p_entries JSONB, p_matches JSONB)`

Atomically upserts variants into `evolution_variants` (setting `synced_to_arena = true`) and inserts comparison records into `evolution_arena_comparisons`. Enforces size limits: max 200 entries, max 1000 matches per call. Uses `ON CONFLICT (id) DO UPDATE` for entry upserts.

### `cancel_experiment(p_experiment_id UUID)`

Cancels an experiment and fails all its pending/claimed/running runs in a single transaction.

### `get_run_total_cost(p_run_id UUID)`

Returns the sum of `cost_usd` from `evolution_agent_invocations` for a given run. There is also a companion view `evolution_run_costs` for batch queries on list pages.

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

1. **In-memory**: `V2CostTracker` (`evolution/src/lib/pipeline/cost-tracker.ts`) uses a reserve-before-spend pattern with a 1.3x safety margin. Reservations are synchronous to maintain parallel safety under the Node.js event loop.

2. **Per-invocation**: Each agent invocation writes its `cost_usd` to `evolution_agent_invocations`. This is the source of truth for cost attribution.

3. **Aggregation**:
   - `get_run_total_cost(p_run_id)` — RPC for single-run cost
   - `evolution_run_costs` — view for batch list pages (`SELECT run_id, SUM(cost_usd)`)
   - `evolution_budget_events` — full audit trail of reserve/spend/release events

```typescript
// From evolution/src/lib/pipeline/cost-tracker.ts
export function createCostTracker(budgetUsd: number): V2CostTracker {
  // reserve() is synchronous — no awaits — for parallel safety
  reserve(phase: string, estimatedCost: number): number;
  recordSpend(phase: string, actualCost: number, reservedAmount: number): void;
  release(phase: string, reservedAmount: number): void;
}
```

The `BudgetEventLogger` type in `evolution/src/lib/types.ts` defines the event shape written to `evolution_budget_events`.

---

## Lineage

Variants track parentage differently in memory vs. the database:

- **In-memory** (`TextVariation`): `parentIds: string[]` — supports multiple parents (e.g., crossover between two variants).
- **Database** (`evolution_variants`): `parent_variant_id: UUID` — single nullable FK.

> **Warning:** Second parent is silently dropped at finalize. Only `parentIds[0]` is persisted to the database. See `finalizeRun()` in `evolution/src/lib/pipeline/finalize.ts`:
> ```typescript
> parent_variant_id: v.parentIds[0] ?? null,
> ```
> This means crossover lineage information (the second parent) is lost once a run is finalized.

The `generation` column maps to `TextVariation.version` (the iteration when the variant was born), and `agent_name` maps to `TextVariation.strategy`.

---

## Type Hierarchy

### `TextVariation`

The in-memory representation of a variant during pipeline execution. Defined in `evolution/src/lib/types.ts`:

```typescript
export interface TextVariation {
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

TrueSkill rating pair (`mu`, `sigma`). See [Rating System](./rating_and_comparison.md) for the full rating model. The `elo_score` column in `evolution_variants` is an Elo-scale conversion via `toEloScale(mu)`.

### Run Summary V3

The `run_summary` JSONB column on `evolution_runs` stores an `EvolutionRunSummary` object. Current version is V3 with mu-based fields:

```typescript
export interface EvolutionRunSummary {
  version: 3;
  stopReason: string;
  finalPhase: PipelinePhase;
  totalIterations: number;
  durationSeconds: number;
  muHistory: number[];
  diversityHistory: number[];
  matchStats: { totalMatches: number; avgConfidence: number; decisiveRate: number };
  topVariants: Array<{ id: string; strategy: string; mu: number; isBaseline: boolean }>;
  baselineRank: number | null;
  baselineMu: number | null;
  strategyEffectiveness: Record<string, { count: number; avgMu: number }>;
  metaFeedback: { successfulStrategies; recurringWeaknesses; patternsToAvoid; priorityImprovements } | null;
  actionCounts?: Record<string, number>;
}
```

**Auto-migration on read**: The `EvolutionRunSummarySchema` is a Zod discriminated union that transforms legacy formats to V3:
- **V1** (Elo fields: `eloHistory`, `baselineElo`, `avgElo`) -> V3 via `elo + 3 * defaultSigma`
- **V2** (ordinal fields: `ordinalHistory`, `baselineOrdinal`, `avgOrdinal`) -> V3 via `ordinal + 3 * defaultSigma`
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

The V2 clean-slate migration (20260315) intentionally dropped all V1 tables, views, and functions. There is no backward migration path to V1.

---

## Key Indexes

Notable indexes beyond standard FK indexes:

| Index | Table | Purpose |
|-------|-------|---------|
| `idx_runs_pending_claim` | runs | Partial index on `status='pending'` for `claim_evolution_run` |
| `idx_runs_heartbeat_stale` | runs | Partial index on `status='running'` for stale detection |
| `idx_variants_winner` | variants | Partial index on `is_winner=true` |
| `idx_variants_arena_active` | variants | Partial index on `synced_to_arena=true` excluding archived |
| `idx_invocations_run_cost` | agent_invocations | Covering index `(run_id, cost_usd)` for cost aggregation |
| `uq_arena_topic_prompt` | prompts | Case-insensitive unique on `lower(prompt)` |

For the full index list, see `supabase/migrations/20260315000001_evolution_v2.sql`.
