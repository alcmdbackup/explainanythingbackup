// Abstract Entity base class: compile-time enforcement of entity declarations + generic CRUD.
// Subclasses must declare type, table, parents, children, metrics, views, and actions.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ZodSchema } from 'zod';
import { createEntityLogger, type EntityLogger } from '../pipeline/infra/createEntityLogger';
import type {
  EntityType, ParentRelation, ChildRelation, EntityAction,
  ColumnDef, FilterDef, SortDef, FieldDef, TabDef, EntityLink,
  EntityMetricRegistry, ListFilters, PaginatedResult,
} from './types';
import { writeMetric } from '../metrics/writeMetrics';
import { getMetricsForEntities } from '../metrics/readMetrics';

// Lazy import to break circular dependency: Entity → entityRegistry → entity subclasses → Entity
function getEntity(type: import('./types').EntityType) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./entityRegistry').getEntity(type) as Entity<unknown>;
}

// ─── Abstract Entity ─────────────────────────────────────────────

export abstract class Entity<TRow> {
  // === IDENTITY ===
  abstract readonly type: EntityType;
  abstract readonly table: string;

  // === RELATIONSHIPS ===
  abstract readonly parents: ParentRelation[];
  abstract readonly children: ChildRelation[];

  // === METRICS ===
  abstract readonly metrics: EntityMetricRegistry;

  // === LIST VIEW ===
  abstract readonly listColumns: ColumnDef[];
  abstract readonly listFilters: FilterDef[];
  abstract readonly actions: EntityAction<TRow>[];
  readonly defaultSort: SortDef = { column: 'created_at', dir: 'desc' };
  readonly listSelect: string = '*';

  // === CREATE / RENAME / EDIT ===
  readonly renameField?: string;
  readonly editConfig?: {
    fields: FieldDef[];
    defaults: (row: TRow) => Record<string, unknown>;
  };
  readonly createConfig?: {
    label: string;
    fields: FieldDef[];
  };

  // === DETAIL VIEW ===
  abstract readonly detailTabs: TabDef[];
  abstract detailLinks(row: TRow): EntityLink[];
  readonly statusField?: string;

  // === LOG QUERY COLUMN ===
  readonly logQueryColumn?: string;

  // === SCHEMA ===
  abstract readonly insertSchema?: ZodSchema;

  // (archive support removed — delete-only)

  // === LOGGING ===
  createLogger(entityId: string, db: SupabaseClient, row?: TRow): EntityLogger {
    const ancestorFKs: Record<string, string> = {};
    for (const parent of this.parents) {
      const value = row?.[parent.foreignKey as keyof TRow];
      if (value) ancestorFKs[`${parent.parentType}Id`] = String(value);
    }
    return createEntityLogger({
      entityType: this.type as 'run' | 'invocation' | 'experiment' | 'strategy',
      entityId,
      ...ancestorFKs,
    }, db);
  }

  // === GENERIC CRUD ===
  async list(filters: ListFilters, db: SupabaseClient): Promise<PaginatedResult<TRow>> {
    const sortCol = filters.sortBy ?? this.defaultSort.column;
    const sortDir = filters.sortDir ?? this.defaultSort.dir;

    let query = db
      .from(this.table)
      .select(this.listSelect, { count: 'exact' })
      .order(sortCol, { ascending: sortDir === 'asc' })
      .range(filters.offset, filters.offset + filters.limit - 1);

    if (filters.filters) {
      for (const [key, value] of Object.entries(filters.filters)) {
        if (value) query = query.eq(key, value);
      }
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { items: (data ?? []) as TRow[], total: count ?? 0 };
  }

  async getById(id: string, db: SupabaseClient): Promise<TRow | null> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) return null;

    const { data, error } = await db
      .from(this.table)
      .select('*')
      .eq('id', id)
      .single();

    if (error) return null;
    return data as TRow;
  }

  // === GENERIC ACTIONS ===
  async executeAction(
    key: string, id: string, db: SupabaseClient, payload?: Record<string, unknown>,
  ): Promise<void> {
    if (key === 'rename' && this.renameField && payload?.name) {
      await db.from(this.table)
        .update({ [this.renameField]: payload.name })
        .eq('id', id);
      return;
    }
    if (key === 'delete') {
      const visited = (payload?._visited as Set<string>) ?? new Set<string>();
      const selfKey = `${this.type}:${id}`;
      if (visited.has(selfKey)) return; // cycle/duplicate guard
      visited.add(selfKey);

      // 1. Mark parent metrics stale BEFORE deleting children (reads row while it still exists)
      if (!payload?._skipStaleMarking) {
        for (const parent of this.parents) {
          const row = await db.from(this.table).select(parent.foreignKey).eq('id', id).single();
          const parentId = (row.data as Record<string, unknown> | null)?.[parent.foreignKey] as string | undefined;
          if (parentId) {
            await db.from('evolution_metrics')
              .update({ stale: true, updated_at: new Date().toISOString() })
              .eq('entity_type', parent.parentType)
              .eq('entity_id', parentId);
          }
        }
      }

      // 2. Recursively delete all children (skip their stale-marking — they're being deleted)
      for (const child of this.children) {
        const childEntity = getEntity(child.childType);
        const { data: childRows } = await db.from(childEntity.table)
          .select('id').eq(child.foreignKey, id);
        for (const row of childRows ?? []) {
          await childEntity.executeAction('delete', row.id, db, {
            _visited: visited,
            _skipStaleMarking: true, // parent is being deleted, no point marking stale
          });
        }
      }

      // 3. Clean up this entity's own metrics + logs
      await db.from('evolution_metrics').delete()
        .eq('entity_type', this.type).eq('entity_id', id);
      if (this.logQueryColumn) {
        await db.from('evolution_logs').delete().eq(this.logQueryColumn, id);
      }

      // 4. Delete self
      // TODO: wrap steps 1-4 in a single Supabase RPC for transactional safety.
      // Currently each step is a separate request — if step 3 succeeds but step 4 fails,
      // orphaned metrics/logs are cleaned up but the entity remains. Supabase JS client
      // does not support multi-statement transactions; requires a server-side RPC function.
      await db.from(this.table).delete().eq('id', id);
      return;
    }
    throw new Error(`Unknown action '${key}' on ${this.type}`);
  }

  // === METRIC PROPAGATION ===
  async propagateMetricsToParents(entityId: string, db: SupabaseClient): Promise<void> {
    for (const parent of this.parents) {
      const row = await db.from(this.table).select(parent.foreignKey).eq('id', entityId).single();
      if (row.error) {
        console.warn(`[Entity.propagateMetrics] Failed to fetch parent FK for ${this.type}/${entityId}: ${row.error.message}`);
        continue;
      }
      const parentId = (row.data as unknown as Record<string, unknown> | null)?.[parent.foreignKey] as string | undefined;
      if (!parentId) continue;

      const parentEntity = getEntity(parent.parentType);
      const propagationDefs = parentEntity.metrics.atPropagation
        .filter(def => def.sourceEntity === this.type);

      for (const def of propagationDefs) {
        const childIds = await db.from(this.table)
          .select('id')
          .eq(parent.foreignKey, parentId);
        if (childIds.error) {
          console.warn(`[Entity.propagateMetrics] Failed to fetch child IDs for ${this.type}/${parentId}: ${childIds.error.message}`);
          continue;
        }
        const ids = childIds.data?.map((r: { id: string }) => r.id) ?? [];
        const metricsMap = await getMetricsForEntities(
          db, this.type as import('../metrics/types').EntityType, ids, [def.sourceMetric],
        );
        // Flatten all metric rows from all child entities
        const allRows: import('../metrics/types').MetricRow[] = [];
        for (const rows of metricsMap.values()) {
          allRows.push(...rows);
        }
        const aggregated = def.aggregate(allRows);
        const metricValue = typeof aggregated === 'number' ? aggregated : aggregated.value;
        const opts: Record<string, unknown> = { aggregation_method: def.aggregationMethod };
        if (typeof aggregated !== 'number') {
          if (aggregated.sigma != null) opts.sigma = aggregated.sigma;
          if (aggregated.ci?.[0] != null) opts.ci_lower = aggregated.ci[0];
          if (aggregated.ci?.[1] != null) opts.ci_upper = aggregated.ci[1];
          if (aggregated.n != null) opts.n = aggregated.n;
        }
        await writeMetric(
          db,
          parent.parentType as import('../metrics/types').EntityType,
          parentId!,
          def.name as import('../metrics/types').MetricName,
          metricValue,
          def.timing as import('../metrics/types').MetricTiming,
          opts as import('../metrics/writeMetrics').WriteMetricOpts,
        );
      }
    }
  }

  async markParentMetricsStale(entityId: string, db: SupabaseClient): Promise<void> {
    for (const parent of this.parents) {
      const row = await db.from(this.table).select(parent.foreignKey).eq('id', entityId).single();
      if (row.error) {
        console.warn(`[Entity.markStale] Failed to fetch parent FK for ${this.type}/${entityId}: ${row.error.message}`);
        continue;
      }
      const parentId = (row.data as unknown as Record<string, unknown> | null)?.[parent.foreignKey] as string | undefined;
      if (!parentId) continue;

      const parentEntity = getEntity(parent.parentType);
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
