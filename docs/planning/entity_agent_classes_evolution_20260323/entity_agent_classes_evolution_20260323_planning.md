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
  // Parents: entities this type belongs to (FK on this table pointing up)
  abstract readonly parents: ParentRelation[];
  // Children: entities that belong to this type (FK on child table pointing here)
  abstract readonly children: ChildRelation[];

  // === METRICS ===
  // Each entity declares its own metrics across 3 lifecycle phases:
  //   duringExecution — computed per-iteration while pipeline runs (e.g. cost)
  //   atFinalization  — computed once when a run completes (e.g. winner_elo)
  //   atPropagation   — aggregated FROM child entities (e.g. strategy.total_cost = sum of run.cost)
  // Parent entities own their propagation rules (not the child).
  // This keeps each entity self-contained: read StrategyEntity to see all strategy metrics.
  abstract readonly metrics: EntityMetricRegistry;

  // === LIST VIEW (data declarations only, no React) ===
  abstract readonly listColumns: ColumnDef[];
  abstract readonly listFilters: FilterDef[];
  abstract readonly actions: EntityAction<TRow>[];  // All row actions (list-only, no detail page actions)
  readonly defaultSort: SortDef = { column: 'created_at', dir: 'desc' };
  readonly listSelect: string = '*';

  // === CREATE / RENAME / EDIT ===
  //
  // Three distinct mutation patterns, each optional:
  //
  // RENAME — quick inline single-field name change, no dialog.
  //   Appears as a "Rename" action in the list row menu.
  //   UI: inline text input replaces the name cell, save on Enter/blur.
  //   Declares which DB column holds the name (e.g. 'name', 'title').
  readonly renameField?: string;
  //
  // EDIT — opens a multi-field form dialog for updating entity properties.
  //   Appears as an "Edit" action in the list row menu.
  //   UI: FormDialog with pre-populated fields from the current row.
  //   Used for properties beyond the name (description, config, prompt text).
  readonly editConfig?: {
    fields: FieldDef[];         // Editable fields (NOT including the name — that's rename)
    defaults: (row: TRow) => Record<string, unknown>;  // Pre-populate from row
  };
  //
  // CREATE — renders "New X" button on list page header, opens form dialog.
  //   Separate from edit: creates a new row rather than modifying existing.
  readonly createConfig?: {
    label: string;              // "New Strategy", "New Prompt"
    fields: FieldDef[];         // Form fields for creation dialog
  };

  // === DETAIL VIEW (data declarations only, no React) ===
  abstract readonly detailTabs: TabDef[];
  abstract detailLinks(row: TRow): EntityLink[];
  readonly statusField?: string;

  // === LOG QUERY COLUMN ===
  // Which column on evolution_logs to filter by when showing "logs for this entity".
  // For entities that are ancestors (strategy, experiment, run), the LogsTab queries
  // WHERE {logQueryColumn} = entityId, which returns this entity's logs PLUS all
  // descendant logs (because descendants denormalize ancestor FKs at write time).
  // For leaf entities (invocation), it queries WHERE entity_type = X AND entity_id = Y.
  readonly logQueryColumn?: string;  // e.g. 'run_id', 'strategy_id', 'experiment_id'

  // === SCHEMA ===
  abstract readonly insertSchema?: ZodSchema;

  // === ARCHIVE ===
  readonly archiveColumn?: string;    // 'status' or 'archived_at'
  readonly archiveValue?: unknown;    // 'archived' or ISO timestamp

  // === LOGGING (provided by base class) ===
  // Creates a logger that auto-populates ancestor FKs by walking this.parents.
  // E.g. for a run, resolves strategy_id and experiment_id from the row,
  // so logs written as entity_type='run' also carry strategy_id and experiment_id.
  // This enables hierarchical log queries: "all logs for this strategy" returns
  // logs from every run + invocation that belongs to that strategy.
  createLogger(entityId: string, db: SupabaseClient, row?: TRow): EntityLogger {
    const ancestorFKs: Record<string, string> = {};

    // Build ancestor context from the row (if provided) or will be resolved lazily
    for (const parent of this.parents) {
      const value = row?.[parent.foreignKey as keyof TRow];
      if (value) ancestorFKs[`${parent.parentType}_id`] = String(value);
    }

    return createEntityLogger({
      entityType: this.type,
      entityId,
      ...ancestorFKs,  // e.g. { strategy_id: '...', experiment_id: '...' }
    }, db);
  }

  // === GENERIC CRUD (provided by base class) ===
  async list(filters: ListFilters, db: SupabaseClient): Promise<PaginatedResult<TRow>> {
    // Uses this.table, this.listSelect, this.defaultSort
    // Applies this.listFilters constraints
    // Handles pagination (limit/offset/range)
  }

  async getById(id: string, db: SupabaseClient): Promise<TRow | null> {
    // Uses this.table, validates UUID
  }

  // Generic action executor — handles rename/archive/delete; subclasses override for custom actions
  async executeAction(key: string, id: string, db: SupabaseClient, payload?: Record<string, unknown>): Promise<void> {
    if (key === 'rename' && this.renameField && payload?.name) {
      await db.from(this.table)
        .update({ [this.renameField]: payload.name })
        .eq('id', id);
      return;
    }
    if (key === 'archive' && this.archiveColumn) {
      await db.from(this.table)
        .update({ [this.archiveColumn]: this.archiveValue })
        .eq('id', id);
      return;
    }
    if (key === 'delete') {
      // Check children with cascade: 'restrict' before deleting
      for (const child of this.children) {
        if (child.cascade === 'restrict') {
          const { count } = await db.from(ENTITY_REGISTRY[child.childType].table)
            .select('id', { count: 'exact', head: true })
            .eq(child.foreignKey, id);
          if (count && count > 0) {
            throw new Error(
              `Cannot delete ${this.type}: ${count} ${child.childType}(s) reference it. Archive instead.`
            );
          }
        }
      }
      await db.from(this.table).delete().eq('id', id);
      return;
    }
    throw new Error(`Unknown action '${key}' on ${this.type}`);
  }

  // === METRIC PROPAGATION (provided by base class) ===
  // After a child entity finalizes, call this on the child to propagate metrics up.
  // Walks this.parents, looks up each parent entity's metrics.atPropagation defs
  // where sourceEntity matches this.type, fetches child metric rows, runs aggregate,
  // and writes results to evolution_metrics for the parent.
  async propagateMetricsToParents(
    entityId: string,
    db: SupabaseClient,
  ): Promise<void> {
    for (const parent of this.parents) {
      // Read the FK value to find the parent entity ID
      const row = await db.from(this.table).select(parent.foreignKey).eq('id', entityId).single();
      const parentId = row.data?.[parent.foreignKey];
      if (!parentId) continue;  // nullable FK (e.g. run without experiment)

      // Look up parent entity's propagation defs that source from this entity type
      const parentEntity = ENTITY_REGISTRY[parent.parentType];
      const propagationDefs = parentEntity.metrics.atPropagation
        .filter(def => def.sourceEntity === this.type);

      for (const def of propagationDefs) {
        // Fetch all child metric rows for this parent
        const childIds = await db.from(this.table)
          .select('id')
          .eq(parent.foreignKey, parentId);
        const metricRows = await getMetricsForEntities(
          db, this.type, childIds.data?.map(r => r.id) ?? [], def.sourceMetric,
        );
        // Aggregate and write to parent
        const aggregated = def.aggregate(metricRows);
        await writeMetric(db, parent.parentType, parentId, def.name, aggregated);
      }
    }
  }

  async markParentMetricsStale(
    entityId: string,
    db: SupabaseClient,
  ): Promise<void> {
    for (const parent of this.parents) {
      const row = await db.from(this.table).select(parent.foreignKey).eq('id', entityId).single();
      const parentId = row.data?.[parent.foreignKey];
      if (!parentId) continue;

      // Mark all propagation metrics for this parent as stale
      const parentEntity = ENTITY_REGISTRY[parent.parentType];
      const metricNames = parentEntity.metrics.atPropagation
        .filter(def => def.sourceEntity === this.type)
        .map(def => def.name);
      if (metricNames.length > 0) {
        await db.from('evolution_metrics')
          .update({ stale: true, updated_at: new Date().toISOString() })
          .eq('entity_type', parent.parentType)
          .eq('entity_id', parentId)
          .in('metric_name', metricNames);
      }
    }
  }
}
```

### Relationship Types

```typescript
interface ParentRelation {
  parentType: EntityType;
  foreignKey: string;              // Column on THIS entity's table (e.g. 'strategy_id' on runs)
  // No propagation rules here — parent owns its own aggregation definitions
}

interface ChildRelation {
  childType: EntityType;
  foreignKey: string;              // Column on the CHILD's table (e.g. 'run_id' on variants)
  cascade: 'delete' | 'nullify' | 'restrict';
  // delete:   deleting parent automatically deletes children (DB CASCADE)
  // nullify:  deleting parent sets FK to NULL on children (DB SET NULL)
  // restrict: deleting parent is blocked if children exist (DB RESTRICT)
}

// Row-level actions on list view (no detail page actions — everything is on the list)
interface EntityAction<TRow> {
  key: string;                     // 'archive', 'delete', 'cancel', 'edit'
  label: string;                   // Display text
  danger?: boolean;                // Red styling for destructive actions
  confirm?: string;                // Confirmation dialog message
  visible?: (row: TRow) => boolean;   // Show/hide based on row state
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
  readonly logQueryColumn = 'run_id';

  readonly parents = [
    { parentType: 'strategy', foreignKey: 'strategy_id' },
    { parentType: 'experiment', foreignKey: 'experiment_id' },
  ];

  readonly children = [
    { childType: 'variant', foreignKey: 'run_id', cascade: 'delete' as const },
    { childType: 'invocation', foreignKey: 'run_id', cascade: 'delete' as const },
  ];

  readonly metrics = {
    duringExecution: [
      { name: 'cost', label: 'Cost', category: 'cost', formatter: 'cost',
        compute: (ctx) => ctx.costTracker.getTotalSpent() },
    ],
    atFinalization: [
      { name: 'winner_elo', label: 'Winner Elo', category: 'rating', formatter: 'elo',
        compute: (ctx) => computeWinnerElo(ctx) },
      { name: 'median_elo', label: 'Median Elo', category: 'rating', formatter: 'elo',
        compute: (ctx) => computeMedianElo(ctx) },
      { name: 'p90_elo', label: 'P90 Elo', category: 'rating', formatter: 'elo',
        compute: (ctx) => computeP90Elo(ctx) },
      { name: 'max_elo', label: 'Max Elo', category: 'rating', formatter: 'elo',
        compute: (ctx) => computeMaxElo(ctx) },
      { name: 'total_matches', label: 'Matches', category: 'match', formatter: 'integer',
        compute: (ctx) => ctx.matchHistory.length },
      { name: 'decisive_rate', label: 'Decisive Rate', category: 'match', formatter: 'percent',
        compute: (ctx) => computeDecisiveRate(ctx) },
      { name: 'variant_count', label: 'Variants', category: 'count', formatter: 'integer',
        compute: (ctx) => ctx.pool.length },
    ],
    atPropagation: [],
  };

  readonly listColumns = [
    { key: 'status', label: 'Status', formatter: 'statusBadge', sortable: true },
    { key: 'strategy_name', label: 'Strategy', formatter: 'text' },
    { key: 'iterations', label: 'Iterations', formatter: 'integer' },
  ];

  readonly listFilters = [
    { field: 'status', type: 'select', options: ['pending', 'running', 'completed', 'failed'] },
    { field: 'archived', type: 'toggle', label: 'Show archived' },
  ];

  readonly actions = [
    { key: 'cancel', label: 'Kill', danger: true,
      confirm: 'Kill this run?',
      visible: (row) => ['pending', 'claimed', 'running'].includes(row.status) },
    { key: 'archive', label: 'Archive',
      visible: (row) => ['completed', 'failed'].includes(row.status) && !row.archived },
    { key: 'unarchive', label: 'Unarchive',
      visible: (row) => row.archived === true },
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Delete this run and all its variants/invocations?',
      visible: (row) => ['completed', 'failed', 'cancelled'].includes(row.status) },
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

  async executeAction(key: string, id: string, db: SupabaseClient): Promise<void> {
    if (key === 'cancel') {
      await db.from(this.table)
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', id);
      return;
    }
    if (key === 'unarchive') {
      await db.from(this.table).update({ archived: false }).eq('id', id);
      return;
    }
    return super.executeAction(key, id, db);  // archive, delete handled by base
  }
}
```

```typescript
// evolution/src/lib/core/entities/StrategyEntity.ts
// Demonstrates: parent entity owning propagation rules with multiple aggregations
// from the same child metric (e.g. winner_elo → avg, best, worst)
class StrategyEntity extends Entity<EvolutionStrategyFullDb> {
  readonly type = 'strategy' as const;
  readonly table = 'evolution_strategies';
  readonly statusField = 'status';
  readonly archiveColumn = 'status';
  readonly archiveValue = 'archived';
  readonly logQueryColumn = 'strategy_id';

  // Rename: quick inline name change (no dialog)
  readonly renameField = 'name';

  // Edit: multi-field form dialog (description only — name is handled by rename)
  readonly editConfig = {
    fields: [
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
    defaults: (row) => ({ description: row.description }),
  };

  // Create: full form for new strategy
  readonly createConfig = {
    label: 'New Strategy',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'generationModel', label: 'Generation Model', type: 'text', required: true },
      { key: 'judgeModel', label: 'Judge Model', type: 'text', required: true },
      { key: 'iterations', label: 'Iterations', type: 'number', required: true },
      { key: 'budgetUsd', label: 'Budget (USD)', type: 'number' },
    ],
  };

  readonly parents = [];  // Root entity — no parents

  readonly children = [
    { childType: 'run', foreignKey: 'strategy_id', cascade: 'restrict' as const },
  ];

  // Strategy has NO execution or finalization metrics — only propagation.
  // Each atPropagation entry declares: "my metric X = aggregate(child.metric Y)"
  // The SAME child metric can appear multiple times with different aggregations.
  readonly metrics = {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [
      // Cost aggregations
      { name: 'run_count', label: 'Runs', category: 'count', formatter: 'integer', listView: true,
        sourceEntity: 'run', sourceMetric: 'cost',
        aggregate: aggregateCount, aggregationMethod: 'count' },
      { name: 'total_cost', label: 'Total Cost', category: 'cost', formatter: 'cost', listView: true,
        sourceEntity: 'run', sourceMetric: 'cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { name: 'avg_cost_per_run', label: 'Avg Cost/Run', category: 'cost', formatter: 'cost',
        sourceEntity: 'run', sourceMetric: 'cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },

      // Elo aggregations — SAME child metric (winner_elo) with DIFFERENT aggregation methods
      { name: 'avg_final_elo', label: 'Avg Winner Elo', category: 'rating', formatter: 'elo', listView: true,
        sourceEntity: 'run', sourceMetric: 'winner_elo',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { name: 'best_final_elo', label: 'Best Winner Elo', category: 'rating', formatter: 'elo',
        sourceEntity: 'run', sourceMetric: 'winner_elo',
        aggregate: aggregateMax, aggregationMethod: 'max' },
      { name: 'worst_final_elo', label: 'Worst Winner Elo', category: 'rating', formatter: 'elo',
        sourceEntity: 'run', sourceMetric: 'winner_elo',
        aggregate: aggregateMin, aggregationMethod: 'min' },

      // Percentile Elo aggregations — DIFFERENT child metrics, same aggregation
      { name: 'avg_median_elo', label: 'Avg Median Elo', category: 'rating', formatter: 'elo',
        sourceEntity: 'run', sourceMetric: 'median_elo',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { name: 'avg_p90_elo', label: 'Avg P90 Elo', category: 'rating', formatter: 'elo',
        sourceEntity: 'run', sourceMetric: 'p90_elo',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { name: 'best_max_elo', label: 'Best Max Elo', category: 'rating', formatter: 'elo',
        sourceEntity: 'run', sourceMetric: 'max_elo',
        aggregate: aggregateMax, aggregationMethod: 'max' },

      // Match and variant count aggregations
      { name: 'avg_matches_per_run', label: 'Avg Matches/Run', category: 'match', formatter: 'integer',
        sourceEntity: 'run', sourceMetric: 'total_matches',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { name: 'avg_decisive_rate', label: 'Avg Decisive Rate', category: 'match', formatter: 'percent',
        sourceEntity: 'run', sourceMetric: 'decisive_rate',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { name: 'total_variant_count', label: 'Total Variants', category: 'count', formatter: 'integer',
        sourceEntity: 'run', sourceMetric: 'variant_count',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { name: 'avg_variant_count', label: 'Avg Variants/Run', category: 'count', formatter: 'integer',
        sourceEntity: 'run', sourceMetric: 'variant_count',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
    ],
  };

  readonly listColumns = [
    { key: 'name', label: 'Name', formatter: 'text', sortable: true },
    { key: 'label', label: 'Config', formatter: 'text' },
    { key: 'status', label: 'Status', formatter: 'statusBadge' },
    { key: 'pipeline_type', label: 'Type', formatter: 'text' },
  ];

  readonly listFilters = [
    { field: 'status', type: 'select', options: ['active', 'archived'] },
    { field: 'pipeline_type', type: 'select', options: ['full', 'single'] },
  ];

  readonly actions = [
    { key: 'rename', label: 'Rename' },         // Inline single-field rename (uses renameField)
    { key: 'edit', label: 'Edit' },              // Opens form dialog (uses editConfig)
    { key: 'archive', label: 'Archive',
      confirm: 'Archive this strategy? It will be hidden from new experiments.',
      visible: (row) => row.status === 'active' },
    { key: 'unarchive', label: 'Unarchive',
      visible: (row) => row.status === 'archived' },
    { key: 'delete', label: 'Delete', danger: true,
      confirm: 'Delete this strategy? Only possible if no runs reference it.',
      visible: (row) => row.run_count === 0 },
  ];

  readonly detailTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
    { id: 'runs', label: 'Runs' },
    { id: 'logs', label: 'Logs' },
  ];

  detailLinks(_row: EvolutionStrategyFullDb): EntityLink[] {
    return [];
  }

  readonly insertSchema = evolutionStrategyInsertSchema;

  async executeAction(key: string, id: string, db: SupabaseClient): Promise<void> {
    if (key === 'unarchive') {
      await db.from(this.table).update({ status: 'active' }).eq('id', id);
      return;
    }
    return super.executeAction(key, id, db);
  }
}
```

### Action Summary Table

All actions are on the **list view only** (no detail page actions). Detail pages show
entity data, tabs, metrics, and cross-links — but actions live on the list.

| Entity | Actions | Create | Rename | Edit |
|--------|---------|--------|--------|------|
| **Strategy** | Rename, Edit, Archive, Unarchive, Delete | Yes (form) | `name` | Yes (description) |
| **Prompt** | Rename, Edit, Archive, Unarchive, Delete | Yes (form) | `title`* | Yes (prompt text) |
| **Experiment** | Rename, Cancel, Archive, Unarchive, Delete | No† | `name` | No |
| **Run** | Kill, Archive, Unarchive, Delete | No | — | No |
| **Variant** | — | No | — | No |
| **Invocation** | — | No | — | No |

*Prompt DB column is `title` but displayed as "Name" for consistency.
†Experiments use a dedicated 3-step wizard page, not a simple create form.

**6 entity types total** (arena_topic removed — arena pages are a filtered view of prompts).

**Rename vs Edit:**
- **Rename** — inline single-field name change, no dialog. Uses `renameField` to know which DB column.
  The UI replaces the name cell with a text input; save on Enter/blur.
- **Edit** — opens FormDialog with multiple fields. Uses `editConfig` for field definitions.
  Does NOT include the name field (that's what rename is for).
- Entities with `renameField` set get a "Rename" action automatically.
- Entities with `editConfig` set get an "Edit" action automatically.

**Visibility conditions:**
- Rename: always visible (if entity has renameField)
- Edit: always visible (if entity has editConfig)
- Archive: visible when status = 'active' (or not archived)
- Unarchive: visible when status = 'archived' (or archived = true)
- Delete: always visible on terminal entities; on strategy requires run_count = 0 (cascade: restrict)
- Cancel: visible when experiment status in draft/running
- Kill: visible when run status in pending/claimed/running

**Confirmation required (danger):** Kill, Delete, Cancel

Similar subclasses for: `ExperimentEntity`, `VariantEntity`, `InvocationEntity`, `PromptEntity`.

### Entity Registry

```typescript
// evolution/src/lib/core/entityRegistry.ts

// 6 entity types (arena_topic removed — arena pages are a filtered view of prompts)
type EntityType = 'run' | 'invocation' | 'variant' | 'strategy' | 'experiment' | 'prompt';

const ENTITY_REGISTRY: Record<EntityType, Entity<any>> = {
  run: new RunEntity(),
  strategy: new StrategyEntity(),
  experiment: new ExperimentEntity(),
  variant: new VariantEntity(),
  invocation: new InvocationEntity(),
  prompt: new PromptEntity(),
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

Note: ArenaTopicEntity removed — arena pages become a filtered view of PromptEntity
(prompts that have variants with `synced_to_arena = true`).

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
