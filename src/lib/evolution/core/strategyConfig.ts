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

/**
 * DB row representation of strategy_configs, including fields NOT in the hash.
 * is_predefined and pipeline_type are metadata — they don't affect config identity.
 */
export interface StrategyConfigRow {
  id: string;
  config_hash: string;
  name: string;
  description: string | null;
  label: string;
  config: StrategyConfig;
  is_predefined: boolean;
  pipeline_type: 'full' | 'minimal' | 'batch' | null;
  status: 'active' | 'archived';
  created_by: 'system' | 'admin';
  run_count: number;
  total_cost_usd: number;
  avg_final_elo: number | null;
  avg_elo_per_dollar: number | null;
  best_final_elo: number | null;
  worst_final_elo: number | null;
  stddev_final_elo: number | null;
  first_used_at: string;
  last_used_at: string;
  created_at: string;
}

// ─── Hashing ────────────────────────────────────────────────────

/** Sort object keys alphabetically for stable serialization. */
function sortKeys<V>(obj: Record<string, V>): Record<string, V> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

/** Generate a stable 12-char hash for a strategy config. Identical settings produce the same hash. */
export function hashStrategyConfig(config: StrategyConfig): string {
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    agentModels: config.agentModels ? sortKeys(config.agentModels) : null,
    iterations: config.iterations,
    budgetCaps: sortKeys(config.budgetCaps),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 12);
}

// ─── Labeling ───────────────────────────────────────────────────

/** Shorten a model name for display (e.g. "gpt-4.1-mini" -> "4.1-mini"). */
function shortenModel(model: string): string {
  return model
    .replace('gpt-', '')
    .replace('deepseek-', 'ds-')
    .replace('claude-', 'cl-');
}

/** Auto-generated label: "Gen: model | Judge: model | N iters | Overrides: ..." */
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

/** Generate a default name like "Strategy abc123 (mini, 5it)". Users can edit later. */
export function defaultStrategyName(config: StrategyConfig, hash: string): string {
  const genModel = config.generationModel.split('-').pop() ?? 'unknown';
  return `Strategy ${hash.slice(0, 6)} (${genModel}, ${config.iterations}it)`;
}

// ─── Config Extraction ──────────────────────────────────────────

/** Extract StrategyConfig from EvolutionRunConfig, filling defaults for missing fields. */
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

/** Compare two strategy configs and return a list of field-level differences. */
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
