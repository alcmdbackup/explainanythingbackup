// Zod schemas for all evolution DB entities and internal pipeline types.
// Dependency rule: schemas.ts → types.ts → index.ts (never reverse).

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════
// Shared enums & helpers
// ═══════════════════════════════════════════════════════════════════

export const evolutionRunStatusEnum = z.enum([
  'pending', 'claimed', 'running', 'completed', 'failed', 'cancelled',
]);

export const pipelineTypeEnum = z.enum(['full', 'single']);

export const promptStatusEnum = z.enum(['active', 'archived']);

export const experimentStatusEnum = z.enum(['draft', 'running', 'completed', 'cancelled']);

export const logLevelEnum = z.enum(['info', 'warn', 'error', 'debug']);

export const arenaWinnerEnum = z.enum(['a', 'b', 'draw']);

export const explanationSourceEnum = z.enum(['explanation', 'prompt_seed']);

export const pipelinePhaseEnum = z.enum(['EXPANSION', 'COMPETITION']);

export const agentNameEnum = z.enum([
  'generation', 'ranking', 'evolution',
  'reflection', 'iterativeEditing', 'treeSearch', 'sectionDecomposition',
  'debate', 'proximity', 'metaReview', 'outlineGeneration',
  'flowCritique',
]);

// ═══════════════════════════════════════════════════════════════════
// DB Entity Schemas — InsertSchema (client-supplied) + FullDbSchema (DB row)
// ═══════════════════════════════════════════════════════════════════

// ─── 1. evolution_strategies ─────────────────────────────────────

export const evolutionStrategyInsertSchema = z.object({
  name: z.string().min(1).max(200),
  label: z.string().max(500).optional(),
  description: z.string().max(2000).optional().nullable(),
  config: z.record(z.string(), z.unknown()),
  config_hash: z.string().min(1).max(100),
  pipeline_type: pipelineTypeEnum.optional().default('full'),
  status: z.enum(['active', 'archived']).optional().default('active'),
  created_by: z.string().max(200).optional().nullable(),
});

export const evolutionStrategyFullDbSchema = evolutionStrategyInsertSchema.extend({
  id: z.string().uuid(),
  run_count: z.number().int().min(0).default(0),
  total_cost_usd: z.number().min(0).default(0),
  avg_final_elo: z.number().nullable().default(null),
  first_used_at: z.string().nullable().default(null),
  last_used_at: z.string().nullable().default(null),
  created_at: z.string(),
});

export type EvolutionStrategyInsert = z.infer<typeof evolutionStrategyInsertSchema>;
export type EvolutionStrategyFullDb = z.infer<typeof evolutionStrategyFullDbSchema>;

// ─── 2. evolution_prompts ────────────────────────────────────────

export const evolutionPromptInsertSchema = z.object({
  prompt: z.string().min(1),
  title: z.string().min(1).max(500),
  status: promptStatusEnum.optional().default('active'),
  deleted_at: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
});

export const evolutionPromptFullDbSchema = evolutionPromptInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});

export type EvolutionPromptInsert = z.infer<typeof evolutionPromptInsertSchema>;
export type EvolutionPromptFullDb = z.infer<typeof evolutionPromptFullDbSchema>;

// ─── 3. evolution_experiments ────────────────────────────────────

export const evolutionExperimentInsertSchema = z.object({
  name: z.string().min(1).max(500),
  prompt_id: z.string().uuid(),
  status: experimentStatusEnum.optional().default('draft'),
  config: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const evolutionExperimentFullDbSchema = evolutionExperimentInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string().nullable().default(null),
});

export type EvolutionExperimentInsert = z.infer<typeof evolutionExperimentInsertSchema>;
export type EvolutionExperimentFullDb = z.infer<typeof evolutionExperimentFullDbSchema>;

// ─── 4. evolution_runs ───────────────────────────────────────────

export const evolutionRunInsertSchema = z.object({
  explanation_id: z.number().int().nullable().optional(),
  status: evolutionRunStatusEnum.optional().default('pending'),
  budget_cap_usd: z.number().min(0).optional(),
  error_message: z.string().nullable().optional(),
  prompt_id: z.string().uuid().nullable().optional(),
  pipeline_version: z.string().max(50).optional(),
  strategy_id: z.string().uuid().nullable().optional(),
  experiment_id: z.string().uuid().nullable().optional(),
  archived: z.boolean().optional().default(false),
  run_summary: z.record(z.string(), z.unknown()).nullable().optional(),
  runner_id: z.string().max(200).nullable().optional(),
});

export const evolutionRunFullDbSchema = evolutionRunInsertSchema.extend({
  id: z.string().uuid(),
  completed_at: z.string().nullable().default(null),
  created_at: z.string(),
  last_heartbeat: z.string().nullable().default(null),
});

export type EvolutionRunInsert = z.infer<typeof evolutionRunInsertSchema>;
export type EvolutionRunFullDb = z.infer<typeof evolutionRunFullDbSchema>;

// ─── 5. evolution_variants ───────────────────────────────────────

export const evolutionVariantInsertSchema = z.object({
  id: z.string().uuid(), // client-generated UUID
  run_id: z.string().uuid(),
  explanation_id: z.number().int().nullable().optional(),
  variant_content: z.string().min(1),
  elo_score: z.number().optional(),
  generation: z.number().int().min(0).optional(),
  agent_name: z.string().max(200).optional().nullable(),
  match_count: z.number().int().min(0).optional().default(0),
  is_winner: z.boolean().optional().default(false),
  parent_variant_id: z.string().uuid().nullable().optional(),
  prompt_id: z.string().uuid().nullable().optional(),
  synced_to_arena: z.boolean().optional().default(false),
  mu: z.number().optional(),
  sigma: z.number().optional(),
  arena_match_count: z.number().int().min(0).optional().default(0),
  generation_method: z.string().max(200).optional().nullable(),
  cost_usd: z.number().min(0).optional().nullable(),
  archived_at: z.string().nullable().optional(),
});

export const evolutionVariantFullDbSchema = evolutionVariantInsertSchema.extend({
  created_at: z.string(),
});

export type EvolutionVariantInsert = z.infer<typeof evolutionVariantInsertSchema>;
export type EvolutionVariantFullDb = z.infer<typeof evolutionVariantFullDbSchema>;

// ─── 6. evolution_agent_invocations ──────────────────────────────

export const evolutionAgentInvocationInsertSchema = z.object({
  run_id: z.string().uuid(),
  agent_name: z.string().max(200),
  iteration: z.number().int().min(0),
  execution_order: z.number().int().min(0),
  success: z.boolean().optional().nullable(),
  cost_usd: z.number().min(0).optional().nullable(),
  duration_ms: z.number().int().min(0).optional().nullable(),
  error_message: z.string().nullable().optional(),
  execution_detail: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const evolutionAgentInvocationFullDbSchema = evolutionAgentInvocationInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});

export type EvolutionAgentInvocationInsert = z.infer<typeof evolutionAgentInvocationInsertSchema>;
export type EvolutionAgentInvocationFullDb = z.infer<typeof evolutionAgentInvocationFullDbSchema>;

// ─── 7. evolution_run_logs ───────────────────────────────────────

export const evolutionRunLogInsertSchema = z.object({
  run_id: z.string().uuid(),
  level: logLevelEnum,
  message: z.string(),
  agent_name: z.string().max(200).nullable().optional(),
  iteration: z.number().int().min(0).nullable().optional(),
  variant_id: z.string().uuid().nullable().optional(),
  context: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const evolutionRunLogFullDbSchema = evolutionRunLogInsertSchema.extend({
  id: z.number().int(),
  created_at: z.string(),
});

export type EvolutionRunLogInsert = z.infer<typeof evolutionRunLogInsertSchema>;
export type EvolutionRunLogFullDb = z.infer<typeof evolutionRunLogFullDbSchema>;

// ─── 8. evolution_arena_comparisons ──────────────────────────────

export const evolutionArenaComparisonInsertSchema = z.object({
  prompt_id: z.string().uuid(),
  entry_a: z.string().uuid(),
  entry_b: z.string().uuid(),
  winner: arenaWinnerEnum,
  confidence: z.number().min(0).max(1),
  run_id: z.string().uuid().nullable().optional(),
  status: z.string().max(50).optional(),
});

export const evolutionArenaComparisonFullDbSchema = evolutionArenaComparisonInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});

export type EvolutionArenaComparisonInsert = z.infer<typeof evolutionArenaComparisonInsertSchema>;
export type EvolutionArenaComparisonFullDb = z.infer<typeof evolutionArenaComparisonFullDbSchema>;

// ─── 9. evolution_budget_events ──────────────────────────────────

export const budgetEventTypeEnum = z.enum(['reserve', 'spend', 'release_ok', 'release_failed']);

export const evolutionBudgetEventInsertSchema = z.object({
  run_id: z.string().uuid(),
  event_type: budgetEventTypeEnum,
  agent_name: z.string().max(200),
  amount_usd: z.number(),
  total_spent_usd: z.number().min(0),
  total_reserved_usd: z.number().min(0),
  available_budget_usd: z.number(),
  invocation_id: z.string().uuid().nullable().optional(),
  iteration: z.number().int().min(0).nullable().optional(),
});

export const evolutionBudgetEventFullDbSchema = evolutionBudgetEventInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.string(),
});

export type EvolutionBudgetEventInsert = z.infer<typeof evolutionBudgetEventInsertSchema>;
export type EvolutionBudgetEventFullDb = z.infer<typeof evolutionBudgetEventFullDbSchema>;

// ─── 10. evolution_explanations ──────────────────────────────────

export const evolutionExplanationInsertSchema = z.object({
  explanation_id: z.number().int().nullable().optional(),
  prompt_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  source: explanationSourceEnum,
});

export const evolutionExplanationFullDbSchema = evolutionExplanationInsertSchema.extend({
  id: z.number().int(),
  created_at: z.string(),
});

export type EvolutionExplanationInsert = z.infer<typeof evolutionExplanationInsertSchema>;
export type EvolutionExplanationFullDb = z.infer<typeof evolutionExplanationFullDbSchema>;

// ═══════════════════════════════════════════════════════════════════
// Run Summary Schemas (moved from types.ts)
// ═══════════════════════════════════════════════════════════════════

/** V3: mu-based run summary. New runs write this directly. */
export const EvolutionRunSummaryV3Schema = z.object({
  version: z.literal(3),
  stopReason: z.string().max(200),
  finalPhase: pipelinePhaseEnum,
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  muHistory: z.union([
    z.array(z.array(z.number())),  // New format: number[][] (top-K per iteration)
    z.array(z.number()).transform(arr => arr.map(v => [v]))  // Legacy: number[] → wrap each as [v]
  ]).pipe(z.array(z.array(z.number())).max(100)),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.object({
    id: z.string().max(200),
    strategy: z.string().max(100),
    mu: z.number(),
    isBaseline: z.boolean(),
  })).max(10),
  baselineRank: z.number().int().min(1).nullable(),
  baselineMu: z.number().nullable(),
  strategyEffectiveness: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    avgMu: z.number(),
  })),
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
  actionCounts: z.record(z.string(), z.number().int().min(0)).optional(),
}).strict();

/** TrueSkill default sigma used for V1/V2 → V3 migration: ordinal + 3*sigma ≈ mu */
const V2_DEFAULT_SIGMA = 25 / 3;

/** Type alias for the V3 run summary (used by the transform output). */
interface EvolutionRunSummaryV3 {
  version: 3;
  stopReason: string;
  finalPhase: 'EXPANSION' | 'COMPETITION';
  totalIterations: number;
  durationSeconds: number;
  muHistory: number[][];
  diversityHistory: number[];
  matchStats: { totalMatches: number; avgConfidence: number; decisiveRate: number };
  topVariants: Array<{ id: string; strategy: string; mu: number; isBaseline: boolean }>;
  baselineRank: number | null;
  baselineMu: number | null;
  strategyEffectiveness: Record<string, { count: number; avgMu: number }>;
  metaFeedback: {
    successfulStrategies: string[];
    recurringWeaknesses: string[];
    patternsToAvoid: string[];
    priorityImprovements: string[];
  } | null;
  actionCounts?: Record<string, number>;
}

/** Legacy V2 schema with ordinal field names. Auto-transforms to V3 on parse. */
const EvolutionRunSummaryV2Schema = z.object({
  version: z.literal(2),
  stopReason: z.string().max(200),
  finalPhase: pipelinePhaseEnum,
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  ordinalHistory: z.array(z.number()).max(100),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.object({
    id: z.string().max(200),
    strategy: z.string().max(100),
    ordinal: z.number(),
    isBaseline: z.boolean(),
  })).max(10),
  baselineRank: z.number().int().min(1).nullable(),
  baselineOrdinal: z.number().nullable(),
  strategyEffectiveness: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    avgOrdinal: z.number(),
  })),
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
}).transform((v2): EvolutionRunSummaryV3 => ({
  version: 3,
  stopReason: v2.stopReason,
  finalPhase: v2.finalPhase,
  totalIterations: v2.totalIterations,
  durationSeconds: v2.durationSeconds,
  muHistory: v2.ordinalHistory.map((ord) => [ord + 3 * V2_DEFAULT_SIGMA]),
  diversityHistory: v2.diversityHistory,
  matchStats: v2.matchStats,
  topVariants: v2.topVariants.map((tv) => ({
    id: tv.id, strategy: tv.strategy, mu: tv.ordinal + 3 * V2_DEFAULT_SIGMA, isBaseline: tv.isBaseline,
  })),
  baselineRank: v2.baselineRank,
  baselineMu: v2.baselineOrdinal != null ? v2.baselineOrdinal + 3 * V2_DEFAULT_SIGMA : null,
  strategyEffectiveness: Object.fromEntries(
    Object.entries(v2.strategyEffectiveness).map(([k, v]) => [k, { count: v.count, avgMu: v.avgOrdinal + 3 * V2_DEFAULT_SIGMA }]),
  ),
  metaFeedback: v2.metaFeedback,
}));

/** Legacy V1 schema with Elo field names. Auto-transforms to V3 on parse (V1→V3 direct). */
const EvolutionRunSummaryV1Schema = z.object({
  version: z.literal(1).optional(),
  stopReason: z.string().max(200),
  finalPhase: pipelinePhaseEnum,
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  eloHistory: z.array(z.number()).max(100),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.object({
    id: z.string().max(200),
    strategy: z.string().max(100),
    elo: z.number(),
    isBaseline: z.boolean(),
  })).max(10),
  baselineRank: z.number().int().min(1).nullable(),
  baselineElo: z.number().nullable(),
  strategyEffectiveness: z.record(z.string(), z.object({
    count: z.number().int().min(0),
    avgElo: z.number(),
  })),
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
}).transform((v1): EvolutionRunSummaryV3 => ({
  version: 3,
  stopReason: v1.stopReason,
  finalPhase: v1.finalPhase,
  totalIterations: v1.totalIterations,
  durationSeconds: v1.durationSeconds,
  muHistory: v1.eloHistory.map((ord) => [ord + 3 * V2_DEFAULT_SIGMA]),
  diversityHistory: v1.diversityHistory,
  matchStats: v1.matchStats,
  topVariants: v1.topVariants.map((tv) => ({
    id: tv.id, strategy: tv.strategy, mu: tv.elo + 3 * V2_DEFAULT_SIGMA, isBaseline: tv.isBaseline,
  })),
  baselineRank: v1.baselineRank,
  baselineMu: v1.baselineElo != null ? v1.baselineElo + 3 * V2_DEFAULT_SIGMA : null,
  strategyEffectiveness: Object.fromEntries(
    Object.entries(v1.strategyEffectiveness).map(([k, v]) => [k, { count: v.count, avgMu: v.avgElo + 3 * V2_DEFAULT_SIGMA }]),
  ),
  metaFeedback: v1.metaFeedback,
}));

export const EvolutionRunSummarySchema = z.union([
  EvolutionRunSummaryV3Schema,
  EvolutionRunSummaryV2Schema,
  EvolutionRunSummaryV1Schema,
]);
