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
  budgetCaps: {
    generation: 0.25,
    calibration: 0.15,
    tournament: 0.25,
    evolution: 0.15,
    reflection: 0.05,
    debate: 0.05,
    iterativeEditing: 0.10,
  },
  useEmbeddings: false,
  judgeModel: 'gpt-4.1-nano' as AllowedLLMModelType,
  generationModel: 'gpt-4.1-mini' as AllowedLLMModelType,
};

/** Merge per-run config overrides with defaults. */
export function resolveConfig(overrides: Partial<EvolutionRunConfig>): EvolutionRunConfig {
  return {
    ...DEFAULT_EVOLUTION_CONFIG,
    ...overrides,
    plateau: { ...DEFAULT_EVOLUTION_CONFIG.plateau, ...overrides.plateau },
    expansion: { ...DEFAULT_EVOLUTION_CONFIG.expansion, ...overrides.expansion },
    generation: { ...DEFAULT_EVOLUTION_CONFIG.generation, ...overrides.generation },
    calibration: { ...DEFAULT_EVOLUTION_CONFIG.calibration, ...overrides.calibration },
    budgetCaps: { ...DEFAULT_EVOLUTION_CONFIG.budgetCaps, ...overrides.budgetCaps },
    judgeModel: overrides.judgeModel ?? DEFAULT_EVOLUTION_CONFIG.judgeModel,
    generationModel: overrides.generationModel ?? DEFAULT_EVOLUTION_CONFIG.generationModel,
  };
}

// ─── Rating constants ────────────────────────────────────────────

export const RATING_CONSTANTS = {
  /** Sigma threshold below which a rating is considered converged. */
  CONVERGENCE_SIGMA_THRESHOLD: 3.0,
} as const;

