/**
 * Strategy config identity and labeling utilities.
 * A "strategy" is a unique configuration fingerprint for model/iteration/budget combos.
 */

import { createHash } from 'crypto';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';

// ─── Types ──────────────────────────────────────────────────────

export interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  agentModels?: Record<string, string>;
  iterations: number;
  budgetCaps: Record<string, number>;
}

// ─── Hashing ────────────────────────────────────────────────────

/**
 * Generate a stable hash for a strategy config.
 * Configs with identical settings get the same hash.
 */
export function hashStrategyConfig(config: StrategyConfig): string {
  // Normalize: sort keys, remove undefined, ensure consistent order
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    agentModels: config.agentModels
      ? Object.keys(config.agentModels).sort().reduce((acc, k) => {
          acc[k] = config.agentModels![k];
          return acc;
        }, {} as Record<string, string>)
      : null,
    iterations: config.iterations,
    budgetCaps: Object.keys(config.budgetCaps).sort().reduce((acc, k) => {
      acc[k] = config.budgetCaps[k];
      return acc;
    }, {} as Record<string, number>),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 12);
}

// ─── Labeling ───────────────────────────────────────────────────

/**
 * Shorten a model name for display.
 */
function shortenModel(model: string): string {
  return model
    .replace('gpt-', '')
    .replace('deepseek-', 'ds-')
    .replace('claude-', 'cl-');
}

/**
 * Auto-generated label describing the strategy config.
 * Format: "Gen: model | Judge: model | Iters: N | Overrides: ..."
 */
export function labelStrategyConfig(config: StrategyConfig): string {
  const parts: string[] = [];

  // Generation model (shortened)
  parts.push(`Gen: ${shortenModel(config.generationModel)}`);

  // Judge model (shortened)
  parts.push(`Judge: ${shortenModel(config.judgeModel)}`);

  // Iterations
  parts.push(`${config.iterations} iters`);

  // Per-agent overrides (if any)
  if (config.agentModels && Object.keys(config.agentModels).length > 0) {
    const overrides = Object.entries(config.agentModels)
      .map(([agent, model]) => `${agent}: ${shortenModel(model)}`)
      .join(', ');
    parts.push(`Overrides: ${overrides}`);
  }

  return parts.join(' | ');
}

/**
 * Generate a default name for a new strategy.
 * Users can edit this to something more meaningful.
 */
export function defaultStrategyName(config: StrategyConfig, hash: string): string {
  const genModel = config.generationModel.split('-').pop() ?? 'unknown';
  return `Strategy ${hash.slice(0, 6)} (${genModel}, ${config.iterations}it)`;
}

// ─── Config Extraction ──────────────────────────────────────────

/**
 * Extract StrategyConfig from EvolutionRunConfig.
 */
export function extractStrategyConfig(
  runConfig: {
    generationModel?: AllowedLLMModelType;
    judgeModel?: AllowedLLMModelType;
    maxIterations?: number;
    budgetCaps?: Record<string, number>;
    agentModels?: Record<string, AllowedLLMModelType>;
  },
  defaultBudgetCaps: Record<string, number>
): StrategyConfig {
  return {
    generationModel: runConfig.generationModel ?? 'deepseek-chat',
    judgeModel: runConfig.judgeModel ?? 'gpt-4.1-nano',
    agentModels: runConfig.agentModels,
    iterations: runConfig.maxIterations ?? 15,
    budgetCaps: runConfig.budgetCaps ?? defaultBudgetCaps,
  };
}

// ─── Comparison ─────────────────────────────────────────────────

/**
 * Compare two strategy configs and return differences.
 */
export function diffStrategyConfigs(
  a: StrategyConfig,
  b: StrategyConfig
): Array<{ field: string; valueA: string; valueB: string }> {
  const diffs: Array<{ field: string; valueA: string; valueB: string }> = [];

  if (a.generationModel !== b.generationModel) {
    diffs.push({ field: 'generationModel', valueA: a.generationModel, valueB: b.generationModel });
  }

  if (a.judgeModel !== b.judgeModel) {
    diffs.push({ field: 'judgeModel', valueA: a.judgeModel, valueB: b.judgeModel });
  }

  if (a.iterations !== b.iterations) {
    diffs.push({ field: 'iterations', valueA: String(a.iterations), valueB: String(b.iterations) });
  }

  // Compare agent model overrides
  const allAgents = new Set([
    ...Object.keys(a.agentModels ?? {}),
    ...Object.keys(b.agentModels ?? {}),
  ]);

  for (const agent of allAgents) {
    const valA = a.agentModels?.[agent] ?? '-';
    const valB = b.agentModels?.[agent] ?? '-';
    if (valA !== valB) {
      diffs.push({ field: `agentModels.${agent}`, valueA: valA, valueB: valB });
    }
  }

  return diffs;
}
