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
 * Canonicalize an iteration config for hashing: strip undefined optional fields
 * so that semantically-equivalent configs produce identical hashes regardless
 * of explicit-vs-omitted form.
 *
 * Reflection: `agentType: 'reflect_and_generate'` is a top-level enum value (Shape A),
 * so the iterCfg.agentType field carries the reflection signal directly. There is no
 * separate `useReflection` boolean to canonicalize. `reflectionTopN` is only meaningful
 * for reflect_and_generate iterations and is stripped for any other agent type.
 */
function canonicalizeIterationConfig(
  iterCfg: StrategyConfig['iterationConfigs'][number],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    agentType: iterCfg.agentType,
    budgetPercent: iterCfg.budgetPercent,
  };
  // Optional fields: include if present (any value, including null).
  if (iterCfg.sourceMode !== undefined) out.sourceMode = iterCfg.sourceMode;
  if (iterCfg.qualityCutoff !== undefined) out.qualityCutoff = iterCfg.qualityCutoff;
  if (iterCfg.generationGuidance !== undefined) out.generationGuidance = iterCfg.generationGuidance;
  // reflectionTopN only meaningful when the agent IS the reflection wrapper.
  if (iterCfg.reflectionTopN !== undefined && iterCfg.agentType === 'reflect_and_generate') {
    out.reflectionTopN = iterCfg.reflectionTopN;
  }
  // criteriaIds + weakestK only meaningful when the agent IS the criteria wrapper.
  // Decision (committed): SORT criteriaIds before hashing — two strategies referencing
  // the same set of criteria in different orders are semantically equivalent (the wrapper
  // evaluates ALL configured criteria regardless of order; weakest-K selection is
  // deterministic on score).
  if (iterCfg.criteriaIds !== undefined && iterCfg.criteriaIds.length > 0
      && iterCfg.agentType === 'criteria_and_generate') {
    out.criteriaIds = [...iterCfg.criteriaIds].sort();
  }
  if (iterCfg.weakestK !== undefined && iterCfg.agentType === 'criteria_and_generate') {
    out.weakestK = iterCfg.weakestK;
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
  const reflectCount = config.iterationConfigs.filter((ic) => ic.agentType === 'reflect_and_generate').length;
  const editCount = config.iterationConfigs.filter((ic) => ic.agentType === 'iterative_editing').length;
  const swissCount = config.iterationConfigs.filter((ic) => ic.agentType === 'swiss').length;
  const iterLabel = [
    genCount > 0 ? `${genCount}×gen` : '',
    reflectCount > 0 ? `${reflectCount}×reflect` : '',
    editCount > 0 ? `${editCount}×edit` : '',
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
