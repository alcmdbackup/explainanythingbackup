# Evolution Logging

Deep dive into the evolution pipeline's structured logging system: entity hierarchy, logger factory, log aggregation, UI component, and server actions.

> **Logging under concurrency (parallel pipeline).** During a generate iteration, the
> orchestrator dispatches `numVariants` `GenerateFromSeedArticleAgent` invocations in
> parallel. Each agent gets a 1-based `agentIndex` field on its `AgentContext` and an
> ascending `executionOrder`, both of which are written into the invocation row. Logs
> from the EntityLogger are tagged with the agent's `invocationId` (and therefore its
> iteration + execution_order via the invocation row), so admins can filter
> interleaved logs down to a single agent's timeline. Per-comparison detail (opponent
> selection scores, before/after mu/sigma per round, stop reason) is captured in the
> `execution_detail.ranking.comparisons[]` array on the invocation row, not in
> separate log rows — this avoids log bloat under N parallel agents while keeping the
> full timeline replayable from the admin UI.

## Entity Hierarchy

Logs are organized around four entity types, forming a hierarchy:

```
EXPERIMENT
  └── RUN (many per experiment)
        └── INVOCATION (many per run)

STRATEGY (shared across runs, not a parent in the hierarchy)
```

Each log row records both its direct emitter (`entity_type` + `entity_id`) and denormalized ancestor FKs (`run_id`, `experiment_id`, `strategy_id`). This denormalization enables efficient aggregation queries without JOINs.

**Entity types** (`EntityType` union in `createEntityLogger.ts`):
- `'run'` — pipeline-level lifecycle events (start, phase transitions, completion)
- `'invocation'` — per-agent-per-iteration execution logs
- `'experiment'` — experiment-level events (creation, status changes)
- `'strategy'` — strategy-level events

## EntityLogger Factory

**File:** `evolution/src/lib/pipeline/infra/createEntityLogger.ts`

The `createEntityLogger(entityCtx, supabase)` factory replaces the former `createRunLogger`. It returns an `EntityLogger` with `info()`, `warn()`, `error()`, and `debug()` methods.

### EntityLogContext

```typescript
interface EntityLogContext {
  entityType: EntityType;  // 'run' | 'invocation' | 'experiment' | 'strategy'
  entityId: string;        // UUID of the emitting entity
  runId?: string;          // Denormalized ancestor FK
  experimentId?: string;   // Denormalized ancestor FK
  strategyId?: string;     // Denormalized ancestor FK
}
```

### EntityLogger Interface

```typescript
interface EntityLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}
```

### Behavior

- **Fire-and-forget**: All DB writes are async with swallowed errors. Logging never disrupts pipeline execution.
- **Field extraction**: Known fields (`iteration`, `phaseName`, `variantId`) are extracted from the context argument and written to dedicated columns. Remaining fields go into the `context` JSONB column.
- **Table**: Writes to `evolution_logs` (renamed from `evolution_run_logs`).

### Usage Example

```typescript
const logger = createEntityLogger(
  {
    entityType: 'run',
    entityId: runId,
    experimentId: run.experiment_id ?? undefined,
    strategyId: run.strategy_id,
  },
  supabase,
);

logger.info('Pipeline started', { phaseName: 'init' });
logger.warn('Budget threshold reached', { iteration: 3, remaining: 0.12 });
```

For invocation-level logging, create a child logger:

```typescript
const invocationLogger = createEntityLogger(
  {
    entityType: 'invocation',
    entityId: invocationId,
    runId,
    experimentId,
    strategyId,
  },
  supabase,
);
```

## Log Aggregation

The `evolution_logs` table uses denormalized ancestor columns to support efficient aggregation without JOINs:

| Query Scope | Filter Clause |
|---|---|
| Single run + its invocations | `WHERE run_id = ?` |
| All runs in an experiment | `WHERE experiment_id = ?` |
| All runs using a strategy | `WHERE strategy_id = ?` |
| Single invocation only | `WHERE entity_type = 'invocation' AND entity_id = ?` |

This design means a single `WHERE` clause on an indexed column returns the full log tree for any entity, regardless of depth.

## LogsTab UI Component

**File:** `evolution/src/components/evolution/tabs/LogsTab.tsx`

A shared React component used on all 4 entity detail pages:
- **Run detail** (`/admin/evolution/runs/[runId]`) — existing Logs tab, now uses `LogsTab`
- **Experiment detail** (`/admin/evolution/experiments/[experimentId]`) — new Logs tab
- **Strategy detail** (`/admin/evolution/strategies/[strategyId]`) — new detail page with Overview + Logs tabs
- **Invocation detail** (`/admin/evolution/invocations/[invocationId]`) — refactored into server wrapper + `InvocationDetailContent` client component with Overview + Logs tabs

### Props

```typescript
interface LogsTabProps {
  entityType: EntityType;  // Determines query strategy
  entityId: string;        // UUID of the entity
}
```

### Features

- **Filter bar**: Log level dropdown, entity type dropdown (hidden for invocation pages since they only have one entity type), and agent name text input.
- **Entity-type badges**: Color-coded badges per log row — blue (run), purple (invocation), green (experiment), amber (strategy).
- **Expandable context**: Click a row to toggle a JSON viewer for the `context` JSONB payload.
- **Pagination**: 100 logs per page with Previous/Next navigation.

## getEntityLogsAction Server Action

**File:** `evolution/src/services/logActions.ts`

The `getEntityLogsAction` server action powers the `LogsTab` component. Wrapped in `adminAction` for auth and error handling.

### Input

```typescript
{
  entityType: EntityType;
  entityId: string;
  filters?: {
    level?: string;
    agentName?: string;
    iteration?: number;
    entityType?: string;
    limit?: number;   // max 200
    offset?: number;
  };
}
```

### Query Strategy

The action selects the appropriate ancestor column based on entity type:
- `'run'` queries `WHERE run_id = entityId`
- `'experiment'` queries `WHERE experiment_id = entityId`
- `'strategy'` queries `WHERE strategy_id = entityId`
- `'invocation'` queries `WHERE entity_type = 'invocation' AND entity_id = entityId`

Results are ordered by `created_at ASC` with range-based pagination (max 200 per page).

## Triage Convergence Logging

During triage in `executeTriage()`, a debug-level log is emitted per entrant after opponent selection:

**Message:** `"Triage entrant opponents"`

**Context fields:**

| Field | Type | Description |
|-------|------|-------------|
| `variantId` | string | The entrant being calibrated |
| `opponentSigmas` | number[] | Sigma values of the selected opponents |
| `sigmaBefore` | number | The entrant's sigma before triage matches |
| `lowSigmaOpponents` | number | Count of opponents with sigma in the bottom 25th percentile (anchors) |

This log helps diagnose whether sigma-weighted opponent selection is working as expected and how many anchor opponents each entrant faces.

## Key Files

| File | Purpose |
|---|---|
| `evolution/src/lib/pipeline/infra/createEntityLogger.ts` | EntityLogger factory and types |
| `evolution/src/services/logActions.ts` | Multi-entity log query server action |
| `evolution/src/components/evolution/tabs/LogsTab.tsx` | Shared log viewer UI component |
