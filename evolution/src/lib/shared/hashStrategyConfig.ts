/**
 * Strategy config identity and labeling utilities.
 * A "strategy" is a unique configuration fingerprint for model/iteration/budget combos.
 */

import type { AgentName } from '../types';
import type { V2StrategyConfig } from '../pipeline/infra/types';

// ─── Types ──────────────────────────────────────────────────────

export interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  agentModels?: Record<string, string>;
  iterations: number;
  /** Optional agents the user chose to enable. Undefined = all agents (backward compat). */
  enabledAgents?: AgentName[];
  /** When true, runs single-article pipeline mode. */
  singleArticle?: boolean;
  /** Per-run budget cap in USD. Excluded from config hash (metadata only). */
  budgetCapUsd?: number;
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
  config: V2StrategyConfig;
  is_predefined: boolean;
  pipeline_type: 'full' | 'single' | null;
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

  if (config.budgetCapUsd != null) {
    parts.push(`Budget: $${config.budgetCapUsd.toFixed(2)}`);
  }

  return parts.join(' | ');
}

/** Generate a default name like "Strategy abc123 (mini, 5it)". Users can edit later. */
export function defaultStrategyName(config: StrategyConfig, hash: string): string {
  const genModel = config.generationModel.split('-').pop() ?? 'unknown';
  return `Strategy ${hash.slice(0, 6)} (${genModel}, ${config.iterations}it)`;
}
