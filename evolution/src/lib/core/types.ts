// Shared types for the entity/agent class system: relationships, actions, views, contexts, results.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityLogger } from '../pipeline/infra/createEntityLogger';
import type { V2CostTracker } from '../pipeline/infra/trackBudget';
import type { EvolutionConfig } from '../pipeline/infra/types';
import type { MetricValue } from '../metrics/experimentMetrics';

export type { MetricRow, ExecutionContext, FinalizationContext } from '../metrics/types';
import type { MetricRow, ExecutionContext, FinalizationContext } from '../metrics/types';

// ─── Entity Type ─────────────────────────────────────────────────

export const CORE_ENTITY_TYPES = ['run', 'invocation', 'variant', 'strategy', 'experiment', 'prompt', 'tactic', 'criteria'] as const;
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
  /** Field type. `'rubric'` is a custom type rendered by `RubricEditor` (Phase 1H)
   *  for the `evaluation_guidance` JSONB column on `evolution_criteria`. */
  type: 'text' | 'textarea' | 'number' | 'rubric';
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
export type MetricFormatter = 'cost' | 'costDetailed' | 'elo' | 'score' | 'percent' | 'percentValue' | 'integer';

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
  // Orchestrator passes the raw V2CostTracker (per-iteration); Agent.run() wraps it in
  // createAgentCostScope before constructing extendedCtx for execute(). Consumers that
  // need per-scope cost attribution (rankNewVariant) take `AgentCostScope` directly —
  // pass `extendedCtx.costTracker as AgentCostScope` at the call site, since Agent.run
  // has already performed the wrap.
  costTracker: V2CostTracker & { getOwnSpent?: () => number };
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
  /** B122: prompt_id for the run, set by the orchestrator so agents writing to
   *  evolution_arena_comparisons (MergeRatingsAgent) can populate the column at insert
   *  time rather than relying on sync_to_arena to backfill. Set to null for runs with
   *  no prompt (explanation-only runs). */
  promptId?: string | null;
  /** Experiment ID for the run, denormalized so per-invocation entity loggers can
   *  populate the experiment_id ancestor FK on evolution_logs rows for cross-aggregation.
   *  Phase 2 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430. */
  experimentId?: string;
  /** Strategy ID for the run, denormalized for the same reason as experimentId. */
  strategyId?: string;
  /** Cached map of tactic name → recent ELO delta (mean elo_score - 1200) computed once
   *  per iteration in runIterationLoop and read by ReflectAndGenerateFromPreviousArticleAgent
   *  to populate the reflection prompt. Phase 4 of the same project. */
  tacticEloBoosts?: Map<string, number | null>;
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
  type: 'table' | 'boolean' | 'badge' | 'number' | 'text' | 'list' | 'object' | 'text-diff' | 'annotated-edits';
  columns?: Array<{ key: string; label: string }>;
  children?: DetailFieldDef[];
  formatter?: string;
  /** For type='text-diff': sourceKey + targetKey resolve in execution_detail to the
   *  before/after strings; previewLength caps the diff render. */
  sourceKey?: string;
  targetKey?: string;
  previewLength?: number;
  /** For type='annotated-edits': keys resolve in execution_detail.cycles[i] to
   *  the AnnotatedProposals component's props. */
  markupKey?: string;
  groupsKey?: string;
  decisionsKey?: string;
  dropsPreKey?: string;
  dropsPostKey?: string;
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
