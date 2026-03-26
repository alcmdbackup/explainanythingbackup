// Shared types for the entity/agent class system: relationships, actions, views, contexts, results.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityLogger } from '../pipeline/infra/createEntityLogger';
import type { V2CostTracker } from '../pipeline/infra/trackBudget';
import type { EvolutionConfig } from '../pipeline/infra/types';
import type { MetricValue } from '@evolution/experiments/evolution/experimentMetrics';

// ─── Re-exports from metrics/types (canonical source) ────────────
export type { MetricRow, ExecutionContext, FinalizationContext } from '../metrics/types';
import type { MetricRow, ExecutionContext, FinalizationContext } from '../metrics/types';

// ─── Entity Type ─────────────────────────────────────────────────

export const CORE_ENTITY_TYPES = ['run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt'] as const;
export type EntityType = typeof CORE_ENTITY_TYPES[number];

// ─── Relationships ───────────────────────────────────────────────

export interface ParentRelation {
  parentType: EntityType;
  foreignKey: string; // Column on THIS entity's table (e.g. 'strategy_id' on runs)
}

export interface ChildRelation {
  childType: EntityType;
  foreignKey: string; // Column on the CHILD's table (e.g. 'run_id' on variants)
  cascade: 'delete' | 'nullify' | 'restrict';
}

// ─── Actions ─────────────────────────────────────────────────────

export interface EntityAction<TRow> {
  key: string;
  label: string;
  danger?: boolean;
  confirm?: string;
  visible?: (row: TRow) => boolean;
}

// ─── List View Declarations ──────────────────────────────────────

export interface ColumnDef {
  key: string;
  label: string;
  formatter?: string;
  sortable?: boolean;
}

export interface FilterDef {
  field: string;
  type: 'select' | 'toggle';
  label?: string;
  options?: string[];
}

export interface SortDef {
  column: string;
  dir: 'asc' | 'desc';
}

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number';
  required?: boolean;
}

// ─── Detail View Declarations ────────────────────────────────────

export interface TabDef {
  id: string;
  label: string;
}

export interface EntityLink {
  label: string;
  entityType: EntityType;
  entityId: string;
}

// ─── Metric Types ────────────────────────────────────────────────

export type MetricTiming = 'during_execution' | 'at_finalization' | 'at_propagation';
export type MetricCategory = 'cost' | 'rating' | 'match' | 'count';
export type MetricFormatter = 'cost' | 'costDetailed' | 'elo' | 'score' | 'percent' | 'integer';

export interface CatalogMetricDef {
  name: string;
  label: string;
  category: MetricCategory;
  formatter: MetricFormatter;
  timing: MetricTiming;
  description: string;
  listView?: boolean;
}

export interface ExecutionMetricDef extends CatalogMetricDef {
  compute: (ctx: ExecutionContext) => number;
}

export interface FinalizationMetricDef extends CatalogMetricDef {
  compute: (ctx: FinalizationContext) => number | null;
}

export interface PropagationMetricDef extends CatalogMetricDef {
  sourceMetric: string;
  sourceEntity: EntityType;
  aggregate: (rows: MetricRow[]) => MetricValue;
  aggregationMethod: string;
}

export interface EntityMetricRegistry {
  duringExecution: ExecutionMetricDef[];
  atFinalization: FinalizationMetricDef[];
  atPropagation: PropagationMetricDef[];
}

// ─── Paginated Result ────────────────────────────────────────────

export interface ListFilters {
  limit: number;
  offset: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  filters?: Record<string, string>;
}

export interface PaginatedResult<TRow> {
  items: TRow[];
  total: number;
}

// ─── Agent Types ─────────────────────────────────────────────────

export interface AgentContext {
  db: SupabaseClient;
  runId: string;
  iteration: number;
  executionOrder: number;
  logger: EntityLogger;
  costTracker: V2CostTracker;
  config: EvolutionConfig;
}

/** Structured output from Agent.execute(): result + execution detail + variant lineage. */
export interface AgentOutput<TOutput, TDetail> {
  result: TOutput;
  detail: TDetail;
  /** Variant IDs created by this agent (for lineage tracking). */
  childVariantIds?: string[];
  /** Variant IDs consumed/ranked by this agent (for lineage tracking). */
  parentVariantIds?: string[];
}

/** Field definition for config-driven execution detail rendering. */
export interface DetailFieldDef {
  key: string;
  label: string;
  type: 'table' | 'boolean' | 'badge' | 'number' | 'text' | 'list' | 'object';
  /** Column definitions for table type fields. */
  columns?: Array<{ key: string; label: string }>;
  /** Nested field definitions for object type fields. */
  children?: DetailFieldDef[];
  /** Optional formatter name for number/text fields. */
  formatter?: string;
}

export interface AgentResult<T> {
  success: boolean;
  result: T | null;
  cost: number;
  /** Duration of agent execution in milliseconds. */
  durationMs: number;
  invocationId: string | null;
  budgetExceeded?: boolean;
  partialResult?: unknown;
}
