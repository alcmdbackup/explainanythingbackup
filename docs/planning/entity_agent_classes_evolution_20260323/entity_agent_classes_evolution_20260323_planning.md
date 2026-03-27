# Entity Agent Classes Evolution Plan

## Background
The evolution pipeline codebase (186 files) uses a purely functional architecture with zero abstract classes. Entity concepts (runs, experiments, strategies, variants, invocations) are scattered across Zod schemas, metric registries, page-level column definitions, and service files. Agent concepts (generation, ranking) are plain functions called via an `executePhase()` wrapper. This leads to heavy duplication (30+ UUID checks, 5+ pagination implementations, 5+ archive patterns) and makes it hard to add new entity types or agents without copy-pasting across multiple files.

## Requirements (from GH Issue #805)

### Entity Class
- Abstract `Entity<TRow>` class with compile-time enforcement of all required declarations
- 6 entity types: run, strategy, experiment, variant, invocation, prompt (arena_topic removed — filtered view of prompt)
- Parent-child relationships declared on each entity with cascade behavior (delete/nullify/restrict)
- Parent entities own metric propagation rules (not child); same child metric supports multiple aggregation methods
- Metrics across 3 lifecycle phases: duringExecution, atFinalization, atPropagation
- Generic CRUD on base class: list (with pagination/filtering), getById, executeAction
- Entity logging: createLogger auto-resolves ancestor FKs by walking parents; logQueryColumn enables hierarchical log queries
- Data declarations only — no React components in entity classes

### Actions (list view only, no detail page actions)
- Three distinct mutation patterns: rename (inline single-field), edit (multi-field form dialog), create (form dialog)
- Rename is distinct from edit — rename changes the name column only, edit handles other properties
- Standardize naming column to `name` across all entities (migrate prompts.title → name)
- Standard action set: rename, edit, archive, unarchive, delete, cancel/kill (per entity)
- Base class handles rename/archive/delete generically; subclasses override for entity-specific actions (cancel, kill, unarchive)
- Delete checks cascade: 'restrict' children before allowing

### Agent Class
- Abstract `Agent<TInput, TOutput>` class with template method pattern
- Base `run()` method handles: invocation creation, cost snapshot, budget error handling, invocation update, logging
- Subclass implements `execute()` with the actual pipeline work
- Agent invocations are first-class entities in the registry (InvocationEntity)
- BudgetExceededWithPartialResults must be checked before BudgetExceededError (inheritance order)

### Approach
- Big-bang replacement of METRIC_REGISTRY, SHARED_PROPAGATION_DEFS, scattered column/tab/action defs
- Phase 0 DB migration (prompts.title → name) before any class work

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
  // Entities pick metrics from the central METRIC_CATALOG (which defines name, label,
  // category, formatter, description, timing phase). Each entity declares which catalog
  // metrics it uses and adds entity-specific behavior (compute functions for execution/
  // finalization, or aggregation rules for propagation).
  //
  // Three lifecycle phases:
  //   duringExecution — computed per-iteration while pipeline runs (e.g. cost)
  //   atFinalization  — computed once when a run completes (e.g. winner_elo)
  //   atPropagation   — aggregated FROM child entities (e.g. strategy.total_cost = sum of run.cost)
  //
  // Parent entities own their propagation rules (not the child).
  // Propagation metrics override name/label from catalog since they're derived
  // (e.g. catalog.winner_elo → entity metric named 'avg_final_elo').
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
  //   Declares which DB column holds the name (standardized to 'name' across all entities).
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
      // The actual enforcement is DB-level RESTRICT constraints on FKs.
      // This app-level pre-check gives a user-friendly error message before
      // the DB rejects the delete. Even if a race condition creates a child
      // between check and delete, the DB RESTRICT will catch it safely.
      for (const child of this.children) {
        if (child.cascade === 'restrict') {
          const { count } = await db.from(getEntity(child.childType).table)
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

### Metric Catalog (Central Definition)

```typescript
// evolution/src/lib/core/metricCatalog.ts
//
// Single source of truth for metric DEFINITIONS. Defines what metrics exist,
// their display properties, and which lifecycle phase they belong to.
// Entities reference catalog entries and add entity-specific behavior
// (compute functions, aggregation rules).
//
// This prevents duplicate/inconsistent metric definitions across entities.
// Adding a new metric = add it to the catalog + reference it from an entity.

interface CatalogMetricDef {
  name: string;
  label: string;
  category: 'cost' | 'rating' | 'match' | 'count';
  formatter: 'cost' | 'costDetailed' | 'elo' | 'score' | 'percent' | 'integer';
  // Timing uses snake_case to match DB values in writeMetrics.ts validation
  timing: 'during_execution' | 'at_finalization' | 'at_propagation';
  description: string;
  listView?: boolean;  // Show in list table columns
}

export const METRIC_CATALOG = {
  // === Execution-phase metrics ===
  cost:            { name: 'cost', label: 'Cost', category: 'cost', formatter: 'cost',
                     timing: 'during_execution', listView: true,
                     description: 'Total LLM spend for this entity' },

  // === Finalization-phase metrics ===
  winner_elo:      { name: 'winner_elo', label: 'Winner Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_finalization',
                     description: 'Elo of the highest-rated variant' },
  median_elo:      { name: 'median_elo', label: 'Median Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_finalization',
                     description: '50th percentile Elo across all variants' },
  p90_elo:         { name: 'p90_elo', label: 'P90 Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_finalization',
                     description: '90th percentile Elo across all variants' },
  max_elo:         { name: 'max_elo', label: 'Max Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_finalization', listView: true,
                     description: 'Highest Elo in the run' },
  total_matches:   { name: 'total_matches', label: 'Matches', category: 'match', formatter: 'integer',
                     timing: 'at_finalization',
                     description: 'Total pairwise comparisons performed' },
  decisive_rate:   { name: 'decisive_rate', label: 'Decisive Rate', category: 'match', formatter: 'percent',
                     timing: 'at_finalization', listView: true,
                     description: 'Fraction of matches with confidence > 0.6' },
  variant_count:   { name: 'variant_count', label: 'Variants', category: 'count', formatter: 'integer',
                     timing: 'at_finalization', listView: true,
                     description: 'Number of variants produced' },
  best_variant_elo:{ name: 'best_variant_elo', label: 'Best Variant Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_finalization',
                     description: 'Highest Elo among variants produced by this invocation' },
  avg_variant_elo: { name: 'avg_variant_elo', label: 'Avg Variant Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_finalization',
                     description: 'Average Elo of variants produced by this invocation' },

  // === Propagation-phase metrics (derived — entities override name/label) ===
  run_count:       { name: 'run_count', label: 'Runs', category: 'count', formatter: 'integer',
                     timing: 'at_propagation', listView: true,
                     description: 'Number of completed child runs' },
  total_cost:      { name: 'total_cost', label: 'Total Cost', category: 'cost', formatter: 'cost',
                     timing: 'at_propagation', listView: true,
                     description: 'Sum of cost across all child runs' },
  avg_cost_per_run:{ name: 'avg_cost_per_run', label: 'Avg Cost/Run', category: 'cost', formatter: 'cost',
                     timing: 'at_propagation',
                     description: 'Average cost per child run' },
  avg_final_elo:   { name: 'avg_final_elo', label: 'Avg Winner Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_propagation', listView: true,
                     description: 'Bootstrap mean of winner_elo across child runs' },
  best_final_elo:  { name: 'best_final_elo', label: 'Best Winner Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_propagation', listView: true,
                     description: 'Max winner_elo across child runs' },
  worst_final_elo: { name: 'worst_final_elo', label: 'Worst Winner Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_propagation',
                     description: 'Min winner_elo across child runs' },
  avg_median_elo:  { name: 'avg_median_elo', label: 'Avg Median Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_propagation',
                     description: 'Bootstrap mean of median_elo across child runs' },
  avg_p90_elo:     { name: 'avg_p90_elo', label: 'Avg P90 Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_propagation',
                     description: 'Bootstrap mean of p90_elo across child runs' },
  best_max_elo:    { name: 'best_max_elo', label: 'Best Max Elo', category: 'rating', formatter: 'elo',
                     timing: 'at_propagation',
                     description: 'Max of max_elo across child runs' },
  avg_matches_per_run: { name: 'avg_matches_per_run', label: 'Avg Matches/Run', category: 'match', formatter: 'integer',
                     timing: 'at_propagation',
                     description: 'Average total_matches per child run' },
  avg_decisive_rate: { name: 'avg_decisive_rate', label: 'Avg Decisive Rate', category: 'match', formatter: 'percent',
                     timing: 'at_propagation',
                     description: 'Bootstrap mean of decisive_rate across child runs' },
  total_variant_count: { name: 'total_variant_count', label: 'Total Variants', category: 'count', formatter: 'integer',
                     timing: 'at_propagation',
                     description: 'Sum of variant_count across child runs' },
  avg_variant_count: { name: 'avg_variant_count', label: 'Avg Variants/Run', category: 'count', formatter: 'integer',
                     timing: 'at_propagation',
                     description: 'Average variant_count per child run' },
} as const satisfies Record<string, CatalogMetricDef>;
```

Entities reference catalog entries via spread + entity-specific additions:

```typescript
// RunEntity grabs catalog entries and adds compute functions
readonly metrics = {
  duringExecution: [
    { ...METRIC_CATALOG.cost, compute: (ctx) => ctx.costTracker.getTotalSpent() },
  ],
  atFinalization: [
    { ...METRIC_CATALOG.winner_elo, compute: (ctx) => computeWinnerElo(ctx) },
    { ...METRIC_CATALOG.median_elo, compute: (ctx) => computeMedianElo(ctx) },
    // ...
  ],
  atPropagation: [],
};

// StrategyEntity grabs catalog entries and adds aggregation rules
readonly metrics = {
  duringExecution: [],
  atFinalization: [],
  atPropagation: [
    // Same catalog metric, different aggregation methods
    { ...METRIC_CATALOG.avg_final_elo,
      sourceEntity: 'run', sourceMetric: 'winner_elo',
      aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
    { ...METRIC_CATALOG.best_final_elo,
      sourceEntity: 'run', sourceMetric: 'winner_elo',
      aggregate: aggregateMax, aggregationMethod: 'max' },
    // ...
  ],
};
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

  // Metrics use METRIC_CATALOG spread pattern for consistency
  readonly metrics = {
    duringExecution: [
      { ...METRIC_CATALOG.cost, compute: (ctx) => ctx.costTracker.getTotalSpent() },
    ],
    atFinalization: [
      { ...METRIC_CATALOG.winner_elo, compute: (ctx) => computeWinnerElo(ctx) },
      { ...METRIC_CATALOG.median_elo, compute: (ctx) => computeMedianElo(ctx) },
      { ...METRIC_CATALOG.p90_elo, compute: (ctx) => computeP90Elo(ctx) },
      { ...METRIC_CATALOG.max_elo, compute: (ctx) => computeMaxElo(ctx) },
      { ...METRIC_CATALOG.total_matches, compute: (ctx) => ctx.matchHistory.length },
      { ...METRIC_CATALOG.decisive_rate, compute: (ctx) => computeDecisiveRate(ctx) },
      { ...METRIC_CATALOG.variant_count, compute: (ctx) => ctx.pool.length },
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
      // Cost aggregations (spread from METRIC_CATALOG + add aggregation rules)
      { ...METRIC_CATALOG.run_count,
        sourceEntity: 'run', sourceMetric: 'cost',
        aggregate: aggregateCount, aggregationMethod: 'count' },
      { ...METRIC_CATALOG.total_cost,
        sourceEntity: 'run', sourceMetric: 'cost',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_cost_per_run,
        sourceEntity: 'run', sourceMetric: 'cost',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },

      // Elo aggregations — SAME child metric (winner_elo) with DIFFERENT aggregation methods
      { ...METRIC_CATALOG.avg_final_elo,
        sourceEntity: 'run', sourceMetric: 'winner_elo',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { ...METRIC_CATALOG.best_final_elo,
        sourceEntity: 'run', sourceMetric: 'winner_elo',
        aggregate: aggregateMax, aggregationMethod: 'max' },
      { ...METRIC_CATALOG.worst_final_elo,
        sourceEntity: 'run', sourceMetric: 'winner_elo',
        aggregate: aggregateMin, aggregationMethod: 'min' },

      // Percentile Elo aggregations — DIFFERENT child metrics, same aggregation
      { ...METRIC_CATALOG.avg_median_elo,
        sourceEntity: 'run', sourceMetric: 'median_elo',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { ...METRIC_CATALOG.avg_p90_elo,
        sourceEntity: 'run', sourceMetric: 'p90_elo',
        aggregate: aggregateBootstrapMean, aggregationMethod: 'bootstrap_mean' },
      { ...METRIC_CATALOG.best_max_elo,
        sourceEntity: 'run', sourceMetric: 'max_elo',
        aggregate: aggregateMax, aggregationMethod: 'max' },

      // Match and variant count aggregations
      { ...METRIC_CATALOG.total_matches, name: 'total_matches',
        sourceEntity: 'run', sourceMetric: 'total_matches',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_matches_per_run,
        sourceEntity: 'run', sourceMetric: 'total_matches',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.avg_decisive_rate,
        sourceEntity: 'run', sourceMetric: 'decisive_rate',
        aggregate: aggregateAvg, aggregationMethod: 'avg' },
      { ...METRIC_CATALOG.total_variant_count,
        sourceEntity: 'run', sourceMetric: 'variant_count',
        aggregate: aggregateSum, aggregationMethod: 'sum' },
      { ...METRIC_CATALOG.avg_variant_count,
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
| **Prompt** | Rename, Edit, Archive, Unarchive, Delete | Yes (form) | `name` | Yes (prompt text) |
| **Experiment** | Rename, Cancel, Archive, Unarchive, Delete | No† | `name` | No |
| **Run** | Kill, Archive, Unarchive, Delete | No | — | No |
| **Variant** | — | No | — | No |
| **Invocation** | — | No | — | No |

*Prompt DB column `title` will be renamed to `name` via migration for consistency across all entities.
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
//
// CIRCULAR DEPENDENCY PREVENTION:
// Entity base class needs to look up other entities (for delete restrict checks,
// metric propagation). But the registry instantiates entity subclasses which extend Entity.
// Solution: lazy initialization. Entity base class accesses registry via a getter function,
// not a direct import. The registry module exports the getter, and the Entity module
// imports only the getter type (no circular import at module load time).

// 6 entity types (arena_topic removed — arena pages are a filtered view of prompts)
type EntityType = 'run' | 'invocation' | 'variant' | 'strategy' | 'experiment' | 'prompt';

// Registry populated at module load, after all subclass modules are imported
let _registry: Record<EntityType, Entity<any>> | null = null;

function initRegistry(): void {
  _registry = {
    run: new RunEntity(),
    strategy: new StrategyEntity(),
    experiment: new ExperimentEntity(),
    variant: new VariantEntity(),
    invocation: new InvocationEntity(),
    prompt: new PromptEntity(),
  };
  validateEntityRegistry(_registry);  // Check duplicate metric names, source metric refs
}

// Getter used by Entity base class — lazy init on first access
export function getEntity(type: EntityType): Entity<any> {
  if (!_registry) initRegistry();
  return _registry![type];
}

export function getEntityMetrics(type: EntityType): EntityMetricRegistry {
  return getEntity(type).metrics;
}
```

**EntityType reconciliation:**
The plan defines ONE canonical `EntityType` union (6 values) in `core/types.ts`. This replaces:
- `metrics/types.ts` ENTITY_TYPES (7 values including arena_topic) — deleted
- `createEntityLogger.ts` EntityType (4 values: run, invocation, experiment, strategy) — expanded to 6

For logging, all 6 entity types can create loggers. The `evolution_logs` table already has
nullable `run_id`, `experiment_id`, `strategy_id` columns. Entities without a matching ancestor
column (variant, prompt) simply don't populate those columns — the logger uses `entity_type` +
`entity_id` for direct entity log queries, and only populates ancestor FK columns that exist
in the table. No schema change needed.

**CostTracker interface note:**
The Agent base class uses `V2CostTracker` (from `pipeline/infra/trackBudget.ts`) because only V2
pipeline agents (GenerationAgent, RankingAgent) are in scope. The legacy `CostTracker` interface
in `types.ts` is for V1 agents that are dead code. The Agent class does NOT need to support both
interfaces — V1 agents will not get Agent subclasses.

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

### Phase 0: DB Migration
**Migration A:** Rename `evolution_prompts.title` → `evolution_prompts.name` for consistency.
All entities use `name` as the standard naming column. Update all code references (`title` → `name`
in Zod schemas, server actions, UI components, arena pages, test helpers including `createTestPrompt()`).

**Migration B:** Remove `arena_topic` from EntityType.
- Update `evolution_metrics` CHECK constraint to remove `arena_topic` from allowed entity_type values
- Delete or migrate any existing `evolution_metrics` rows with `entity_type = 'arena_topic'` (likely none, since arena_topic has no metrics defined in current METRIC_REGISTRY)
- Update `ENTITY_TYPES` constant in `metrics/types.ts` (6 values, removing `arena_topic`)
- Update `evolution_logs` CHECK constraint if `arena_topic` was an allowed entity_type
- Arena UI pages continue to work — they query `evolution_prompts` + `evolution_variants` directly, not via EntityType

**Affected test files:**
- `evolution/src/testing/evolution-test-helpers.ts` — `createTestPrompt()` uses `title` field, must change to `name`
- `evolution/src/testing/schema-fixtures.ts` — `createValidPromptInsert()` uses `title` field (confirmed), must change to `name`
- `evolution/src/lib/metrics/registry.test.ts` — tests `arena_topic` entity type assertions, must be removed

### Phase 1: Core Abstract Classes
**Files created:**
- `evolution/src/lib/core/Entity.ts` — abstract Entity class with relationships, metrics, views, generic CRUD
- `evolution/src/lib/core/Agent.ts` — abstract Agent class with run()/execute() template method
- `evolution/src/lib/core/types.ts` — shared types (ParentRelation, ChildRelation, AgentContext, AgentResult, etc.)
- `evolution/src/lib/core/metricCatalog.ts` — central metric definitions (name, label, category, formatter, timing, description)
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
- `executePhase()` function in `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (ceremony moves into Agent.run())
- Manual createInvocation/updateInvocation calls in the orchestrator (same file)

### Phase 4: Wire UI to Entity Registry
**Files modified:**
- Entity list pages consume `entity.listColumns` and `entity.listFilters` from registry
- Entity detail pages consume `entity.detailTabs` and `entity.detailLinks()` from registry
- `EntityMetricsTab` reads metrics from `entity.metrics` instead of METRIC_REGISTRY
- `LogsTab` uses entity relationships to determine ancestor columns

### Phase 5: Wire Metrics and Logs to Entity Relationships

#### Metric Migration Detail

**What stays the same:**
- `evolution_metrics` DB table — unchanged
- Aggregation functions (`aggregateSum`, `aggregateBootstrapMean`, etc.) — stay as shared utilities in `propagation.ts`
- 3 lifecycle phases (duringExecution, atFinalization, atPropagation) — same concept
- Dynamic `agentCost:*` metrics — still bypass registry, validated by prefix
- Upsert on `(entity_type, entity_id, metric_name)` — unchanged
- Bootstrap CI computation — unchanged
- Batch reading with 100-entity chunking — unchanged

**What changes:**

| File | Change | Detail |
|------|--------|--------|
| `evolution/src/lib/metrics/registry.ts` | **Deleted** | Central METRIC_REGISTRY replaced by METRIC_CATALOG (definitions) + entity classes (usage). Lookup functions (`getListViewMetrics`, `getMetricDef`, `getAllMetricDefs`, `isValidMetricName`) move to `entityRegistry.ts`, reading from `getEntity(type).metrics` |
| `evolution/src/lib/core/metricCatalog.ts` | **Created** | Central catalog of metric definitions (name, label, category, formatter, timing, description). Entities spread catalog entries and add compute/aggregation behavior |
| `evolution/src/lib/metrics/computations/propagation.ts` | **Modified** | `SHARED_PROPAGATION_DEFS` deleted (moves to StrategyEntity/ExperimentEntity). Aggregate functions (`aggregateSum`, `aggregateAvg`, `aggregateMax`, `aggregateMin`, `aggregateCount`, `aggregateBootstrapMean`) stay as shared utilities |
| `evolution/src/lib/metrics/writeMetrics.ts` | **Modified** | `validateTiming()` reads from `getEntity(entityType).metrics` instead of `METRIC_REGISTRY[entityType]`. Same validation logic: each metric belongs to exactly one timing phase; dynamic metrics bypass via prefix check |
| `evolution/src/lib/metrics/recomputeMetrics.ts` | **Modified** | `recomputeStaleMetrics()` uses `getEntity(entityType).metrics.atPropagation` instead of `METRIC_REGISTRY[entityType].atPropagation`. Propagation walks `entity.parents` generically instead of hardcoded strategy/experiment switch |
| `evolution/src/lib/metrics/metricColumns.tsx` | **Modified** | `getListViewMetrics(entityType)` reads from entity registry. `createMetricColumns()` and `createRunsMetricColumns()` unchanged in behavior |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts` | **Modified** | Per-iteration metric writes use `getEntity('run').metrics.duringExecution` instead of `METRIC_REGISTRY.run.duringExecution`. Dynamic `agentCost:*` writes unchanged |
| `evolution/src/lib/pipeline/finalize/persistRunResults.ts` | **Modified** | Finalization reads `getEntity(type).metrics.atFinalization` for run/invocation/variant metrics. Propagation replaced: instead of `propagateMetrics(db, 'strategy', strategyId)` with hardcoded column mapping, calls `getEntity('run').propagateMetricsToParents(runId, db)` which walks `this.parents` generically |

**Finalization ordering preserved (sequential dependencies):**
1. Run-level finalization metrics (winner_elo, median_elo, etc.)
2. Invocation-level finalization metrics (best_variant_elo, etc.) — requires fetching execution_detail
3. Variant-level finalization metrics (cost) — requires variant cost context
4. Propagation to parent entities (strategy, experiment) — requires child metrics to exist first

**Edge cases preserved:**
- Timing validation: write-time check prevents writing finalization metric during execution phase
- Null handling: finalization checks `!= null` before write; execution doesn't
- Empty source rows: propagation skips metrics with no source data
- Only completed runs: propagation filters `status = 'completed'`
- Import-time validation: entity registry validates no duplicate metric names and source metric existence (replaces `validateRegistry()`)
- CI handling: aggregated metrics carry CI bounds (nullable), stored as `ci_lower`/`ci_upper`

**Metrics per entity (complete inventory):**

| Entity | duringExecution | atFinalization | atPropagation |
|--------|----------------|----------------|---------------|
| **Run** | cost | winner_elo, median_elo, p90_elo, max_elo, total_matches, decisive_rate, variant_count | — |
| **Invocation** | — | best_variant_elo, avg_variant_elo, variant_count | — |
| **Variant** | — | cost | — |
| **Strategy** | — | — | 14 metrics aggregated from run (run_count, total_cost, avg_cost_per_run, avg/best/worst_final_elo, avg_median_elo, avg_p90_elo, best_max_elo, total_matches, avg_matches_per_run, avg_decisive_rate, total/avg_variant_count) |
| **Experiment** | — | — | Same 14 metrics as Strategy (both aggregate from runs identically) |
| **Prompt** | — | — | — |

#### Log Migration Detail

**Files modified:**
- `evolution/src/lib/pipeline/infra/createEntityLogger.ts` — refactor to use `entity.parents` to auto-resolve ancestor FKs instead of manually passing EntityLogContext. The logger walks the entity's parent chain to denormalize run_id, experiment_id, strategy_id at write time.
- `evolution/src/services/logActions.ts` — refactor `getEntityLogsAction` to use `entity.logQueryColumn` from the registry instead of a hardcoded switch statement mapping entity types to ancestor columns.
- `evolution/src/components/evolution/tabs/LogsTab.tsx` — consume `entity.logQueryColumn` from registry to build the WHERE clause. Remove hardcoded entity-type → column mapping.
- `evolution/src/services/experimentActions.ts` — replace manual `createEntityLogger({ entityType, entityId, experimentId })` calls with `entity.createLogger(id, db, row)` which auto-resolves ancestors.
- `evolution/src/services/strategyRegistryActions.ts` — same: replace manual logger creation with entity-based logger.
- `evolution/src/services/evolutionActions.ts` — same: replace manual logger creation with entity-based logger.
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — logger creation already moves into Agent.run() (Phase 3), which uses the entity's createLogger internally.

**How log propagation works with entities:**
1. **Write path:** `entity.createLogger(entityId, db, row)` walks `this.parents` to resolve ancestor FKs from the row. A run's logger auto-includes `strategy_id` and `experiment_id`. An invocation's logger inherits the run's ancestors.
2. **Read path:** `entity.logQueryColumn` tells LogsTab which column to filter. Strategy uses `WHERE strategy_id = X` which returns logs from the strategy itself + all its runs + all their invocations — because ancestor FKs were denormalized at write time.
3. **No JOINs needed** — denormalization happens once at write, reads are simple equality filters.

#### Test Migration (Phase 5)

| Test File | What Changes | Effort |
|-----------|-------------|--------|
| `registry.test.ts` | Import from entityRegistry instead of registry.ts. Direct METRIC_REGISTRY access → `getEntity(type).metrics`. Same validation assertions. | Low |
| `recomputeMetrics.test.ts` | Mock path changes from `./registry` to entity registry. Mock structure must match `getEntity(type).metrics` shape. | Medium |
| `writeMetrics.test.ts` | Update timing validation to read from entity registry. | Low |
| `executePhase.test.ts` | **Deleted** — executePhase() removed in Phase 3. Test coverage moves to Agent.test.ts which tests the same ceremony (budget errors, cost tracking, invocation updates). | Phase 3 |
| `trackInvocations.test.ts` | No registry dependency — unchanged. | None |

### Phase 6: Cleanup
- Remove `executePhase()` function
- Remove scattered column/tab definitions from page files
- Update barrel exports (4 index.ts files)
- Delete empty scaffold directories (`agents/`, `v2/`) if no longer needed

## Testing

### Agent Mock Strategy for runIterationLoop.test.ts
The current test mocks `createInvocation`, `updateInvocation`, and calls `executePhase` directly.
After migration, tests will:
1. Create concrete agent instances (GenerationAgent, RankingAgent) with mocked `execute()` methods
2. Mock the Supabase client (same `makeMockDb` pattern as today)
3. Assert on `Agent.run()` return values (AgentResult) instead of PhaseResult
4. Verify invocation creation/update via the mock DB chain (same assertions, different call path)

```typescript
// Example: mock GenerationAgent for testing
class MockGenerationAgent extends GenerationAgent {
  async execute(input: GenerationInput, ctx: AgentContext): Promise<Variant[]> {
    return [createTestVariant()];  // Return known test variants
  }
}
// The run() ceremony (invocation creation, cost tracking) is tested in Agent.test.ts
// The orchestrator test only needs to verify it handles AgentResult correctly
```

### Unit Tests (new)
- `Entity.test.ts` — abstract enforcement (compile-time), generic list/getById/archive, propagateMetricsToParents, createLogger ancestor FK resolution
- `Agent.test.ts` — run() ceremony, budget error handling (BudgetExceededWithPartialResults before BudgetExceededError), invocation creation/update, logging. Replaces `executePhase.test.ts`.
- `metricCatalog.test.ts` — validate catalog entries have correct timing, no duplicate names
- One test per entity subclass — verify all required fields are declared, metrics reference valid catalog entries, relationships are consistent (parent FK columns exist on table)
- One test per agent subclass — verify execute() is called with correct args, result is wrapped correctly

### Existing Tests (modified)
- `runIterationLoop.test.ts` — replace executePhase mocking with Agent mock subclasses (see strategy above)
- `generateVariants.test.ts` — unchanged (tests the inner function, not the Agent wrapper)
- `rankVariants.test.ts` — unchanged (tests the inner function, not the Agent wrapper)
- `registry.test.ts` — rewrite: import from entityRegistry instead of registry.ts, remove arena_topic assertions
- `recomputeMetrics.test.ts` — update mock from `jest.mock('./registry')` to mock `getEntity()` returning entity with metrics
- `executePhase.test.ts` — **deleted** (coverage moves to Agent.test.ts)
- `evolution-test-helpers.ts` — update `createTestPrompt()` title→name
- Service action tests that reference METRIC_REGISTRY — update to use entity registry

### Manual Verification
- Admin UI list pages render correct columns from entity declarations
- Admin UI detail pages render correct tabs from entity declarations
- Metric propagation still works (create experiment → run → verify strategy metrics update)
- Budget error handling still works (set low budget → verify partial results returned)

## Rollback Plan
This is a big-bang replacement. If a phase breaks:

- **Phase 0 (DB migration)**: Standard Supabase migration rollback (reverse migration file).
- **Phase 1-2 (new files only)**: No existing code changed yet — just delete the new files.
- **Phase 3 (Agent subclasses)**: Revert runIterationLoop.ts to use executePhase() again.
  Agent subclasses and executePhase can coexist temporarily since they're independent code paths.
- **Phase 4-5 (wiring)**: This is the point of no return. If metric propagation or UI breaks:
  1. Re-add METRIC_REGISTRY as a thin adapter that reads from ENTITY_REGISTRY (forward-compatible shim)
  2. UI pages can fall back to hardcoded column defs while entity registry is debugged
  3. Metric writes are idempotent (upsert) — re-running propagation fixes any partial state
- **Full revert**: Git revert the branch. All changes are on a feature branch, main is untouched.

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

## Implementation Notes (from plan review)

**Metric propagation is independent per parent:** RunEntity has two parents (strategy, experiment).
`propagateMetricsToParents()` propagates to each independently — not in a chain. Both strategy
and experiment get their metrics directly from the run's child metrics. No parent-to-grandparent chain.

**Metric propagation is triggered at finalization, not per-agent-call:** `Agent.run()` handles
invocation ceremony only. Propagation is triggered by `persistRunResults.ts` at run finalization
after all metrics are written. This ensures child metrics exist before parent aggregation runs.

**Entity subclass tests are pure declaration checks:** They verify abstract fields are populated
(type, table, metrics, listColumns, etc.), metric names match catalog entries, and parent/child
relationships are consistent (e.g. RunEntity.parents includes 'strategy' and StrategyEntity.children
includes 'run' with matching foreignKey). No DB mocking needed.

**Phase 0 migration + test helper changes must ship in the same commit** to avoid a window where
tests reference `title` but the DB column is `name`.

**executeAction rename validation:** Implementation should validate `payload.name` is non-empty
and within DB column length limits before executing the update.

**Verify FK RESTRICT constraints exist:** During Phase 0 implementation, verify that
`evolution_runs.strategy_id` has an actual FK constraint with ON DELETE RESTRICT (not just an index).
If missing, add the constraint in the migration. The app-level pre-check in executeAction is a
user-friendly error message; DB RESTRICT is the actual safety net.
