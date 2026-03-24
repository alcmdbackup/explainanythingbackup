# Entity Agent Classes Evolution Plan

## Background
The evolution pipeline codebase (186 files) uses a purely functional architecture with zero abstract classes. Entity concepts (runs, experiments, strategies, variants, invocations) are scattered across Zod schemas, metric registries, page-level column definitions, and service files. Agent concepts (generation, ranking) are plain functions called via an `executePhase()` wrapper. This leads to heavy duplication (30+ UUID checks, 5+ pagination implementations, 5+ archive patterns) and makes it hard to add new entity types or agents without copy-pasting across multiple files.

## Requirements (from GH Issue #805)
- Create abstract `Entity` class that enforces declarations: metrics, list view, detail view, relationships
- Create abstract `Agent` class that enforces execute() and provides invocation tracking ceremony
- Agent invocations are first-class entities with their own EntityDef
- Metrics integrate with entities via declared parent-child relationships (propagation up the hierarchy)
- List and detail views are driven by entity declarations (data-only, no React in entity classes)
- Big-bang replacement of METRIC_REGISTRY, scattered column defs, and scattered tab defs

## Problem
Entity metadata is scattered across 3+ files per entity type: METRIC_REGISTRY in registry.ts, column definitions in page-level TSX files, tab definitions in detail page components, and CRUD logic in service files. Adding a new entity requires touching all of these independently with no compile-time enforcement that they stay in sync. Similarly, adding a new pipeline agent requires manually wiring invocation tracking, budget handling, cost recording, and logging — ceremony that is identical across agents but copy-pasted in the orchestrator.

## Options Considered

### Option A: Keep functional, unify registries (rejected)
Merge METRIC_REGISTRY + column defs + tab defs into a single plain object per entity. No classes, just bigger config objects. **Rejected**: No compile-time enforcement that all fields are present. Easy to forget a field when adding a new entity.

### Option B: Abstract classes for Entity + Agent (chosen)
Abstract classes with required abstract fields. TypeScript refuses to compile if any declaration is missing. Entity base class provides generic CRUD. Agent base class provides invocation/budget ceremony via template method pattern.

### Option C: Interface-only approach (rejected)
Use interfaces instead of abstract classes. **Rejected**: Interfaces can't provide shared behavior (generic list, generic getById, agent run() ceremony). Would need separate utility functions, losing the single-source-of-truth benefit.

## Design

### Entity Base Class

```typescript
// evolution/src/lib/core/Entity.ts

abstract class Entity<TRow> {
  // === IDENTITY ===
  abstract readonly type: EntityType;
  abstract readonly table: string;

  // === RELATIONSHIPS ===
  // Parents: who do I propagate metrics UP to?
  abstract readonly parents: ParentRelation[];
  // Children: who propagates metrics FROM me?
  abstract readonly children: ChildRelation[];

  // === METRICS ===
  abstract readonly metrics: EntityMetricRegistry;

  // === LIST VIEW (data declarations only) ===
  abstract readonly listColumns: ColumnDef[];
  abstract readonly listFilters: FilterDef[];
  readonly defaultSort: SortDef = { column: 'created_at', dir: 'desc' };
  readonly listSelect: string = '*';

  // === DETAIL VIEW (data declarations only) ===
  abstract readonly detailTabs: TabDef[];
  abstract detailLinks(row: TRow): EntityLink[];
  readonly statusField?: string;

  // === SCHEMA ===
  abstract readonly insertSchema?: ZodSchema;

  // === ARCHIVE ===
  readonly archiveColumn?: string;    // 'status' or 'archived_at'
  readonly archiveValue?: unknown;    // 'archived' or ISO timestamp

  // === GENERIC CRUD (provided by base class) ===
  async list(filters: ListFilters, db: SupabaseClient): Promise<PaginatedResult<TRow>> {
    // Uses this.table, this.listSelect, this.defaultSort
    // Applies this.listFilters constraints
    // Handles pagination (limit/offset/range)
  }

  async getById(id: string, db: SupabaseClient): Promise<TRow | null> {
    // Uses this.table, validates UUID
  }

  async archive(id: string, db: SupabaseClient): Promise<void> {
    // Uses this.archiveColumn, this.archiveValue
  }

  // === METRIC PROPAGATION (provided by base class) ===
  async propagateMetricsToParents(
    entityId: string,
    db: SupabaseClient,
  ): Promise<void> {
    // Walks this.parents, fetches child metrics, runs aggregate functions
    // Writes results to evolution_metrics for each parent
  }

  async markParentMetricsStale(
    entityId: string,
    db: SupabaseClient,
  ): Promise<void> {
    // Walks this.parents, marks their metrics as stale
  }
}
```

### Relationship Types

```typescript
interface ParentRelation {
  parentType: EntityType;
  foreignKey: string;              // Column on THIS entity's table
  propagateMetrics: PropagationMetricDef[];
}

interface ChildRelation {
  childType: EntityType;
  foreignKey: string;              // Column on the CHILD's table
  cascade: 'delete' | 'nullify' | 'restrict';
  // delete: deleting parent deletes children
  // nullify: deleting parent sets FK to NULL on children
  // restrict: deleting parent is blocked if children exist
}
```

### Entity Subclasses

```typescript
// evolution/src/lib/core/entities/RunEntity.ts
class RunEntity extends Entity<EvolutionRunFullDb> {
  readonly type = 'run' as const;
  readonly table = 'evolution_runs';
  readonly statusField = 'status';
  readonly archiveColumn = 'archived';
  readonly archiveValue = true;

  readonly parents = [
    {
      parentType: 'strategy',
      foreignKey: 'strategy_id',
      propagateMetrics: [
        { name: 'run_count', sourceMetric: 'cost', aggregate: aggregateCount, aggregationMethod: 'count' },
        { name: 'total_cost', sourceMetric: 'cost', aggregate: aggregateSum, aggregationMethod: 'sum' },
        { name: 'avg_final_elo', sourceMetric: 'winner_elo', aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
        // ... remaining propagation defs (currently in SHARED_PROPAGATION_DEFS)
      ],
    },
    {
      parentType: 'experiment',
      foreignKey: 'experiment_id',
      propagateMetrics: [
        // Same propagation defs — experiment and strategy aggregate identically from runs
      ],
    },
  ];

  readonly children = [
    { childType: 'variant', foreignKey: 'run_id', cascade: 'delete' },
    { childType: 'invocation', foreignKey: 'run_id', cascade: 'delete' },
  ];

  readonly metrics = {
    duringExecution: [{ name: 'cost', ... }],
    atFinalization: [
      { name: 'winner_elo', ... },
      { name: 'median_elo', ... },
      { name: 'p90_elo', ... },
      { name: 'max_elo', ... },
      { name: 'total_matches', ... },
      { name: 'decisive_rate', ... },
      { name: 'variant_count', ... },
    ],
    atPropagation: [],
  };

  readonly listColumns = [
    { key: 'status', label: 'Status', formatter: 'statusBadge', sortable: true },
    { key: 'strategy_name', label: 'Strategy', formatter: 'text' },
    { key: 'iterations', label: 'Iterations', formatter: 'integer' },
    // + metric columns auto-generated from metrics.atFinalization
  ];

  readonly listFilters = [
    { field: 'status', type: 'select', options: ['pending', 'running', 'completed', 'failed'] },
    { field: 'archived', type: 'toggle', label: 'Show archived' },
  ];

  readonly detailTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'elo', label: 'Elo' },
    { id: 'lineage', label: 'Lineage' },
    { id: 'variants', label: 'Variants' },
    { id: 'logs', label: 'Logs' },
  ];

  detailLinks(row: EvolutionRunFullDb): EntityLink[] {
    const links: EntityLink[] = [];
    if (row.strategy_id) links.push({ label: 'Strategy', entityType: 'strategy', entityId: row.strategy_id });
    if (row.experiment_id) links.push({ label: 'Experiment', entityType: 'experiment', entityId: row.experiment_id });
    return links;
  }

  readonly insertSchema = evolutionRunInsertSchema;
}
```

Similar subclasses for: `StrategyEntity`, `ExperimentEntity`, `VariantEntity`, `InvocationEntity`, `PromptEntity`, `ArenaTopicEntity`.

### Entity Registry

```typescript
// evolution/src/lib/core/entityRegistry.ts

const ENTITY_REGISTRY: Record<EntityType, Entity<any>> = {
  run: new RunEntity(),
  strategy: new StrategyEntity(),
  experiment: new ExperimentEntity(),
  variant: new VariantEntity(),
  invocation: new InvocationEntity(),
  prompt: new PromptEntity(),
  arena_topic: new ArenaTopicEntity(),
};

// Lookup functions
function getEntity(type: EntityType): Entity<any> { return ENTITY_REGISTRY[type]; }
function getEntityMetrics(type: EntityType): EntityMetricRegistry { return ENTITY_REGISTRY[type].metrics; }
function getEntityParents(type: EntityType): ParentRelation[] { return ENTITY_REGISTRY[type].parents; }
```

### Agent Base Class

```typescript
// evolution/src/lib/core/Agent.ts

abstract class Agent<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly executionDetailSchema: ZodSchema;

  // Subclass implements the actual work
  abstract execute(input: TInput, ctx: AgentContext): Promise<TOutput>;

  // Base class provides the ceremony (template method pattern)
  async run(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>> {
    // 1. Create invocation row
    const invocationId = await createInvocation(
      ctx.db, ctx.runId, ctx.iteration, this.name, ctx.executionOrder,
    );

    // 2. Snapshot cost before execution
    const costBefore = ctx.costTracker.getTotalSpent();

    // 3. Log start
    ctx.logger.info(`Agent ${this.name} starting`, {
      phaseName: this.name,
      iteration: ctx.iteration,
    });

    try {
      // 4. Execute the agent's work
      const result = await this.execute(input, ctx);
      const cost = ctx.costTracker.getTotalSpent() - costBefore;

      // 5. Update invocation as success
      await updateInvocation(ctx.db, invocationId, {
        cost_usd: cost,
        success: true,
      });

      // 6. Log completion
      ctx.logger.info(`Agent ${this.name} completed`, {
        phaseName: this.name,
        iteration: ctx.iteration,
        cost,
      });

      return { success: true, result, cost, invocationId };

    } catch (error) {
      const cost = ctx.costTracker.getTotalSpent() - costBefore;

      // Handle BudgetExceededWithPartialResults (must check BEFORE BudgetExceededError)
      if (error instanceof BudgetExceededWithPartialResults) {
        await updateInvocation(ctx.db, invocationId, {
          cost_usd: cost, success: false, error_message: error.message,
        });
        return {
          success: false, result: null, cost, invocationId,
          budgetExceeded: true,
          partialResult: error.partialVariants,
        };
      }

      // Handle BudgetExceededError
      if (error instanceof BudgetExceededError) {
        await updateInvocation(ctx.db, invocationId, {
          cost_usd: cost, success: false, error_message: error.message,
        });
        return { success: false, result: null, cost, invocationId, budgetExceeded: true };
      }

      // All other errors: update invocation and re-throw
      await updateInvocation(ctx.db, invocationId, {
        cost_usd: cost, success: false, error_message: String(error),
      });
      throw error;
    }
  }
}

interface AgentContext {
  db: SupabaseClient;
  runId: string;
  iteration: number;
  executionOrder: number;
  logger: EntityLogger;
  costTracker: V2CostTracker;
  config: EvolutionConfig;
}

interface AgentResult<T> {
  success: boolean;
  result: T | null;
  cost: number;
  invocationId: string | null;
  budgetExceeded?: boolean;
  partialResult?: unknown;
}
```

### Agent Subclasses

```typescript
// evolution/src/lib/core/agents/GenerationAgent.ts
class GenerationAgent extends Agent<GenerationInput, Variant[]> {
  readonly name = 'generation';
  readonly executionDetailSchema = generationExecutionDetailSchema;

  async execute(input: GenerationInput, ctx: AgentContext): Promise<Variant[]> {
    // Calls existing generateVariants() logic
    return generateVariants(
      input.text, ctx.iteration, input.llm, ctx.config, input.feedback, ctx.logger,
    );
  }
}

// evolution/src/lib/core/agents/RankingAgent.ts
class RankingAgent extends Agent<RankingInput, RankResult> {
  readonly name = 'ranking';
  readonly executionDetailSchema = rankingExecutionDetailSchema;

  async execute(input: RankingInput, ctx: AgentContext): Promise<RankResult> {
    return rankPool(
      input.pool, input.ratings, input.matchCounts, input.newEntrantIds,
      input.llm, ctx.config, input.budgetFraction, input.cache, ctx.logger,
    );
  }
}
```

### Updated Orchestrator (runIterationLoop.ts)

```typescript
// Before (current):
const genInvId = await createInvocation(db, runId, iter, 'generation', ++executionOrder);
const genResult = await executePhase('generation', () => generateVariants(...), db, genInvId, costTracker, costBefore);
await updateInvocation(db, genInvId, { cost_usd: ..., success: ... });

// After (with Agent class):
const genAgent = new GenerationAgent();
const genResult = await genAgent.run(
  { text: originalText, llm, feedback },
  { db, runId, iteration: iter, executionOrder: ++execOrder, logger, costTracker, config },
);
// Invocation creation, cost tracking, error handling, logging all handled by Agent.run()
```

## Phased Execution Plan

### Phase 1: Core Abstract Classes
**Files created:**
- `evolution/src/lib/core/Entity.ts` — abstract Entity class with relationships, metrics, views, generic CRUD
- `evolution/src/lib/core/Agent.ts` — abstract Agent class with run()/execute() template method
- `evolution/src/lib/core/types.ts` — shared types (ParentRelation, ChildRelation, AgentContext, AgentResult, etc.)
- `evolution/src/lib/core/entityRegistry.ts` — ENTITY_REGISTRY + lookup functions

**Tests:**
- `evolution/src/lib/core/Entity.test.ts` — verify abstract enforcement, generic CRUD, metric propagation
- `evolution/src/lib/core/Agent.test.ts` — verify run() ceremony, budget error handling, invocation tracking

### Phase 2: Entity Subclasses
**Files created:**
- `evolution/src/lib/core/entities/RunEntity.ts`
- `evolution/src/lib/core/entities/StrategyEntity.ts`
- `evolution/src/lib/core/entities/ExperimentEntity.ts`
- `evolution/src/lib/core/entities/VariantEntity.ts`
- `evolution/src/lib/core/entities/InvocationEntity.ts`
- `evolution/src/lib/core/entities/PromptEntity.ts`
- `evolution/src/lib/core/entities/ArenaTopicEntity.ts`

**Tests:** One test file per entity verifying declarations are complete and correct.

**Replaces:**
- `evolution/src/lib/metrics/registry.ts` (METRIC_REGISTRY) — metrics now live on entity classes
- Scattered column definitions in page-level TSX files
- Scattered tab definitions in detail page components

### Phase 3: Agent Subclasses
**Files created:**
- `evolution/src/lib/core/agents/GenerationAgent.ts`
- `evolution/src/lib/core/agents/RankingAgent.ts`

**Files modified:**
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — replace executePhase() + manual invocation tracking with Agent.run()

**Replaces:**
- `executePhase()` function (ceremony moves into Agent.run())
- Manual createInvocation/updateInvocation calls in the orchestrator

### Phase 4: Wire UI to Entity Registry
**Files modified:**
- Entity list pages consume `entity.listColumns` and `entity.listFilters` from registry
- Entity detail pages consume `entity.detailTabs` and `entity.detailLinks()` from registry
- `EntityMetricsTab` reads metrics from `entity.metrics` instead of METRIC_REGISTRY
- `LogsTab` uses entity relationships to determine ancestor columns

### Phase 5: Wire Metrics to Entity Relationships
**Files modified:**
- `evolution/src/lib/metrics/writeMetrics.ts` — validate against entity.metrics
- `evolution/src/lib/metrics/recomputeMetrics.ts` — use entity.parents for propagation instead of hardcoded logic
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — use entity.propagateMetricsToParents()
- Remove `METRIC_REGISTRY` and `SHARED_PROPAGATION_DEFS`

### Phase 6: Cleanup
- Remove `executePhase()` function
- Remove scattered column/tab definitions from page files
- Update barrel exports (4 index.ts files)
- Delete empty scaffold directories (`agents/`, `v2/`) if no longer needed

## Testing

### Unit Tests (new)
- `Entity.test.ts` — abstract enforcement (compile-time), generic list/getById/archive, propagateMetricsToParents
- `Agent.test.ts` — run() ceremony, budget error handling (BudgetExceededWithPartialResults before BudgetExceededError), invocation creation/update, logging
- One test per entity subclass — verify all required fields are declared, metrics are valid, relationships are consistent
- One test per agent subclass — verify execute() is called with correct args, result is wrapped correctly

### Existing Tests (modified)
- `runIterationLoop.test.ts` — update to use Agent.run() instead of executePhase()
- `generateVariants.test.ts` — verify GenerationAgent wraps correctly
- `rankVariants.test.ts` — verify RankingAgent wraps correctly
- `registry.test.ts` — update to read from ENTITY_REGISTRY instead of METRIC_REGISTRY
- `recomputeMetrics.test.ts` — update to use entity.parents for propagation
- Service action tests — update any that reference METRIC_REGISTRY directly

### Manual Verification
- Admin UI list pages render correct columns from entity declarations
- Admin UI detail pages render correct tabs from entity declarations
- Metric propagation still works (create experiment → run → verify strategy metrics update)
- Budget error handling still works (set low budget → verify partial results returned)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/README.md` — add Entity/Agent class hierarchy to code layout section
- `evolution/docs/evolution/architecture.md` — describe Entity/Agent abstractions, replace "monolithic orchestrator" description
- `evolution/docs/evolution/data_model.md` — document relationship declarations (parents/children/cascade)
- `evolution/docs/evolution/agents/overview.md` — rewrite to describe Agent base class + subclasses
- `evolution/docs/evolution/entity_diagram.md` — update with declared relationships from Entity classes
- `evolution/docs/evolution/reference.md` — add new core/ files to key file reference
- `evolution/docs/evolution/experimental_framework.md` — update metric propagation description
- `evolution/docs/evolution/strategy_experiments.md` — update strategy aggregate description
- `evolution/docs/evolution/visualization.md` — describe how UI consumes entity declarations
- `evolution/docs/evolution/curriculum.md` — update prioritized reading list with Entity/Agent files
