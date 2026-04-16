// Shared types for the entity/agent class system: relationships, actions, views, contexts, results.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityLogger } from '../pipeline/infra/createEntityLogger';
import type { V2CostTracker } from '../pipeline/infra/trackBudget';
import type { EvolutionConfig } from '../pipeline/infra/types';
import type { MetricValue } from '../metrics/experimentMetrics';

export type { MetricRow, ExecutionContext, FinalizationContext } from '../metrics/types';
import type { MetricRow, ExecutionContext, FinalizationContext } from '../metrics/types';

// ─── Entity Type ─────────────────────────────────────────────────

export const CORE_ENTITY_TYPES = ['run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt'] as const;
export type EntityType = typeof CORE_ENTITY_TYPES[number];

// ─── Relationships ───────────────────────────────────────────────

export interface ParentRelation {
  parentType: EntityType;
  /** Column on this entity's table pointing to the parent (e.g. 'strategy_id' on runs). */
  foreignKey: string;
}

export interface ChildRelation {
  childType: EntityType;
  /** Column on the child's table pointing back to this entity (e.g. 'run_id' on variants). */
  foreignKey: string;
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
  compute: (ctx: FinalizationContext) => MetricValue | number | null;
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
  /** Invocation row UUID — populated by Agent.run() before execute() is called.
   *  May be empty string if createInvocation() returned null (DB write failed). */
  invocationId: string;
  /** Seeded RNG sub-seed derived from the run's random_seed via deriveSeed(). */
  randomSeed: bigint;
  /** 1-based index of this agent within a parallel-dispatch batch (Phase 7 logging).
   *  Set by the orchestrator for parallel generate iterations; undefined for solo agents. */
  agentIndex?: number;
  /** Raw LLM provider propagated from the orchestrator. When set, Agent.run() builds a
   *  per-invocation EvolutionLLMClient bound to the AgentCostScope (fixes Bug B: sibling
   *  cost bleed under parallel dispatch). Optional for back-compat with existing tests
   *  that pass a pre-built `llm` on Input. */
  rawProvider?: {
    complete(
      prompt: string,
      label: string,
      opts?: { model?: string; temperature?: number; reasoningEffort?: 'none' | 'low' | 'medium' | 'high' },
    ): Promise<string | { text: string; usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number } }>;
  };
  /** Default model for the scoped LLM client. Required when rawProvider is set. */
  defaultModel?: string;
  /** Optional temperature override for generation-phase LLM calls. */
  generationTemperature?: number;
}

export interface AgentOutput<TOutput, TDetail> {
  result: TOutput;
  detail: TDetail;
  childVariantIds?: string[];
  parentVariantIds?: string[];
}

export interface DetailFieldDef {
  key: string;
  label: string;
  type: 'table' | 'boolean' | 'badge' | 'number' | 'text' | 'list' | 'object';
  columns?: Array<{ key: string; label: string }>;
  children?: DetailFieldDef[];
  formatter?: string;
}

export interface AgentResult<T> {
  success: boolean;
  result: T | null;
  cost: number;
  durationMs: number;
  invocationId: string | null;
  budgetExceeded?: boolean;
  partialResult?: unknown;
}
