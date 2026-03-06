/**
 * Zod schemas for batch evolution run configuration.
 * Enables combinatorial exploration of model × iteration × budget configuration space.
 */

import { z } from 'zod';
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';

// ─── Agent Budget Caps Schema ───────────────────────────────────

/** Agent budget allocation as percentages (0.0-1.0). */
export const AgentBudgetCapsSchema = z.object({
  generation: z.number().min(0).max(1).optional(),
  calibration: z.number().min(0).max(1).optional(),
  tournament: z.number().min(0).max(1).optional(),
  evolution: z.number().min(0).max(1).optional(),
  reflection: z.number().min(0).max(1).optional(),
  debate: z.number().min(0).max(1).optional(),
  iterativeEditing: z.number().min(0).max(1).optional(),
  treeSearch: z.number().min(0).max(1).optional(),
  outlineGeneration: z.number().min(0).max(1).optional(),
  sectionDecomposition: z.number().min(0).max(1).optional(),
  flowCritique: z.number().min(0).max(1).optional(),
  pairwise: z.number().min(0).max(1).optional(),
}).refine(caps => {
  const sum = Object.values(caps).reduce((a, b) => a + (b ?? 0), 0);
  return sum <= 1.0;
}, { message: 'Agent budget caps must sum to <= 1.0' });

export type AgentBudgetCaps = z.infer<typeof AgentBudgetCapsSchema>;

// ─── Agent Models Schema ────────────────────────────────────────

/**
 * Per-agent model overrides for fine-grained experimentation.
 * Allows assigning different models to different agents.
 */
export const AgentModelsSchema = z.object({
  // Generation agents (text creation) - default: generationModel
  generation: allowedLLMModelSchema.optional(),
  evolution: allowedLLMModelSchema.optional(),
  reflection: allowedLLMModelSchema.optional(),
  debate: allowedLLMModelSchema.optional(),
  iterativeEditing: allowedLLMModelSchema.optional(),
  // Judge agents (comparison/ranking) - default: judgeModel
  calibration: allowedLLMModelSchema.optional(),
  tournament: allowedLLMModelSchema.optional(),
}).describe('Per-agent model overrides. Unset agents use generationModel/judgeModel defaults.');

export type AgentModels = z.infer<typeof AgentModelsSchema>;

// ─── Single Run Spec Schema ─────────────────────────────────────

export const BatchRunSpecSchema = z.object({
  prompt: z.string().min(1),
  generationModel: allowedLLMModelSchema,
  judgeModel: allowedLLMModelSchema,
  agentModels: AgentModelsSchema.optional(),
  iterations: z.number().min(1).max(30),
  budgetCapUsd: z.number().positive(),
  budgetCaps: AgentBudgetCapsSchema.optional(),
  mode: z.enum(['minimal', 'full']).default('full'),
  bankCheckpoints: z.array(z.number()).optional(),
});

export type BatchRunSpec = z.infer<typeof BatchRunSpecSchema>;

// ─── Full Batch Config Schema ───────────────────────────────────

export const BatchConfigSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Name must be alphanumeric with underscores/hyphens'),
  description: z.string().optional(),
  totalBudgetUsd: z.number().positive(),
  safetyMargin: z.number().min(0).max(0.5).default(0.1),

  // Default values for all runs
  defaults: BatchRunSpecSchema.partial().optional(),

  // Matrix for combinatorial expansion
  matrix: z.object({
    prompts: z.array(z.string().min(1)).min(1),
    generationModels: z.array(allowedLLMModelSchema).min(1),
    judgeModels: z.array(allowedLLMModelSchema).min(1),
    iterations: z.array(z.number().min(1).max(30)).min(1),
    // Optional: per-agent model matrices for fine-grained experimentation
    agentModelVariants: z.array(AgentModelsSchema).optional(),
  }).optional(),

  // Explicit run list (merged with matrix expansion)
  runs: z.array(BatchRunSpecSchema.partial()).optional(),

  // Post-batch comparison settings
  comparison: z.object({
    enabled: z.boolean().default(true),
    judgeModel: allowedLLMModelSchema,
    rounds: z.number().min(1).max(10).default(3),
  }).optional(),

  // Optimization settings
  optimization: z.object({
    adaptiveAllocation: z.boolean().default(false),
    prioritySort: z.enum(['cost_asc', 'elo_per_dollar_desc', 'random']).default('cost_asc'),
  }).optional(),
});

export type BatchConfig = z.infer<typeof BatchConfigSchema>;

// ─── Expanded Run Types ─────────────────────────────────────────

export interface ExpandedRun extends BatchRunSpec {
  estimatedCost: number;
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  runId?: string;
  actualCost?: number;
  topElo?: number;
}

export interface BatchExecutionPlan {
  config: BatchConfig;
  runs: ExpandedRun[];
  totalEstimatedCost: number;
  runsPlanned: number;
  runsSkipped: number;
  effectiveBudget: number;
}

// ─── Expansion Algorithm ────────────────────────────────────────

/**
 * Expand batch config into individual run specs.
 * Builds Cartesian product from matrix, applies defaults, adds explicit runs.
 */
export function expandBatchConfig(config: BatchConfig): ExpandedRun[] {
  const expanded: ExpandedRun[] = [];

  // 1. Build Cartesian product from matrix
  if (config.matrix) {
    const agentModelVariants = config.matrix.agentModelVariants?.length
      ? config.matrix.agentModelVariants
      : [{}]; // Default: no per-agent overrides

    for (const prompt of config.matrix.prompts) {
      for (const genModel of config.matrix.generationModels) {
        for (const judgeModel of config.matrix.judgeModels) {
          for (const iterations of config.matrix.iterations) {
            for (const agentModels of agentModelVariants) {
              expanded.push({
                ...config.defaults,
                prompt,
                generationModel: genModel,
                judgeModel,
                iterations,
                agentModels: Object.keys(agentModels).length > 0 ? agentModels : undefined,
                budgetCapUsd: config.defaults?.budgetCapUsd ?? 5.0,
                mode: config.defaults?.mode ?? 'full',
                estimatedCost: 0,
                priority: 0,
                status: 'pending',
              } as ExpandedRun);
            }
          }
        }
      }
    }
  }

  // 2. Add explicit runs (merged with defaults)
  if (config.runs) {
    for (const run of config.runs) {
      const merged = { ...config.defaults, ...run };
      if (!merged.prompt || !merged.generationModel || !merged.judgeModel || !merged.iterations) {
        continue;
      }
      expanded.push({
        ...merged,
        budgetCapUsd: merged.budgetCapUsd ?? 5.0,
        mode: merged.mode ?? 'full',
        estimatedCost: 0,
        priority: 0,
        status: 'pending',
      } as ExpandedRun);
    }
  }

  return expanded;
}

/**
 * Filter runs to fit within budget constraint using greedy selection.
 * Sorts by priority strategy, then greedily includes runs until budget exhausted.
 */
export function filterByBudget(
  runs: ExpandedRun[],
  totalBudget: number,
  safetyMargin: number,
  prioritySort: 'cost_asc' | 'elo_per_dollar_desc' | 'random'
): ExpandedRun[] {
  const effectiveBudget = totalBudget * (1 - safetyMargin);
  const sorted = [...runs];

  // Sort by priority strategy
  if (prioritySort === 'cost_asc') {
    sorted.sort((a, b) => a.estimatedCost - b.estimatedCost);
  } else if (prioritySort === 'elo_per_dollar_desc') {
    sorted.sort((a, b) => b.priority - a.priority);
  } else {
    // Random shuffle
    for (let i = sorted.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    }
  }

  // Greedily select until budget exhausted
  let budgetRemaining = effectiveBudget;
  for (const run of sorted) {
    if (run.estimatedCost <= budgetRemaining) {
      budgetRemaining -= run.estimatedCost;
    } else {
      run.status = 'skipped';
    }
  }

  return sorted;
}

// ─── Validation Helpers ─────────────────────────────────────────

/**
 * Validate and parse a batch config JSON.
 */
export function parseBatchConfig(raw: unknown): BatchConfig {
  return BatchConfigSchema.parse(raw);
}

/**
 * Validate batch config with detailed error messages.
 */
export function validateBatchConfig(raw: unknown): { success: true; data: BatchConfig } | { success: false; errors: string[] } {
  const result = BatchConfigSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
  };
}
