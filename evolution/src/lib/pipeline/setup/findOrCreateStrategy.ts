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
 * Canonicalize an iteration config for hashing: strip falsy optional fields
 * (`undefined`, `false`, missing) so that semantically-equivalent configs
 * produce identical hashes regardless of explicit-vs-omitted form.
 *
 * Example: `{useReflection: undefined}`, `{useReflection: false}`, and
 * `{}` (no useReflection key) all canonicalize to the same shape, preventing
 * silent re-hashing of pre-existing strategies on schema additions.
 *
 * Optional booleans: stripped if undefined OR false (treat absent === default-off).
 * Optional numbers: stripped if undefined.
 * Required fields and explicit non-falsy values pass through unchanged.
 */
function canonicalizeIterationConfig(
  iterCfg: StrategyConfig['iterationConfigs'][number],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    agentType: iterCfg.agentType,
    budgetPercent: iterCfg.budgetPercent,
  };
  // Optional non-boolean fields: include if present (any value, including null).
  if (iterCfg.sourceMode !== undefined) out.sourceMode = iterCfg.sourceMode;
  if (iterCfg.qualityCutoff !== undefined) out.qualityCutoff = iterCfg.qualityCutoff;
  if (iterCfg.generationGuidance !== undefined) out.generationGuidance = iterCfg.generationGuidance;
  // Optional booleans: include only when explicitly true (false === absent === default-off).
  if (iterCfg.useReflection === true) out.useReflection = true;
  // Optional numbers paired with optional flags: include only when defined AND meaningful.
  if (iterCfg.reflectionTopN !== undefined && iterCfg.useReflection === true) {
    out.reflectionTopN = iterCfg.reflectionTopN;
  }
  return out;
}

/**
 * Generate a stable 12-char hash for a strategy config.
 * Hashes: generationModel, judgeModel, iterationConfigs (canonicalized).
 * Budget floors and other non-core fields are excluded.
 */
export function hashStrategyConfig(config: StrategyConfig): string {
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    iterationConfigs: config.iterationConfigs.map(canonicalizeIterationConfig),
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
