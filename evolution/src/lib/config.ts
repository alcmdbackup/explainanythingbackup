// Default configuration for the evolution pipeline.
// Per-run overrides stored in evolution_runs.config JSONB column.

import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import type { EvolutionRunConfig } from './types';

export const DEFAULT_EVOLUTION_CONFIG: EvolutionRunConfig = {
  maxIterations: 50,
  budgetCapUsd: 5.00,
  expansion: {
    minPool: 15,
    diversityThreshold: 0.25,
    maxIterations: 8,
  },
  generation: { strategies: 3 },
  calibration: { opponents: 5, minOpponents: 2 },
  tournament: { topK: 5 },
  judgeModel: 'gpt-4.1-nano' as AllowedLLMModelType,
  generationModel: 'gpt-4.1-mini' as AllowedLLMModelType,
};

/**
 * CFG-6: Deep merge for per-run config overrides.
 * Rules: undefined → use default, {} → intentional empty, explicit values → override.
 * Handles nested plain objects recursively; arrays and primitives are replaced outright.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(defaults: any, overrides: any): any {
  if (
    defaults === null || overrides === null ||
    typeof defaults !== 'object' || typeof overrides !== 'object' ||
    Array.isArray(defaults) || Array.isArray(overrides)
  ) {
    return overrides;
  }
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const overrideVal = overrides[key];
    if (overrideVal === undefined) continue; // undefined = use default
    const defaultVal = defaults[key];
    if (
      defaultVal !== null && overrideVal !== null &&
      typeof defaultVal === 'object' && typeof overrideVal === 'object' &&
      !Array.isArray(defaultVal) && !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(defaultVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }
  return result;
}

/** Merge per-run config overrides with defaults. Nested objects are deep-merged.
 *  Auto-clamps expansion.maxIterations when maxIterations is too small for the default expansion window. */
export function resolveConfig(overrides: Partial<EvolutionRunConfig>): EvolutionRunConfig {
  const resolved = deepMerge(DEFAULT_EVOLUTION_CONFIG, overrides) as EvolutionRunConfig;

  // Failsafe: clamp budgetCapUsd to hard cap
  if (resolved.budgetCapUsd > MAX_RUN_BUDGET_USD) {
    resolved.budgetCapUsd = MAX_RUN_BUDGET_USD;
  }

  // Auto-adjust expansion.maxIterations so supervisor validation passes
  // Clone expansion to avoid mutating DEFAULT_EVOLUTION_CONFIG via shared reference
  if (resolved.maxIterations <= resolved.expansion.maxIterations + 1) {
    resolved.expansion = { ...resolved.expansion };
    const original = resolved.expansion.maxIterations;
    resolved.expansion.maxIterations = Math.max(0, resolved.maxIterations - 1);
    console.warn(
      `[resolveConfig] Auto-clamped expansion.maxIterations: ${original} → ${resolved.expansion.maxIterations} (maxIterations=${resolved.maxIterations})`
    );
  }

  return resolved;
}

// ─── Budget hard caps (failsafe) ─────────────────────────────────

/** Maximum budget per single evolution run ($1). Enforced at queue time and as runner-level failsafe. */
export const MAX_RUN_BUDGET_USD = 1.00;

/** Maximum total budget per experiment ($10). Enforced when adding runs. */
export const MAX_EXPERIMENT_BUDGET_USD = 10.00;

// ─── Rating constants ────────────────────────────────────────────

export const RATING_CONSTANTS = {
  /** Sigma threshold below which a rating is considered converged. */
  CONVERGENCE_SIGMA_THRESHOLD: 3.0,
} as const;

