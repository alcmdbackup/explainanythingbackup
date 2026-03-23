# Evolution Logs Refactor Plan

## Background
Refactor the evolution logging system so that different entities (agent invocations, runs, experiments, strategies) can produce logs. Logs should aggregate upward through the entity hierarchy, so viewing logs for a run includes logs from its agent invocations, and viewing experiment logs includes all run and invocation logs. A standardized UI component will display logs for any entity along with all contained sub-entities.

## Requirements (from GH Issue #NNN)
- Different entities can produce logs - agent invocations, runs, experiments, strategies
- Logs are aggregated up - e.g. agent invocations can be displayed on containing runs and experiments and strategies
- There is a standardized UI component that displays logs for the corresponding entity as well as all contained things. E.g. on run "log" tab in evolution admin UI, you can see logs for that run, all contained agent invocations, etc

## Problem
The current logging system is single-entity: `createRunLogger(runId, supabase)` hardcodes `run_id` as the only entity FK in `evolution_run_logs`. There's no way for an agent invocation, experiment, or strategy to produce its own log entries. The `LogsPanel` UI is inlined in the run detail page with no filtering, pagination, or reuse across pages. To support multi-entity logging with upward aggregation, we need a generalized logger that accepts an `entity_type` + `entity_id`, a schema that enforces the aggregation hierarchy, and a shared UI component.

## Entity Hierarchy & Aggregation Rules

```
strategy
  └── experiment
        └── run
              └── invocation
```

Each log row stores WHO created it (`entity_type` + `entity_id`) plus denormalized ancestor FKs for efficient aggregation queries:

| entity_type  | entity_id points to         | Denormalized ancestor columns populated |
|-------------|-----------------------------|-----------------------------------------|
| invocation  | evolution_agent_invocations.id | run_id, experiment_id, strategy_id     |
| run         | evolution_runs.id            | run_id (=entity_id), experiment_id, strategy_id |
| experiment  | evolution_experiments.id     | experiment_id (=entity_id), strategy_id (from first run? or null) |
| strategy    | evolution_strategies.id      | strategy_id (=entity_id)               |

**Aggregation query pattern:** To view logs for an experiment including all children:
```sql
SELECT * FROM evolution_logs
WHERE experiment_id = :id
ORDER BY created_at DESC;
```
This returns experiment-level logs + all run logs + all invocation logs for that experiment — no joins needed.

## Options Considered

### Option A: Denormalized ancestor columns on existing table (CHOSEN)
- Rename `evolution_run_logs` → `evolution_logs`
- Add `entity_type`, `entity_id`, `experiment_id`, `strategy_id` columns
- Keep `run_id` (already exists)
- Populate ancestor FKs at write time from context
- **Pros:** Single table, O(log n) queries by any ancestor, follows existing cost aggregation pattern
- **Cons:** Denormalization requires context at write time, slight storage overhead

### Option B: Separate log tables per entity
- Create `evolution_experiment_logs`, `evolution_strategy_logs`, etc.
- **Rejected:** Fragments queries, duplicates schema, harder to build unified UI

### Option C: Join through entity tables at query time
- Keep logs as run-only, join `runs → experiments → strategies` at read time
- **Rejected:** N+1 query pattern, slow for experiment/strategy views, no way to log from non-run entities

## Phased Execution Plan

### Phase 1: Schema Migration
**Goal:** Rename table, add new columns, create indexes

1. Create migration `20260323000001_generalize_evolution_logs.sql`:
   ```sql
   -- Step 1: Rename table
   ALTER TABLE evolution_run_logs RENAME TO evolution_logs;

   -- Step 2: Create backwards-compat VIEW so old code still works during deploy window
   CREATE OR REPLACE VIEW evolution_run_logs AS SELECT * FROM evolution_logs;

   -- Step 3: Relax run_id NOT NULL — experiment/strategy logs have no run_id
   ALTER TABLE evolution_logs ALTER COLUMN run_id DROP NOT NULL;

   -- Step 4: Add entity identification columns
   ALTER TABLE evolution_logs ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'run';
   ALTER TABLE evolution_logs ADD COLUMN IF NOT EXISTS entity_id UUID;

   -- Step 5: Add denormalized ancestor columns
   ALTER TABLE evolution_logs ADD COLUMN IF NOT EXISTS experiment_id UUID;
   ALTER TABLE evolution_logs ADD COLUMN IF NOT EXISTS strategy_id UUID;

   -- Step 6: Backfill entity_id from run_id for existing rows
   UPDATE evolution_logs SET entity_id = run_id WHERE entity_type = 'run';

   -- Step 7: Enforce entity_id NOT NULL after backfill
   ALTER TABLE evolution_logs ALTER COLUMN entity_id SET NOT NULL;

   -- Step 8: Backfill experiment_id and strategy_id from evolution_runs
   -- Note: experiment_id will be NULL for standalone runs (correct behavior)
   -- strategy_id is NOT NULL on evolution_runs since 20260318, always populated
   UPDATE evolution_logs el
   SET experiment_id = er.experiment_id, strategy_id = er.strategy_id
   FROM evolution_runs er
   WHERE el.run_id = er.id;

   -- Step 9: New indexes for aggregation queries
   CREATE INDEX IF NOT EXISTS idx_logs_experiment_created
     ON evolution_logs (experiment_id, created_at DESC) WHERE experiment_id IS NOT NULL;
   CREATE INDEX IF NOT EXISTS idx_logs_strategy_created
     ON evolution_logs (strategy_id, created_at DESC) WHERE strategy_id IS NOT NULL;
   CREATE INDEX IF NOT EXISTS idx_logs_entity
     ON evolution_logs (entity_type, entity_id, created_at DESC);

   -- Step 10: Recreate RLS policies for renamed table (use new name 'evolution_logs')
   ALTER TABLE evolution_logs ENABLE ROW LEVEL SECURITY;
   DROP POLICY IF EXISTS deny_all ON evolution_logs;
   CREATE POLICY deny_all ON evolution_logs FOR ALL USING (false) WITH CHECK (false);
   DROP POLICY IF EXISTS service_role_all ON evolution_logs;
   CREATE POLICY service_role_all ON evolution_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

   -- Optional readonly_select (skip if role doesn't exist)
   DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_local') THEN
       EXECUTE 'DROP POLICY IF EXISTS readonly_select ON evolution_logs';
       EXECUTE 'CREATE POLICY readonly_select ON evolution_logs FOR SELECT TO readonly_local USING (true)';
     END IF;
   END $$;
   ```

   **Rollback migration** (`20260323000001_generalize_evolution_logs_down.sql`):
   ```sql
   -- Reverse: drop view, rename back, restore NOT NULL
   DROP VIEW IF EXISTS evolution_run_logs;
   ALTER TABLE evolution_logs RENAME TO evolution_run_logs;
   ALTER TABLE evolution_run_logs ALTER COLUMN run_id SET NOT NULL;
   ALTER TABLE evolution_run_logs DROP COLUMN IF EXISTS entity_type;
   ALTER TABLE evolution_run_logs DROP COLUMN IF EXISTS entity_id;
   ALTER TABLE evolution_run_logs DROP COLUMN IF EXISTS experiment_id;
   ALTER TABLE evolution_run_logs DROP COLUMN IF EXISTS strategy_id;
   ```

   **Deployment safety:** The backwards-compat VIEW (`CREATE VIEW evolution_run_logs AS SELECT * FROM evolution_logs`) ensures that during the window between migration deploy and code deploy, old code querying `evolution_run_logs` still works. The VIEW is dropped in a follow-up migration after all code is deployed.

2. Update all Supabase queries referencing `evolution_run_logs` → `evolution_logs`. Grep for all references:
   - `evolution/src/lib/pipeline/infra/createRunLogger.ts` — table name in insert
   - `evolution/src/services/evolutionActions.ts` — table name in getEvolutionRunLogsAction select
   - `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — check for any direct table references
   - Any test files mocking `evolution_run_logs` (e.g., `runIterationLoop.test.ts`)

**Files modified:**
- `supabase/migrations/` — new migration + rollback
- `evolution/src/lib/pipeline/infra/createRunLogger.ts` — table name
- `evolution/src/services/evolutionActions.ts` — table name in getEvolutionRunLogsAction
- Any test files with `evolution_run_logs` mock references

**Verify:** `npm run tsc`, unit tests pass

### Phase 2: Generalized Logger Factory + Invocation Logger Wiring
**Goal:** Replace `createRunLogger` with `createEntityLogger` that any entity can use, and wire invocation-level logging into the pipeline loop

1. Create `evolution/src/lib/pipeline/infra/createEntityLogger.ts`:
   ```typescript
   export type EntityType = 'run' | 'invocation' | 'experiment' | 'strategy';

   export interface EntityLogContext {
     entityType: EntityType;
     entityId: string;
     // Denormalized ancestors (populated by caller)
     runId?: string;
     experimentId?: string;
     strategyId?: string;
   }

   // Known context fields extracted internally by log() — not exposed in the interface.
   // Callers pass Record<string, unknown> and the implementation destructures known keys.

   /** Replaces the existing EvolutionLogger interface from types.ts.
    *  Methods accept Record<string, unknown> (same as EvolutionLogger) so EntityLogger
    *  is assignable to EvolutionLogger in strict mode. Known fields (iteration, phaseName,
    *  variantId) are extracted inside the log() implementation, not in the type signature.
    *  The optional flush() from EvolutionLogger is omitted — fire-and-forget needs no flush.
    */
   export interface EntityLogger {
     info(message: string, context?: Record<string, unknown>): void;
     warn(message: string, context?: Record<string, unknown>): void;
     error(message: string, context?: Record<string, unknown>): void;
     debug(message: string, context?: Record<string, unknown>): void;
   }

   export function createEntityLogger(
     entityCtx: EntityLogContext,
     supabase: SupabaseClient,
   ): EntityLogger {
     function log(level, message, context?) {
       const { iteration, phaseName, variantId, ...rest } = context ?? {};
       supabase.from('evolution_logs').insert({
         entity_type: entityCtx.entityType,
         entity_id: entityCtx.entityId,
         run_id: entityCtx.runId ?? null,
         experiment_id: entityCtx.experimentId ?? null,
         strategy_id: entityCtx.strategyId ?? null,
         level,
         message,
         agent_name: phaseName ?? null,
         iteration: iteration ?? null,
         variant_id: variantId ?? null,
         context: Object.keys(rest).length > 0 ? rest : null,
       });
       // fire-and-forget (same pattern as current createRunLogger)
     }

     return {
       info: (msg, ctx) => log('info', msg, ctx),
       warn: (msg, ctx) => log('warn', msg, ctx),
       error: (msg, ctx) => log('error', msg, ctx),
       debug: (msg, ctx) => log('debug', msg, ctx),
     };
   }
   ```

2. **Delete `createRunLogger.ts` and `createRunLogger.test.ts`** — no thin wrappers. All callers use `createEntityLogger` directly.

3. Update `buildRunContext.ts` to use `createEntityLogger` directly:
   ```typescript
   // Before: createRunLogger(runId, db)
   // After:
   const logger = createEntityLogger({
     entityType: 'run',
     entityId: runId,
     runId,
     experimentId: claimedRun.experiment_id ?? undefined,
     strategyId: claimedRun.strategy_id,
   }, db);
   ```

4. Update all other files that imported `RunLogger` type or `createRunLogger`:
   - `runIterationLoop.ts` — import `EntityLogger` instead of `RunLogger`
   - `persistRunResults.ts` — import `EntityLogger` instead of `RunLogger`
   - `index.ts` — export `EntityLogger` and `createEntityLogger` (remove `createRunLogger` export)

5. Wire invocation-level loggers in `runIterationLoop.ts` — same `createEntityLogger()` call as every other entity:
   ```typescript
   const genInvId = await createInvocation(db, runId, iter, 'generation', ++execOrder);
   const genLogger = genInvId
     ? createEntityLogger({ entityType: 'invocation', entityId: genInvId, runId, experimentId, strategyId }, db)
     : logger;  // fallback to run logger if invocation creation failed

   const rankInvId = await createInvocation(db, runId, iter, 'ranking', ++execOrder);
   const rankLogger = rankInvId
     ? createEntityLogger({ entityType: 'invocation', entityId: rankInvId, runId, experimentId, strategyId }, db)
     : logger;
   ```
   Ancestor FKs (runId, experimentId, strategyId) are already available in `runIterationLoop.ts` from the run context.

6. Pass invocation loggers into phase functions so they can log during execution:

   **generateVariants** — add `logger?: EntityLogger` param, log internally:
   ```typescript
   export async function generateVariants(
     text: string, iteration: number, llm: EvolutionLLMClient,
     config: EvolutionConfig,
     feedback?: { weakestDimension: string; suggestions: string[] },
     logger?: EntityLogger,  // NEW
   ): Promise<TextVariation[]> {
     // Log per-strategy execution
     logger?.info(`Generating with ${count} strategies`, { phaseName: 'generation', iteration });
     // Inside each strategy:
     logger?.debug(`Strategy ${strategy.name} produced variant`, { phaseName: 'generation', iteration });
     // On format validation failure:
     logger?.warn(`Strategy ${strategy.name} variant failed format validation`, { phaseName: 'generation', iteration });
   }
   ```

   **rankPool** — add `logger?: EntityLogger` param, log internally:
   ```typescript
   export async function rankPool(
     pool: TextVariation[], ratings: Map<string, Rating>,
     matchCounts: Map<string, number>, newEntrantIds: string[],
     llm: EvolutionLLMClient, config: EvolutionConfig,
     budgetFraction?: number, cache?: Map<string, ComparisonResult>,
     logger?: EntityLogger,  // NEW
   ): Promise<RankResult> {
     // Log triage outcomes
     logger?.info(`Triage: ${eliminated} eliminated, ${passed} passed`, { phaseName: 'ranking', iteration });
     // Log Swiss rounds
     logger?.debug(`Swiss round ${round}: ${matches} matches`, { phaseName: 'ranking' });
     // Log convergence
     logger?.info('Pool converged', { phaseName: 'ranking' });
   }
   ```

   **Note on evolveVariants:** `evolveVariants` in `extractFeedback.ts` is a standalone utility not wired into the iteration loop (`runIterationLoop.ts` only calls `generateVariants` and `rankPool`). If it is used outside the loop (tests, external callers), its callers can create their own `EntityLogger` as needed — no special wiring required here.

   Callers in `runIterationLoop.ts` pass the invocation logger to both loop phases:
   ```typescript
   const variants = await generateVariants(text, iter, llm, config, feedback, genLogger);
   const rankResult = await rankPool(pool, ratings, matchCounts, newIds, llm, config, budgetFrac, cache, rankLogger);
   ```

**Files created:**
- `evolution/src/lib/pipeline/infra/createEntityLogger.ts` — NEW
- `evolution/src/lib/pipeline/infra/createEntityLogger.test.ts` — NEW

**Files deleted:**
- `evolution/src/lib/pipeline/infra/createRunLogger.ts` — DELETED (replaced by createEntityLogger)
- `evolution/src/lib/pipeline/infra/createRunLogger.test.ts` — DELETED

**Files modified:**
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — use createEntityLogger directly with full ancestor context
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — import EntityLogger + createEntityLogger, create invocation loggers for generate + rank phases, pass to phase functions
- `evolution/src/lib/pipeline/loop/generateVariants.ts` — add optional `logger?: EntityLogger` param, add internal logging
- `evolution/src/lib/pipeline/loop/rankVariants.ts` — add optional `logger?: EntityLogger` param, add internal logging
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — import EntityLogger instead of RunLogger
- `evolution/src/lib/pipeline/index.ts` — export EntityLogger, EntityLogContext, createEntityLogger (remove createRunLogger)
- `evolution/src/lib/types.ts` — update EvolutionLogger doc comment to reference EntityLogger as the canonical implementation
- `evolution/scripts/run-evolution-local.ts` — replace all createRunLogger/RunLogger imports with createEntityLogger/EntityLogger

**Verify:** All existing tests pass (update imports), new unit tests for createEntityLogger

### Phase 2b: All Entities Produce Logs
**Goal:** Experiments and strategies also create loggers and write log entries at key lifecycle events

Currently only runs and invocations produce logs (via pipeline execution). Experiments and strategies need loggers too — created in their respective server actions.

1. **Experiment logging** — in `experimentActionsV2.ts`, create an experiment logger at key lifecycle points:
   ```typescript
   // When creating an experiment
   const logger = createEntityLogger({
     entityType: 'experiment', entityId: experiment.id,
     experimentId: experiment.id,
     strategyId: experiment.strategy_id ?? undefined,
   }, ctx.supabase);
   logger.info('Experiment created', { runCount: config.runCount });

   // When cancelling an experiment
   logger.warn('Experiment cancelled');

   // When experiment auto-completes (all runs done) — in manageExperiments.ts
   logger.info('Experiment completed', { completedRuns, totalCost });
   ```

2. **Strategy logging** — in `strategyRegistryActionsV2.ts`, create a strategy logger:
   ```typescript
   const logger = createEntityLogger({
     entityType: 'strategy', entityId: strategyId,
     strategyId,
   }, ctx.supabase);
   logger.info('Strategy created', { name, pipelineType });

   // When archiving
   logger.info('Strategy archived');

   // When aggregates update — in persistRunResults.ts (finalizeRun)
   // Already has strategy_id context from the run logger
   logger.info('Strategy aggregates updated', { runCount, avgFinalElo });
   ```

3. **Run logging** — already produces logs via pipeline (Phase 2). Additionally, log admin-triggered events in `evolutionActions.ts`:
   ```typescript
   // When a run is manually cancelled from admin UI
   logger.warn('Run cancelled by admin');
   ```

4. **Invocation logging** — already wired in Phase 2 via `createEntityLogger()` in `runIterationLoop.ts`. Invocations log during phase execution (generation, ranking, evolve).

**Summary of what each entity logs:**

| Entity | Where logs are produced | Example events |
|--------|------------------------|----------------|
| strategy | `strategyRegistryActionsV2.ts` | created, archived, aggregates updated |
| experiment | `experimentActionsV2.ts`, `manageExperiments.ts` | created, cancelled, completed |
| run | `buildRunContext.ts`, `claimAndExecuteRun.ts`, `persistRunResults.ts`, `runIterationLoop.ts` | claimed, iteration start, arena load, finalization, errors |
| invocation | `runIterationLoop.ts`, `generateVariants.ts`, `rankVariants.ts` | strategy execution, format validation, triage outcomes, convergence, phase errors |

**Files modified:**
- `evolution/src/services/experimentActionsV2.ts` — add experiment logger at create/cancel
- `evolution/src/lib/pipeline/manageExperiments.ts` — add experiment logger at auto-complete
- `evolution/src/services/strategyRegistryActionsV2.ts` — add strategy logger at create/archive
- `evolution/src/services/evolutionActions.ts` — add run logger at manual cancel
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — strategy aggregate log

**Verify:** Unit tests for new log calls, check entity_type is correct in each case

### Phase 3: Server Actions for Multi-Entity Log Queries
**Goal:** Generalize log fetching to support any entity type

1. Create `evolution/src/services/logActions.ts`:
   ```typescript
   interface LogFilters {
     level?: string;
     agentName?: string;
     iteration?: number;
     entityType?: string;  // filter to only logs from this entity type
     limit?: number;
     offset?: number;
   }

   // Fetch logs for an entity + all descendants
   export const getEntityLogsAction = adminAction(
     'getEntityLogsAction',
     async (args: {
       entityType: 'run' | 'experiment' | 'strategy' | 'invocation';
       entityId: string;
       filters?: LogFilters;
     }, ctx) => {
       // Query by the appropriate ancestor column:
       // run → WHERE run_id = :id
       // experiment → WHERE experiment_id = :id
       // strategy → WHERE strategy_id = :id
       // invocation → WHERE entity_type = 'invocation' AND entity_id = :id
     }
   );
   ```

2. Keep `getEvolutionRunLogsAction` as thin wrapper calling `getEntityLogsAction({ entityType: 'run', ... })`

**Files modified:**
- `evolution/src/services/logActions.ts` — NEW
- `evolution/src/services/evolutionActions.ts` — deprecate/wrap old action

**Verify:** Unit tests for logActions, existing run logs tests still pass

### Phase 4: Shared LogsTab Component
**Goal:** Reusable log viewer with filtering, pagination, entity-type badges

1. Create `evolution/src/components/evolution/tabs/LogsTab.tsx`:
   ```typescript
   interface LogsTabProps {
     entityType: 'run' | 'experiment' | 'strategy' | 'invocation';
     entityId: string;
   }
   ```
   Features:
   - Filter bar: level dropdown, entity type dropdown, agent name text input
   - Pagination: reuse EntityListPage sliding-window pattern
   - Entity type badge on each row showing source (run, invocation, etc.)
   - Expandable context JSON viewer
   - Empty state and loading skeleton

2. Replace inline `LogsPanel` in run detail page with `<LogsTab entityType="run" entityId={runId} />`

**Files modified:**
- `evolution/src/components/evolution/tabs/LogsTab.tsx` — NEW
- `evolution/src/components/evolution/tabs/LogsTab.test.tsx` — NEW
- `evolution/src/components/evolution/index.ts` — export LogsTab
- `src/app/admin/evolution/runs/[runId]/page.tsx` — replace LogsPanel with LogsTab

**Verify:** Unit test for LogsTab, run detail page test still passes

### Phase 5: Add Logs Tabs to All 4 Entity Detail Pages
**Goal:** Every entity detail view has a logs tab using the shared LogsTab component

All 4 entity detail pages get `<LogsTab entityType="..." entityId={id} />`:

| Page | entityType | Shows | Current state |
|------|-----------|-------|--------------|
| Run detail | `"run"` | Run logs + invocation logs | Replace inline LogsPanel (done in Phase 4) |
| Experiment detail | `"experiment"` | Experiment + run + invocation logs | Add tab to existing tabs |
| Strategy detail | `"strategy"` | Strategy + experiment + run + invocation logs | Refactor to tabs first |
| Invocation detail | `"invocation"` | Invocation-only logs | Refactor to tabs first |

1. **Experiment detail** — add 'logs' tab to `ExperimentDetailContent.tsx`:
   ```typescript
   const TABS: TabDef[] = [
     { id: 'overview', label: 'Overview' },
     { id: 'analysis', label: 'Analysis' },
     { id: 'runs', label: 'Runs' },
     { id: 'logs', label: 'Logs' },  // NEW
   ];
   // ...
   {activeTab === 'logs' && <LogsTab entityType="experiment" entityId={experimentId} />}
   ```

2. **Strategy detail** — refactor `strategies/[strategyId]/page.tsx` to use tabs:
   - Convert static layout to `useTabState(TABS)` + `EntityDetailTabs`
   - Move existing config/metrics into 'overview' tab
   - Add 'logs' tab:
   ```typescript
   const TABS: TabDef[] = [
     { id: 'overview', label: 'Overview' },
     { id: 'logs', label: 'Logs' },
   ];
   {activeTab === 'logs' && <LogsTab entityType="strategy" entityId={strategyId} />}
   ```

3. **Invocation detail** — currently a server component (`async function`). Must split into server wrapper + client detail component (same pattern as experiment detail: `page.tsx` fetches data server-side, passes to `InvocationDetailContent.tsx` client component):
   - Create `InvocationDetailContent.tsx` as `'use client'` component
   - Move existing metrics/execution detail into 'overview' tab
   - Add 'logs' tab:
   ```typescript
   const TABS: TabDef[] = [
     { id: 'overview', label: 'Overview' },
     { id: 'logs', label: 'Logs' },
   ];
   {activeTab === 'logs' && <LogsTab entityType="invocation" entityId={invocationId} />}
   ```

**Files modified:**
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailContent.tsx` — add logs tab
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentDetailContent.test.tsx` — update test for new tab
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx` — refactor to client component with tabs + add logs tab
- `src/app/admin/evolution/invocations/[invocationId]/page.tsx` — slim down to server wrapper
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — NEW client component with tabs + logs tab

**Verify:** All 4 detail pages show logs tab, each filtered correctly by entity type

## Testing

### Unit Tests
- `createEntityLogger.test.ts` — must port all 8 test cases from `createRunLogger.test.ts`:
  1. All 4 log levels write correct level value
  2. `iteration` extracted from context to column
  3. `phaseName` extracted to `agent_name` column
  4. `variantId` extracted to `variant_id` column
  5. Remaining context fields stored as JSONB
  6. DB errors swallowed (fire-and-forget, no unhandled rejection)
  7. NEW: `entity_type` and `entity_id` columns populated correctly
  8. NEW: ancestor FKs (`run_id`, `experiment_id`, `strategy_id`) written correctly
  9. NEW: `run_id` is NULL when entity_type is 'experiment' or 'strategy'
- `logActions.test.ts` — one test per query path:
  1. `entityType='run'` → queries `WHERE run_id = :id`
  2. `entityType='experiment'` → queries `WHERE experiment_id = :id`
  3. `entityType='strategy'` → queries `WHERE strategy_id = :id`
  4. `entityType='invocation'` → queries `WHERE entity_type = 'invocation' AND entity_id = :id`
  5. Validates entityId as UUID
  6. Filtering by level, agentName, iteration
  7. Pagination (limit/offset)
- `LogsTab.test.tsx` — render with mock data, filter interactions, pagination, entity-type badges
- Delete `createRunLogger.test.ts` (all cases ported to createEntityLogger.test.ts)
- Update `runIterationLoop.test.ts` — update any `evolution_run_logs` mock references to `evolution_logs`
- Update `evolutionActions.test.ts` — existing getEvolutionRunLogsAction tests still pass via wrapper

### Integration Tests
- Log aggregation: create experiment → runs → invocations → write logs at each level → query by experiment returns all
- Backfill: verify existing run logs get experiment_id/strategy_id populated

### E2E Tests
- Note: No existing E2E infrastructure for evolution admin pages. E2E tests will require page objects and test data factories. Keep E2E scope minimal for this project — verify logs tab renders and shows data on run detail page only. Other pages verified via unit tests.
- Run detail logs tab shows run + invocation logs

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/data_model.md` — rename evolution_run_logs → evolution_logs, document new columns, entity hierarchy
- `evolution/docs/evolution/architecture.md` — update logging architecture section, EntityLogger factory
- `evolution/docs/evolution/visualization.md` — document LogsTab component, new entity detail page tabs
- `docs/feature_deep_dives/evolution_logging.md` — populate with full logging system documentation
