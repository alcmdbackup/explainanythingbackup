// Strategy config utilities: hashing, labeling, and find-or-create by config hash.

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StrategyConfig } from '../infra/types';
import { evolutionStrategyInsertSchema } from '../../schemas';

// ─── Internal helpers ────────────────────────────────────────────

/** Shorten a model name for display (e.g. "gpt-4.1-mini" -> "4.1-mini"). */
function shortenModel(model: string): string {
  return model
    .replace('gpt-', '')
    .replace('deepseek-', 'ds-')
    .replace('claude-', 'cl-');
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Generate a stable 12-char hash for a strategy config.
 * Hashes: generationModel, judgeModel, iterationConfigs (full array).
 * Budget floors and other non-core fields are excluded.
 */
export function hashStrategyConfig(config: StrategyConfig): string {
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    iterationConfigs: config.iterationConfigs,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 12);
}

/** Auto-generated label: "Gen: model | Judge: model | 2×gen + 3×swiss". */
export function labelStrategyConfig(config: StrategyConfig): string {
  const genCount = config.iterationConfigs.filter((ic) => ic.agentType === 'generate').length;
  const swissCount = config.iterationConfigs.filter((ic) => ic.agentType === 'swiss').length;
  const iterLabel = [
    genCount > 0 ? `${genCount}×gen` : '',
    swissCount > 0 ? `${swissCount}×swiss` : '',
  ].filter(Boolean).join(' + ');

  const parts = [
    `Gen: ${shortenModel(config.generationModel)}`,
    `Judge: ${shortenModel(config.judgeModel)}`,
    iterLabel,
  ];

  if (config.budgetUsd != null) {
    parts.push(`Budget: $${config.budgetUsd.toFixed(2)}`);
  }

  return parts.join(' | ');
}

/**
 * Find-or-create a strategy row by config hash. Uses INSERT ... ON CONFLICT for race safety.
 * Throws on error (strategy_id is required for all runs).
 */
export async function upsertStrategy(
  db: SupabaseClient,
  config: StrategyConfig,
): Promise<string> {
  const hash = hashStrategyConfig(config);
  const label = labelStrategyConfig(config);
  const name = `Strategy ${hash.slice(0, 6)} (${config.generationModel.split('-').pop()}, ${config.iterationConfigs.length}it)`;

  const payload = evolutionStrategyInsertSchema.parse({ name, label, config, config_hash: hash });
  const { data, error } = await db
    .from('evolution_strategies')
    .upsert(
      payload,
      { onConflict: 'config_hash' },
    )
    .select('id')
    .single();

  if (error) {
    throw new Error(`Strategy upsert failed: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('Strategy upsert returned no ID');
  }
  return data.id;
}
