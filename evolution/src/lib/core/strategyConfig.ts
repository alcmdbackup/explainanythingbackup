/**
 * Strategy config identity and labeling utilities.
 * A "strategy" is a unique configuration fingerprint for model/iteration/budget combos.
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import { allowedLLMModelSchema, type AllowedLLMModelType } from '@/lib/schemas/schemas';
import type { AgentName } from '../types';
import { EVOLUTION_DEFAULT_MODEL } from './llmClient';

// ─── Types ──────────────────────────────────────────────────────

export interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  agentModels?: Record<string, string>;
  iterations: number;
  budgetCaps: Record<string, number>;
  /** Optional agents the user chose to enable. Undefined = all agents (backward compat). */
  enabledAgents?: AgentName[];
  /** When true, runs single-article pipeline mode. */
  singleArticle?: boolean;
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
  pipeline_type: 'full' | 'minimal' | 'batch' | 'single' | null;
  status: 'active' | 'archived';
  created_by: 'system' | 'admin' | 'experiment' | 'batch';
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

// ─── Normalization ───────────────────────────────────────────────

/** Normalize enabledAgents before hashing: undefined → omit, [] → undefined, non-empty → sort. */
export function normalizeEnabledAgents(agents: AgentName[] | undefined): AgentName[] | undefined {
  if (!agents || agents.length === 0) return undefined;
  return [...agents].sort() as AgentName[];
}

// ─── Hashing ────────────────────────────────────────────────────

/** Generate a stable 12-char hash for a strategy config. Identical settings produce the same hash.
 *  Only hashes: generationModel, judgeModel, iterations, enabledAgents (agentModels/budgetCaps excluded). */
export function hashStrategyConfig(config: StrategyConfig): string {
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    iterations: config.iterations,
    // Only include when set — preserves hash for existing strategies without these fields
    ...(config.enabledAgents ? { enabledAgents: config.enabledAgents.slice().sort() } : {}),
    ...(config.singleArticle ? { singleArticle: true } : {}),
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
  const parts = [
    `Gen: ${shortenModel(config.generationModel)}`,
    `Judge: ${shortenModel(config.judgeModel)}`,
    `${config.iterations} iters`,
  ];

  if (config.agentModels && Object.keys(config.agentModels).length > 0) {
    const overrides = Object.entries(config.agentModels)
      .map(([agent, model]) => `${agent}: ${shortenModel(model)}`)
      .join(', ');
    parts.push(`Overrides: ${overrides}`);
  }

  if (config.enabledAgents) {
    const requiredCount = config.singleArticle ? 3 : 4;
    parts.push(`${config.enabledAgents.length + requiredCount} agents`);
  }

  if (config.singleArticle) {
    parts.push('single-article');
  }

  return parts.join(' | ');
}

/** Generate a default name like "Strategy abc123 (mini, 5it)". Users can edit later. */
export function defaultStrategyName(config: StrategyConfig, hash: string): string {
  const genModel = config.generationModel.split('-').pop() ?? 'unknown';
  return `Strategy ${hash.slice(0, 6)} (${genModel}, ${config.iterations}it)`;
}

// ─── Config Extraction ──────────────────────────────────────────

// CFG-8: Zod schema validates model names and value ranges at runtime.
const extractStrategyConfigInputSchema = z.object({
  generationModel: allowedLLMModelSchema.optional(),
  judgeModel: allowedLLMModelSchema.optional(),
  maxIterations: z.number().int().min(1).max(100).optional(),
  budgetCaps: z.record(z.string(), z.number().min(0).max(10)).optional(),
  agentModels: z.record(z.string(), allowedLLMModelSchema).optional(),
  enabledAgents: z.array(z.string()).optional(),
  singleArticle: z.boolean().optional(),
}).passthrough();

/**
 * Extract StrategyConfig from EvolutionRunConfig, filling defaults for missing fields.
 * CFG-8: Validates model names against AllowedLLMModelType and value ranges via Zod.
 * Throws ZodError on invalid input.
 */
export function extractStrategyConfig(
  runConfig: {
    generationModel?: AllowedLLMModelType;
    judgeModel?: AllowedLLMModelType;
    maxIterations?: number;
    budgetCaps?: Record<string, number>;
    agentModels?: Record<string, AllowedLLMModelType>;
    enabledAgents?: AgentName[];
    singleArticle?: boolean;
  },
  defaultBudgetCaps: Record<string, number>
): StrategyConfig {
  extractStrategyConfigInputSchema.parse(runConfig);

  return {
    generationModel: runConfig.generationModel ?? EVOLUTION_DEFAULT_MODEL,
    judgeModel: runConfig.judgeModel ?? 'gpt-4.1-nano',
    iterations: runConfig.maxIterations ?? 15,
    budgetCaps: runConfig.budgetCaps ?? defaultBudgetCaps,
    enabledAgents: runConfig.enabledAgents,
    singleArticle: runConfig.singleArticle,
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

  const agentsA = (a.enabledAgents ?? []).slice().sort().join(',');
  const agentsB = (b.enabledAgents ?? []).slice().sort().join(',');
  if (agentsA !== agentsB) {
    diffs.push({ field: 'enabledAgents', valueA: agentsA || '-', valueB: agentsB || '-' });
  }

  if ((a.singleArticle ?? false) !== (b.singleArticle ?? false)) {
    diffs.push({ field: 'singleArticle', valueA: String(a.singleArticle ?? false), valueB: String(b.singleArticle ?? false) });
  }

  return diffs;
}
