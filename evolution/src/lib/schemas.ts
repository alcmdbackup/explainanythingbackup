// Zod schemas for all evolution DB entities and internal pipeline types.
// Dependency rule: schemas.ts → types.ts → index.ts (never reverse).

import { z } from 'zod';
import { _INTERNAL_DEFAULT_SIGMA } from './shared/computeRatings';
import { getModelMaxTemperature } from '@/config/modelRegistry';

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
  is_predefined: z.boolean().default(false),
  avg_elo_per_dollar: z.number().nullable().default(null),
  stddev_final_elo: z.number().nullable().default(null),
  first_used_at: z.string().nullable().default(null),
  last_used_at: z.string().nullable().default(null),
  created_at: z.string(),
});

export type EvolutionStrategyInsert = z.infer<typeof evolutionStrategyInsertSchema>;
export type EvolutionStrategyFullDb = z.infer<typeof evolutionStrategyFullDbSchema>;

// ─── 2. evolution_prompts ────────────────────────────────────────

export const evolutionPromptInsertSchema = z.object({
  prompt: z.string().min(1),
  name: z.string().min(1).max(500),
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
  // DB migration 20260322000007 conditionally applies NOT NULL — keep nullable for safety
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
  // Run-level error surface (Phase 9, generate_rank_evolution_parallel_20260331).
  error_code: z.string().nullable().optional(),
  error_details: z.record(z.string(), z.unknown()).nullable().optional(),
  failed_at_iteration: z.number().int().nullable().optional(),
  failed_at_invocation: z.string().uuid().nullable().optional(),
  // Reproducibility seed (BIGINT in DB; TS read as string).
  random_seed: z.string().nullable().optional(),
  // Iteration snapshots persisted at finalization (JSONB array on the run row).
  // Validated separately on read via iterationSnapshotSchema (declared later in this file).
  iteration_snapshots: z.array(z.unknown()).nullable().optional(),
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
  model: z.string().max(200).optional().nullable(),
  evolution_explanation_id: z.string().uuid().optional().nullable(),
  /** Whether this variant survived to the final pool. False = generated but discarded by
   *  its owning generateFromSeedArticle agent (budget + low local mu). Default false on
   *  insert; the finalization step writes true for surfaced variants. */
  persisted: z.boolean().optional().default(false),
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
// Internal Pipeline Type Schemas (Phase 2)
// ═══════════════════════════════════════════════════════════════════

// ─── Variant (in-memory pipeline representation) ─────────────────

export const variantSchema = z.object({
  id: z.string(),
  text: z.string(),
  version: z.number().int().min(0),
  parentIds: z.array(z.string()),
  strategy: z.string(),
  createdAt: z.number(),
  iterationBorn: z.number().int().min(0),
  costUsd: z.number().min(0).optional(),
  fromArena: z.boolean().optional(),
});

export type VariantSchema = z.infer<typeof variantSchema>;

// ─── Generation Guidance ─────────────────────────────────────────

export const generationGuidanceEntrySchema = z.object({
  strategy: z.string().min(1),
  percent: z.number().min(0).max(100),
});

export const generationGuidanceSchema = z
  .array(generationGuidanceEntrySchema)
  .min(1)
  .refine(
    (entries: Array<{ strategy: string; percent: number }>) => {
      const names = entries.map((e) => e.strategy);
      return new Set(names).size === names.length;
    },
    { message: 'Duplicate strategy names in generationGuidance' },
  );

export type GenerationGuidanceEntry = z.infer<typeof generationGuidanceEntrySchema>;

// ─── Strategy Config ──────────────────────────────────────────

export const strategyConfigSchema = z.object({
  generationModel: z.string(),
  judgeModel: z.string(),
  iterations: z.number().int().min(1),
  strategiesPerRound: z.number().int().min(1).optional(),
  budgetUsd: z.number().min(0).optional(),
  generationGuidance: generationGuidanceSchema.optional(),
  /** Max generateFromSeedArticle agents per run. Excludes seed article. Default 9. */
  maxVariantsToGenerateFromSeedArticle: z.number().int().min(1).max(100).optional(),
  /** Hard cap on pairwise comparisons per variant during ranking. Default 15. */
  maxComparisonsPerVariant: z.number().int().min(1).max(100).optional(),
  /** Fraction of budget to reserve after parallel generation (0-1). Default 0. */
  budgetBufferAfterParallel: z.number().min(0).max(1).optional(),
  /** Fraction of budget to reserve after sequential generation (0-1). Default 0. */
  budgetBufferAfterSequential: z.number().min(0).max(1).optional(),
  /** Temperature for generation LLM calls (0-2). Omit for provider default. Ranking always uses 0. */
  generationTemperature: z.number().min(0).max(2).optional(),
}).refine((c) => {
  const parallel = c.budgetBufferAfterParallel ?? 0;
  const sequential = c.budgetBufferAfterSequential ?? 0;
  return parallel >= sequential;
}, { message: 'budgetBufferAfterParallel must be >= budgetBufferAfterSequential' }).refine((c) => {
  if (c.generationTemperature == null) return true;
  const maxTemp = getModelMaxTemperature(c.generationModel);
  if (maxTemp === undefined) return true; // unknown model — let it through
  if (maxTemp === null) return false; // model doesn't support temperature
  return c.generationTemperature <= maxTemp;
}, { message: 'generationTemperature exceeds the model\'s maximum temperature' });

/** @deprecated Use StrategyConfig from pipeline/infra/types.ts instead. */
export type StrategyConfigSchema = z.infer<typeof strategyConfigSchema>;

// ─── Evolution Config ────────────────────────────────────────────

/** Default strategies for the parallelized generate iteration. */
export const DEFAULT_GENERATE_STRATEGIES = [
  'structural_transform',
  'lexical_simplify',
  'grounding_enhance',
] as const;

export const evolutionConfigSchema = z.object({
  /** @deprecated Ignored by the orchestrator-driven loop. Kept for backward compat. */
  iterations: z.number().int().min(1).max(100).optional(),
  budgetUsd: z.number().gt(0).lte(50),
  judgeModel: z.string(),
  generationModel: z.string(),
  /** @deprecated Pre-parallel pipeline strategies-per-round (3 by default). Replaced by numVariants. */
  strategiesPerRound: z.number().int().min(1).optional(),
  /** @deprecated Triage calibration opponent count (legacy ranking). */
  calibrationOpponents: z.number().int().min(1).optional(),
  /** @deprecated Top-K eligibility floor (legacy ranking). */
  tournamentTopK: z.number().int().min(1).optional(),
  /** Optional weighted strategy selection from main (predates parallel pipeline). */
  generationGuidance: generationGuidanceSchema.optional(),
  /** Number of parallel generateFromSeedArticle agents per generate iteration (default 9). */
  numVariants: z.number().int().min(1).max(100).optional(),
  /** Strategy names to round-robin across the N parallel generate agents. */
  strategies: z.array(z.string().min(1)).optional(),
  /** Hard cap on pairwise comparisons per variant during ranking (default 15). */
  maxComparisonsPerVariant: z.number().int().min(1).max(100).optional(),
  /** Fraction of budget to reserve after parallel generation (0-1, default 0). */
  budgetBufferAfterParallel: z.number().min(0).max(1).optional(),
  /** Fraction of budget to reserve after sequential generation (0-1, default 0). */
  budgetBufferAfterSequential: z.number().min(0).max(1).optional(),
  /** Temperature for generation LLM calls (0-2). Omit for provider default. Ranking always uses 0. */
  generationTemperature: z.number().min(0).max(2).optional(),
});

export type EvolutionConfigSchema = z.infer<typeof evolutionConfigSchema>;

// ─── V2 Match ────────────────────────────────────────────────────

export const v2MatchSchema = z.object({
  winnerId: z.string(),
  loserId: z.string(),
  result: z.enum(['win', 'draw']),
  confidence: z.number().min(0).max(1),
  judgeModel: z.string(),
  reversed: z.boolean(),
});

export type V2MatchSchema = z.infer<typeof v2MatchSchema>;

// ─── Rating ──────────────────────────────────────────────────────

export const ratingSchema = z.object({
  elo: z.number(),
  uncertainty: z.number().positive(),
});

export type RatingSchema = z.infer<typeof ratingSchema>;

// ─── Cached Match ────────────────────────────────────────────────

export const cachedMatchSchema = z.object({
  winnerId: z.string().nullable(),
  loserId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  isDraw: z.boolean(),
});

export type CachedMatchSchema = z.infer<typeof cachedMatchSchema>;

// ─── Evolution Result ────────────────────────────────────────────

export const evolutionResultSchema = z.object({
  winner: variantSchema,
  pool: z.array(variantSchema),
  ratings: z.map(z.string(), ratingSchema),
  matchHistory: z.array(v2MatchSchema),
  totalCost: z.number().min(0),
  iterationsRun: z.number().int().min(0),
  stopReason: z.enum(['budget_exceeded', 'iterations_complete', 'converged', 'killed', 'time_limit']),
  eloHistory: z.array(z.array(z.number())),
  diversityHistory: z.array(z.number()),
  matchCounts: z.record(z.string(), z.number().int().min(0)),
});

export type EvolutionResultSchema = z.infer<typeof evolutionResultSchema>;

// ─── Critique ────────────────────────────────────────────────────

export const critiqueSchema = z.object({
  variationId: z.string(),
  dimensionScores: z.record(z.string(), z.number()),
  goodExamples: z.record(z.string(), z.array(z.string())),
  badExamples: z.record(z.string(), z.array(z.string())),
  notes: z.record(z.string(), z.string()),
  reviewer: z.string(),
  scale: z.enum(['1-10', '0-5']).optional(),
});

export type CritiqueSchema = z.infer<typeof critiqueSchema>;

// ─── Meta Feedback ───────────────────────────────────────────────

export const metaFeedbackSchema = z.object({
  recurringWeaknesses: z.array(z.string()),
  priorityImprovements: z.array(z.string()),
  successfulStrategies: z.array(z.string()),
  patternsToAvoid: z.array(z.string()),
});

export type MetaFeedbackSchema = z.infer<typeof metaFeedbackSchema>;

// ─── Agent Execution Detail (11-variant discriminated union) ─────

const executionDetailBaseSchema = z.object({
  totalCost: z.number().min(0),
  _truncated: z.boolean().optional(),
});

export const generationExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('generation'),
  strategies: z.array(z.object({
    name: z.string(),
    promptLength: z.number().int().min(0),
    status: z.enum(['success', 'format_rejected', 'error']),
    formatIssues: z.array(z.string()).optional(),
    variantId: z.string().optional(),
    textLength: z.number().int().min(0).optional(),
    error: z.string().optional(),
  })),
  feedbackUsed: z.boolean(),
});

export const iterativeEditingExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('iterativeEditing'),
  targetVariantId: z.string(),
  config: z.object({
    maxCycles: z.number().int().min(1),
    maxConsecutiveRejections: z.number().int().min(1),
    qualityThreshold: z.number(),
  }),
  cycles: z.array(z.object({
    cycleNumber: z.number().int().min(0),
    target: z.object({
      dimension: z.string().optional(),
      description: z.string(),
      score: z.number().optional(),
      source: z.string(),
    }),
    verdict: z.enum(['ACCEPT', 'REJECT']),
    confidence: z.number().min(0).max(1),
    formatValid: z.boolean(),
    formatIssues: z.array(z.string()).optional(),
    newVariantId: z.string().optional(),
  })),
  initialCritique: z.object({ dimensionScores: z.record(z.string(), z.number()) }),
  finalCritique: z.object({ dimensionScores: z.record(z.string(), z.number()) }).optional(),
  stopReason: z.enum(['threshold_met', 'max_rejections', 'max_cycles', 'no_targets']),
  consecutiveRejections: z.number().int().min(0),
});

export const reflectionExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('reflection'),
  variantsCritiqued: z.array(z.object({
    variantId: z.string(),
    status: z.enum(['success', 'parse_failed', 'error']),
    avgScore: z.number().optional(),
    dimensionScores: z.record(z.string(), z.number()).optional(),
    goodExamples: z.record(z.string(), z.array(z.string())).optional(),
    badExamples: z.record(z.string(), z.array(z.string())).optional(),
    notes: z.record(z.string(), z.string()).optional(),
    error: z.string().optional(),
  })),
  dimensions: z.array(z.string()),
});

export const debateExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('debate'),
  variantA: z.object({ id: z.string(), mu: z.number() }),
  variantB: z.object({ id: z.string(), mu: z.number() }),
  transcript: z.array(z.object({
    role: z.enum(['advocate_a', 'advocate_b', 'judge']),
    content: z.string(),
  })),
  judgeVerdict: z.object({
    winner: z.enum(['A', 'B', 'tie']),
    reasoning: z.string(),
    strengthsFromA: z.array(z.string()),
    strengthsFromB: z.array(z.string()),
    improvements: z.array(z.string()),
  }).optional(),
  synthesisVariantId: z.string().optional(),
  synthesisTextLength: z.number().int().min(0).optional(),
  formatValid: z.boolean().optional(),
  formatIssues: z.array(z.string()).optional(),
  failurePoint: z.enum(['advocate_a', 'advocate_b', 'judge', 'parse', 'format', 'synthesis']).optional(),
});

export const sectionDecompositionExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('sectionDecomposition'),
  targetVariantId: z.string(),
  weakness: z.object({ dimension: z.string(), description: z.string() }),
  sections: z.array(z.object({
    index: z.number().int().min(0),
    heading: z.string().nullable(),
    eligible: z.boolean(),
    improved: z.boolean(),
    charCount: z.number().int().min(0),
  })),
  sectionsImproved: z.number().int().min(0),
  totalEligible: z.number().int().min(0),
  formatValid: z.boolean(),
  newVariantId: z.string().optional(),
});

export const evolutionExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('evolution'),
  parents: z.array(z.object({ id: z.string(), mu: z.number() })),
  mutations: z.array(z.object({
    strategy: z.string(),
    status: z.enum(['success', 'format_rejected', 'error']),
    variantId: z.string().optional(),
    textLength: z.number().int().min(0).optional(),
    error: z.string().optional(),
  })),
  creativeExploration: z.boolean(),
  creativeReason: z.enum(['random', 'low_diversity']).optional(),
  overrepresentedStrategies: z.array(z.string()).optional(),
  feedbackUsed: z.boolean(),
});

export const treeSearchExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('treeSearch'),
  rootVariantId: z.string(),
  config: z.object({
    beamWidth: z.number().int().min(1),
    branchingFactor: z.number().int().min(1),
    maxDepth: z.number().int().min(1),
  }),
  result: z.object({
    treeSize: z.number().int().min(0),
    maxDepth: z.number().int().min(0),
    prunedBranches: z.number().int().min(0),
    revisionPath: z.array(z.object({
      type: z.string(),
      dimension: z.string().optional(),
      description: z.string(),
    })),
  }),
  bestLeafVariantId: z.string().optional(),
  addedToPool: z.boolean(),
});

export const outlineGenerationExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('outlineGeneration'),
  steps: z.array(z.object({
    name: z.enum(['outline', 'expand', 'polish', 'verify']),
    score: z.number().min(0).max(1),
    costUsd: z.number().min(0),
    inputLength: z.number().int().min(0),
    outputLength: z.number().int().min(0),
  })),
  weakestStep: z.string().nullable(),
  variantId: z.string(),
});

export const rankingExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('ranking'),
  triage: z.array(z.object({
    variantId: z.string(),
    opponents: z.array(z.string()),
    matches: z.array(z.object({
      opponentId: z.string(),
      winner: z.string(),
      confidence: z.number().min(0).max(1),
      cacheHit: z.boolean(),
    })),
    eliminated: z.boolean(),
    ratingBefore: ratingSchema,
    ratingAfter: ratingSchema,
  })),
  fineRanking: z.object({
    rounds: z.number().int().min(0),
    exitReason: z.enum(['budget', 'convergence', 'stale', 'maxRounds', 'time_limit', 'no_contenders']),
    convergenceStreak: z.number().int().min(0),
  }),
  budgetPressure: z.number().min(0),
  budgetTier: z.enum(['low', 'medium', 'high']),
  top20Cutoff: z.number(),
  eligibleContenders: z.number().int().min(0),
  totalComparisons: z.number().int().min(0),
  flowEnabled: z.boolean(),
  low_sigma_opponents_count: z.number().int().min(0).optional(),
});

export const proximityExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('proximity'),
  newEntrants: z.number().int().min(0),
  existingVariants: z.number().int().min(0),
  diversityScore: z.number().min(0),
  totalPairsComputed: z.number().int().min(0),
});

export const metaReviewExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('metaReview'),
  successfulStrategies: z.array(z.string()),
  recurringWeaknesses: z.array(z.string()),
  patternsToAvoid: z.array(z.string()),
  priorityImprovements: z.array(z.string()),
  analysis: z.object({
    strategyMus: z.record(z.string(), z.number()),
    bottomQuartileCount: z.number().int().min(0),
    poolDiversity: z.number().min(0),
    muRange: z.number().min(0),
    activeStrategies: z.number().int().min(0),
    topVariantAge: z.number().int().min(0),
  }),
});

// ─── New parallel pipeline agents (generate_rank_evolution_parallel_20260331) ─────

/** Shallow key-rename preprocessor for Zod backward-compat normalization.
 *  Leaves non-object values untouched; replaces old key names with new ones. */
function renameKeys(mapping: Record<string, string>): (val: unknown) => unknown {
  return (val: unknown) => {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) return val;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[mapping[k] ?? k] = v;
    }
    return out;
  };
}

/** generateFromSeedArticle: ranking comparison record (one per binary-search comparison). */
const generateFromSeedComparisonInnerSchema = z.object({
  round: z.number().int().min(1),
  opponentId: z.string(),
  selectionScore: z.number(),
  pWin: z.number().min(0).max(1),
  variantEloBefore: z.number(),
  variantUncertaintyBefore: z.number().min(0),
  opponentEloBefore: z.number(),
  opponentUncertaintyBefore: z.number().min(0),
  outcome: z.enum(['win', 'loss', 'draw']),
  confidence: z.number().min(0).max(1),
  variantEloAfter: z.number(),
  variantUncertaintyAfter: z.number().min(0),
  opponentEloAfter: z.number(),
  opponentUncertaintyAfter: z.number().min(0),
  top15CutoffAfter: z.number(),
  eloPlusTwoUncertainty: z.number(),
  eliminated: z.boolean(),
  converged: z.boolean(),
});

export const generateFromSeedComparisonSchema = z.preprocess(
  renameKeys({
    variantMuBefore: 'variantEloBefore',
    variantSigmaBefore: 'variantUncertaintyBefore',
    opponentMuBefore: 'opponentEloBefore',
    opponentSigmaBefore: 'opponentUncertaintyBefore',
    variantMuAfter: 'variantEloAfter',
    variantSigmaAfter: 'variantUncertaintyAfter',
    opponentMuAfter: 'opponentEloAfter',
    opponentSigmaAfter: 'opponentUncertaintyAfter',
    muPlusTwoSigma: 'eloPlusTwoUncertainty',
  }),
  generateFromSeedComparisonInnerSchema,
);

const generateFromSeedRankingDetailInnerSchema = z.object({
  variantId: z.string(),
  localPoolSize: z.number().int().min(0),
  localPoolVariantIds: z.array(z.string()),
  initialTop15Cutoff: z.number(),
  comparisons: z.array(generateFromSeedComparisonSchema),
  stopReason: z.enum(['converged', 'eliminated', 'no_more_opponents', 'budget']),
  totalComparisons: z.number().int().min(0),
  finalLocalElo: z.number(),
  finalLocalUncertainty: z.number().min(0),
  finalLocalTop15Cutoff: z.number(),
});

const rankingDetailRenameKeys = renameKeys({
  finalLocalMu: 'finalLocalElo',
  finalLocalSigma: 'finalLocalUncertainty',
});

export const generateFromSeedRankingDetailSchema = z.preprocess(
  rankingDetailRenameKeys,
  generateFromSeedRankingDetailInnerSchema,
);

export const generateFromSeedExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('generate_from_seed_article'),
  variantId: z.string().nullable(),
  strategy: z.string(),
  generation: z.object({
    cost: z.number().min(0),
    estimatedCost: z.number().min(0).optional(),
    promptLength: z.number().int().min(0),
    textLength: z.number().int().min(0).optional(),
    formatValid: z.boolean(),
    formatIssues: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    generateFromSeedRankingDetailInnerSchema.extend({
      cost: z.number().min(0),
      estimatedCost: z.number().min(0).optional(),
    }),
  ).nullable(),
  estimatedTotalCost: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  surfaced: z.boolean(),
  discardReason: z.preprocess(
    renameKeys({ localMu: 'localElo' }),
    z.object({
      localElo: z.number(),
      localTop15Cutoff: z.number(),
    }),
  ).optional(),
});

/** CreateSeedArticleAgent execution detail. */
export const createSeedArticleExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('create_seed_article'),
  generation: z.object({
    cost: z.number().min(0),
    promptLength: z.number().int().min(0),
    titleLength: z.number().int().min(0).optional(),
    contentLength: z.number().int().min(0).optional(),
    formatValid: z.boolean(),
    error: z.string().optional(),
  }),
  ranking: z.preprocess(
    rankingDetailRenameKeys,
    generateFromSeedRankingDetailInnerSchema.extend({
      cost: z.number().min(0),
    }),
  ).nullable(),
  surfaced: z.boolean(),
  discardReason: z.preprocess(
    renameKeys({ localMu: 'localElo' }),
    z.object({
      localElo: z.number(),
      localTop15Cutoff: z.number(),
    }),
  ).optional(),
});

/** SwissRankingAgent execution detail. */
export const swissRankingExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('swiss_ranking'),
  eligibleIds: z.array(z.string()),
  eligibleCount: z.number().int().min(0),
  pairsConsidered: z.number().int().min(0),
  pairsDispatched: z.number().int().min(0),
  pairsSucceeded: z.number().int().min(0),
  pairsFailedBudget: z.number().int().min(0),
  pairsFailedOther: z.number().int().min(0),
  matchesProduced: z.array(z.object({
    winnerId: z.string(),
    loserId: z.string(),
    result: z.enum(['win', 'draw']),
    confidence: z.number().min(0).max(1),
  })),
  matchesProducedTotal: z.number().int().min(0),
  matchesTruncated: z.boolean(),
  status: z.enum(['success', 'budget', 'no_pairs']),
});

/** MergeRatingsAgent execution detail.
 *  Backward compat: accepts legacy `mu`/`sigma`/`muDelta`/`sigmaDelta` field names
 *  inside before.variants / after.variants and normalizes to `elo`/`uncertainty`/etc. */
const beforeVariantRenameKeys = renameKeys({ mu: 'elo', sigma: 'uncertainty' });
const afterVariantRenameKeys = renameKeys({
  mu: 'elo',
  sigma: 'uncertainty',
  muDelta: 'eloDelta',
  sigmaDelta: 'uncertaintyDelta',
});

export const mergeRatingsExecutionDetailSchema = executionDetailBaseSchema.extend({
  detailType: z.literal('merge_ratings'),
  iterationType: z.enum(['generate', 'swiss']),
  before: z.object({
    poolSize: z.number().int().min(0),
    variants: z.array(z.preprocess(
      beforeVariantRenameKeys,
      z.object({
        id: z.string(),
        elo: z.number(),
        uncertainty: z.number().min(0),
        matchCount: z.number().int().min(0),
      }),
    )),
    top15Cutoff: z.number(),
  }),
  input: z.object({
    matchBufferCount: z.number().int().min(0),
    totalMatchesIn: z.number().int().min(0),
    matchesPerBuffer: z.array(z.number().int().min(0)),
    newVariantsAdded: z.number().int().min(0),
  }),
  matchesApplied: z.array(z.object({
    indexInShuffledOrder: z.number().int().min(0),
    winnerId: z.string(),
    loserId: z.string(),
    result: z.enum(['win', 'draw']),
    confidence: z.number().min(0).max(1),
  })),
  matchesAppliedTotal: z.number().int().min(0),
  matchesAppliedTruncated: z.boolean(),
  after: z.object({
    poolSize: z.number().int().min(0),
    variants: z.array(z.preprocess(
      afterVariantRenameKeys,
      z.object({
        id: z.string(),
        elo: z.number(),
        uncertainty: z.number().min(0),
        matchCount: z.number().int().min(0),
        eloDelta: z.number(),
        uncertaintyDelta: z.number(),
      }),
    )),
    top15Cutoff: z.number(),
    top15CutoffDelta: z.number(),
  }),
  variantsAddedToPool: z.array(z.string()),
  durationMs: z.number().min(0),
});

/** IterationSnapshot — captured at the start and end of every orchestrator iteration.
 *  Backward compat: accepts legacy `{mu, sigma}` ratings and `{mu, top15Cutoff}` discardReasons. */
const snapshotRatingRename = renameKeys({ mu: 'elo', sigma: 'uncertainty' });
const snapshotDiscardReasonRename = renameKeys({ mu: 'elo' });

export const iterationSnapshotSchema = z.object({
  iteration: z.number().int().min(1),
  iterationType: z.enum(['generate', 'swiss']),
  phase: z.enum(['start', 'end']),
  capturedAt: z.string(),
  poolVariantIds: z.array(z.string()),
  ratings: z.record(z.string(), z.preprocess(
    snapshotRatingRename,
    z.object({ elo: z.number(), uncertainty: z.number().min(0) }),
  )),
  matchCounts: z.record(z.string(), z.number().int().min(0)),
  discardedVariantIds: z.array(z.string()).optional(),
  discardReasons: z.record(z.string(), z.preprocess(
    snapshotDiscardReasonRename,
    z.object({
      elo: z.number(),
      top15Cutoff: z.number(),
    }),
  )).optional(),
});

export type IterationSnapshot = z.infer<typeof iterationSnapshotSchema>;

export const agentExecutionDetailSchema = z.discriminatedUnion('detailType', [
  generationExecutionDetailSchema,
  iterativeEditingExecutionDetailSchema,
  reflectionExecutionDetailSchema,
  debateExecutionDetailSchema,
  sectionDecompositionExecutionDetailSchema,
  evolutionExecutionDetailSchema,
  treeSearchExecutionDetailSchema,
  outlineGenerationExecutionDetailSchema,
  rankingExecutionDetailSchema,
  proximityExecutionDetailSchema,
  metaReviewExecutionDetailSchema,
  generateFromSeedExecutionDetailSchema,
  createSeedArticleExecutionDetailSchema,
  swissRankingExecutionDetailSchema,
  mergeRatingsExecutionDetailSchema,
]);

export type AgentExecutionDetailSchema = z.infer<typeof agentExecutionDetailSchema>;

// ═══════════════════════════════════════════════════════════════════
// Run Summary Schemas (moved from types.ts)
// ═══════════════════════════════════════════════════════════════════

/** V3: run summary. New runs write Elo-scale fields directly.
 *  Backward compat: legacy V3 runs wrote these as `muHistory`/`baselineMu`/`avgMu`/`mu`; the
 *  preprocess step renames those to `eloHistory`/`baselineElo`/`avgElo`/`elo`. Values in
 *  legacy payloads are already Elo-scale (per persistRunResults refactor); truly old mu-scale
 *  values (<100) are handled by display-layer heuristics in MetricsTab/visualizationActions. */
const topVariantRename = renameKeys({ mu: 'elo' });
const strategyEffectivenessEntryRename = renameKeys({ avgMu: 'avgElo' });
const runSummaryV3Rename = renameKeys({ muHistory: 'eloHistory', baselineMu: 'baselineElo' });

const _EvolutionRunSummaryV3Inner = z.object({
  version: z.literal(3),
  stopReason: z.string().max(200),
  finalPhase: pipelinePhaseEnum,
  totalIterations: z.number().int().min(0).max(100),
  durationSeconds: z.number().min(0),
  eloHistory: z.union([
    z.array(z.array(z.number())),  // New format: number[][] (top-K per iteration)
    z.array(z.number()).transform(arr => arr.map(v => [v]))  // Legacy: number[] → wrap each as [v]
  ]).pipe(z.array(z.array(z.number())).max(100)),
  diversityHistory: z.array(z.number()).max(100),
  matchStats: z.object({
    totalMatches: z.number().int().min(0),
    avgConfidence: z.number().min(0).max(1),
    decisiveRate: z.number().min(0).max(1),
  }),
  topVariants: z.array(z.preprocess(
    topVariantRename,
    z.object({
      id: z.string().max(200),
      strategy: z.string().max(100),
      elo: z.number(),
      isBaseline: z.boolean(),
    }),
  )).max(10),
  baselineRank: z.number().int().min(1).nullable(),
  baselineElo: z.number().nullable(),
  strategyEffectiveness: z.record(z.string(), z.preprocess(
    strategyEffectivenessEntryRename,
    z.object({
      count: z.number().int().min(0),
      avgElo: z.number(),
    }),
  )),
  metaFeedback: z.object({
    successfulStrategies: z.array(z.string().min(1).max(200)).max(10),
    recurringWeaknesses: z.array(z.string().min(1).max(200)).max(10),
    patternsToAvoid: z.array(z.string().min(1).max(200)).max(10),
    priorityImprovements: z.array(z.string().min(1).max(200)).max(10),
  }).nullable(),
  actionCounts: z.record(z.string(), z.number().int().min(0)).optional(),
}).strict();

export const EvolutionRunSummaryV3Schema = z.preprocess(runSummaryV3Rename, _EvolutionRunSummaryV3Inner);

/** TrueSkill default sigma used for V1/V2 → V3 migration: ordinal + 3*sigma ≈ mu */
const V2_DEFAULT_SIGMA = _INTERNAL_DEFAULT_SIGMA;

interface EvolutionRunSummaryV3 {
  version: 3;
  stopReason: string;
  finalPhase: 'EXPANSION' | 'COMPETITION';
  totalIterations: number;
  durationSeconds: number;
  eloHistory: number[][];
  diversityHistory: number[];
  matchStats: { totalMatches: number; avgConfidence: number; decisiveRate: number };
  topVariants: Array<{ id: string; strategy: string; elo: number; isBaseline: boolean }>;
  baselineRank: number | null;
  baselineElo: number | null;
  strategyEffectiveness: Record<string, { count: number; avgElo: number }>;
  metaFeedback: {
    successfulStrategies: string[];
    recurringWeaknesses: string[];
    patternsToAvoid: string[];
    priorityImprovements: string[];
  } | null;
  actionCounts?: Record<string, number>;
}

/** Shared transform helper: convert a legacy ordinal/elo value to a mu estimate. */
function legacyToMu(ordinal: number): number {
  return ordinal + 3 * V2_DEFAULT_SIGMA;
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
  eloHistory: v2.ordinalHistory.map((ord) => [legacyToMu(ord)]),
  diversityHistory: v2.diversityHistory,
  matchStats: v2.matchStats,
  topVariants: v2.topVariants.map((tv) => ({ id: tv.id, strategy: tv.strategy, elo: legacyToMu(tv.ordinal), isBaseline: tv.isBaseline })),
  baselineRank: v2.baselineRank,
  baselineElo: v2.baselineOrdinal != null ? legacyToMu(v2.baselineOrdinal) : null,
  strategyEffectiveness: Object.fromEntries(
    Object.entries(v2.strategyEffectiveness).map(([k, v]) => [k, { count: v.count, avgElo: legacyToMu(v.avgOrdinal) }]),
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
  eloHistory: v1.eloHistory.map((ord) => [legacyToMu(ord)]),
  diversityHistory: v1.diversityHistory,
  matchStats: v1.matchStats,
  topVariants: v1.topVariants.map((tv) => ({ id: tv.id, strategy: tv.strategy, elo: legacyToMu(tv.elo), isBaseline: tv.isBaseline })),
  baselineRank: v1.baselineRank,
  baselineElo: v1.baselineElo != null ? legacyToMu(v1.baselineElo) : null,
  strategyEffectiveness: Object.fromEntries(
    Object.entries(v1.strategyEffectiveness).map(([k, v]) => [k, { count: v.count, avgElo: legacyToMu(v.avgElo) }]),
  ),
  metaFeedback: v1.metaFeedback,
}));

export const EvolutionRunSummarySchema = z.union([
  EvolutionRunSummaryV3Schema,
  EvolutionRunSummaryV2Schema,
  EvolutionRunSummaryV1Schema,
]);
