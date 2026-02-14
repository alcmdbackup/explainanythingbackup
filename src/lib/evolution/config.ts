// Default configuration for the evolution pipeline.
// Per-run overrides stored in content_evolution_runs.config JSONB column.

import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import type { EvolutionRunConfig } from './types';

export const DEFAULT_EVOLUTION_CONFIG: EvolutionRunConfig = {
  maxIterations: 15,
  budgetCapUsd: 5.00,
  plateau: { window: 3, threshold: 0.02 },
  expansion: {
    minPool: 15,
    minIterations: 3,
    diversityThreshold: 0.25,
    maxIterations: 8,
  },
  generation: { strategies: 3 },
  calibration: { opponents: 5, minOpponents: 2 },
  tournament: { topK: 5 },
  // Budget caps sum to >1.0 intentionally: not all agents run every iteration.
  // Per-agent caps are checked individually by costTracker.reserveBudget().
  budgetCaps: {
    generation: 0.20,
    calibration: 0.15,
    tournament: 0.20,
    pairwise: 0.20,
    evolution: 0.10,
    reflection: 0.05,
    debate: 0.05,
    iterativeEditing: 0.05,
    treeSearch: 0.10,
    outlineGeneration: 0.10,
    sectionDecomposition: 0.10,
    flowCritique: 0.05,
  },
  useEmbeddings: false,
  judgeModel: 'gpt-4.1-nano' as AllowedLLMModelType,
  generationModel: 'gpt-4.1-mini' as AllowedLLMModelType,
};

/** Merge per-run config overrides with defaults. Nested objects are shallow-merged individually. */
export function resolveConfig(overrides: Partial<EvolutionRunConfig>): EvolutionRunConfig {
  return {
    ...DEFAULT_EVOLUTION_CONFIG,
    ...overrides,
    plateau: { ...DEFAULT_EVOLUTION_CONFIG.plateau, ...overrides.plateau },
    expansion: { ...DEFAULT_EVOLUTION_CONFIG.expansion, ...overrides.expansion },
    generation: { ...DEFAULT_EVOLUTION_CONFIG.generation, ...overrides.generation },
    calibration: { ...DEFAULT_EVOLUTION_CONFIG.calibration, ...overrides.calibration },
    tournament: { ...DEFAULT_EVOLUTION_CONFIG.tournament, ...overrides.tournament },
    budgetCaps: { ...DEFAULT_EVOLUTION_CONFIG.budgetCaps, ...overrides.budgetCaps },
  };
}

// ─── Rating constants ────────────────────────────────────────────

export const RATING_CONSTANTS = {
  /** Sigma threshold below which a rating is considered converged. */
  CONVERGENCE_SIGMA_THRESHOLD: 3.0,
} as const;

