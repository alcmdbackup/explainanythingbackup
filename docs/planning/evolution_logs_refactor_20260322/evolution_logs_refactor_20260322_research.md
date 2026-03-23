# Evolution Logs Refactor Research

## Problem Statement
Refactor the evolution logging system so that different entities (agent invocations, runs, experiments, strategies) can produce logs. Logs should aggregate upward through the entity hierarchy, so viewing logs for a run includes logs from its agent invocations, and viewing experiment logs includes all run and invocation logs. A standardized UI component will display logs for any entity along with all contained sub-entities.

## Requirements (from GH Issue #NNN)
- Different entities can produce logs - agent invocations, runs, experiments, strategies
- Logs are aggregated up - e.g. agent invocations can be displayed on containing runs and experiments and strategies
- There is a standardized UI component that displays logs for the corresponding entity as well as all contained things. E.g. on run "log" tab in evolution admin UI, you can see logs for that run, all contained agent invocations, etc

## High Level Summary

The current logging system is **run-only** — `createRunLogger()` writes to `evolution_run_logs` with `run_id` as the sole entity FK. There are ~12 log call sites producing ~50 logs/run. The existing `LogsPanel` component on the run detail page is a simple table with no filtering UI. No other detail pages (experiments, strategies, invocations) have log tabs.

**Key design decision:** Rather than creating separate log tables per entity, we can add denormalized `experiment_id` and `strategy_id` columns to the existing `evolution_run_logs` table, populated at write time from the `ClaimedRun` context. This allows direct queries by any entity without joins, following the same pattern as the `evolution_run_costs` view.

**Entity hierarchy:** Strategy (1) → Run (N) ← Experiment (1, optional). Runs always have `strategy_id` (NOT NULL) and optionally `experiment_id`. Agent invocations are children of runs via `run_id` FK.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Evolution Docs
- evolution/docs/evolution/data_model.md — Full V2 schema: 9 tables, entity relationships, RLS, RPCs
- evolution/docs/evolution/architecture.md — V2 pipeline: entry points, 3-op loop, cost tracking, finalization
- evolution/docs/evolution/visualization.md — 15 admin pages, server action architecture, shared components

## Code Files Read

### Pipeline Infrastructure
- `evolution/src/lib/pipeline/infra/createRunLogger.ts` — RunLogger factory, fire-and-forget inserts to evolution_run_logs
- `evolution/src/lib/pipeline/infra/trackInvocations.ts` — createInvocation/updateInvocation for evolution_agent_invocations
- `evolution/src/lib/pipeline/infra/trackBudget.ts` — V2CostTracker with reserve-before-spend pattern
- `evolution/src/lib/pipeline/infra/types.ts` — EvolutionConfig, EvolutionResult types
- `evolution/src/lib/pipeline/index.ts` — Barrel exports: createRunLogger, RunLogger, createInvocation, updateInvocation

### Pipeline Execution
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — Entry point, creates ClaimedRun with experiment_id/strategy_id
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — Builds RunContext, creates logger at line 157 using only runId
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — Main loop, creates invocations per phase, logger used throughout
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — Finalization logging, strategy/experiment aggregation

### Server Actions (Services)
- `evolution/src/services/evolutionActions.ts` — getEvolutionRunLogsAction (lines 365-394), RunLogEntry/RunLogFilters types
- `evolution/src/services/experimentActionsV2.ts` — Experiment CRUD, getExperimentAction with runs join
- `evolution/src/services/strategyRegistryActionsV2.ts` — Strategy CRUD, run count queries
- `evolution/src/services/invocationActions.ts` — Invocation list/detail queries
- `evolution/src/services/adminAction.ts` — adminAction factory with auth, supabase client, error handling
- `evolution/src/services/shared.ts` — ActionResult<T> type

### Admin UI Pages
- `src/app/admin/evolution/runs/[runId]/page.tsx` — Run detail with LogsPanel (lines 34-84), 5 tabs
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailContent.tsx` — 3 tabs (overview, analysis, runs), no logs
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx` — No tabs, static layout
- `src/app/admin/evolution/invocations/[invocationId]/page.tsx` — No tabs, static layout

### Shared Components
- `evolution/src/components/evolution/EntityDetailTabs.tsx` — Tab container with URL sync
- `evolution/src/components/evolution/EntityDetailPageClient.tsx` — Config-driven detail page wrapper
- `evolution/src/components/evolution/EntityListPage.tsx` — List page with FilterDef[], pagination
- `evolution/src/components/evolution/EntityTable.tsx` — Generic sortable table
- `evolution/src/components/evolution/tabs/` — MetricsTab, EloTab, LineageTab, VariantsTab, RelatedRunsTab

### Database
- `supabase/migrations/20260322000006_evolution_fresh_schema.sql` — Full V2 DDL including evolution_run_logs
- `supabase/migrations/20260322000007_evolution_prod_convergence.sql` — RLS policies, indexes

## Key Findings

### 1. Current Logger Architecture
- `createRunLogger(runId, supabase)` creates a `RunLogger` with 4 methods: info/warn/error/debug
- Context fields: `iteration`, `phaseName` (→ agent_name column), `variantId`, plus arbitrary JSONB `context`
- Fire-and-forget writes — `Promise.resolve(supabase.insert(...)).then().catch()` — never blocks pipeline
- Logger created in `buildRunContext()` with ONLY `runId` — no experiment/strategy context available

### 2. Entity Hierarchy and FK Chain
```
Strategy (1:N) → Run ← (N:1, optional) Experiment
Run (1:N, CASCADE) → Agent Invocations
Run (1:N, CASCADE) → Run Logs
Run (1:N, CASCADE) → Variants
```
- `evolution_runs.strategy_id` — NOT NULL FK to strategies
- `evolution_runs.experiment_id` — NULLABLE FK to experiments
- `evolution_agent_invocations.run_id` — NOT NULL FK to runs (CASCADE)
- `evolution_run_logs.run_id` — NOT NULL FK to runs (CASCADE)

### 3. Current evolution_run_logs Schema
```sql
CREATE TABLE evolution_run_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES evolution_runs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  level TEXT NOT NULL DEFAULT 'info',
  agent_name TEXT,
  iteration INT,
  variant_id TEXT,
  message TEXT NOT NULL,
  context JSONB
);
```
Indexes: `(run_id, created_at DESC)`, `(run_id, iteration)`, `(run_id, agent_name)`, `(run_id, variant_id)`, `(run_id, level)`

### 4. Current Log UI (Run Detail Only)
- `LogsPanel` component inlined in run detail page (lines 34-84)
- Fetches via `getEvolutionRunLogsAction({ runId })` — default limit 200, ascending order
- Simple table: Time, Level, Agent, Message
- No filtering controls, no pagination UI, no context expansion
- No other entity detail pages have log tabs

### 5. Invocation ID Not Available During Phase Execution
- Invocations created BEFORE phase execution in `runIterationLoop.ts`
- Phase functions (`generateVariants`, `rankPool`) don't receive invocation ID
- Logs written during phase can't include invocation_id without signature changes
- Correlation possible via composite key: `(run_id, iteration, agent_name)`

### 6. Existing Aggregation Patterns (Model for Logs)
- **Cost view:** `evolution_run_costs` aggregates invocations by run_id
- **Batch enrichment:** Fetch run IDs → `.in('run_id', runIds)` → Map for O(1) lookup
- **Strategy aggregates:** `update_strategy_aggregates` RPC updates denormalized metrics
- **Experiment metrics:** `computeExperimentMetrics()` fetches runs + variants, aggregates in JS

### 7. Migration Patterns
- Naming: `YYYYMMDDHHMMSS_descriptive_name.sql`
- Always use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Two-step FK: `ADD CONSTRAINT ... NOT VALID` then `VALIDATE CONSTRAINT`
- RLS: DO blocks looping over table arrays
- Concurrent indexes: `CREATE INDEX CONCURRENTLY` with `supabase:disable-transaction` pragma

### 8. Tab System Pattern
- `useTabState(TABS)` hook for URL-synced tab state
- `EntityDetailTabs` renders tab bar + content
- Conditional rendering: `{activeTab === 'logs' && <Component />}`
- Each tab is a client component fetching data via server action in useEffect
- Strategy detail page needs refactoring from static layout to tabs

### 9. Performance Considerations
- ~50 logs/run, ~5KB/log → manageable volume
- Single-run queries <10ms with current indexes
- Multi-run queries (experiment/strategy) need denormalized columns or batch `.in()` queries
- No retention/cleanup mechanisms exist — unbounded growth risk
- Adding `experiment_id`/`strategy_id` columns enables O(log n) queries vs N+1 joins

## Open Questions

1. **Schema approach:** Denormalize (add experiment_id/strategy_id to logs table) vs. join through runs? Denormalization preferred for query simplicity.
2. **Invocation-level logging:** Should individual invocations produce their own log entries? Currently invocations track `error_message` and `execution_detail` JSONB but don't write to `evolution_run_logs`.
3. **Existing LogsPanel:** Replace inline implementation with shared `LogsTab` component, or keep run-specific version?
4. **Strategy detail page:** Needs tab system refactoring — how much restructuring is acceptable?
5. **Log retention:** Should this project add a cleanup mechanism, or defer?
