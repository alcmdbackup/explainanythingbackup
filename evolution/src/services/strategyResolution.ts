// Atomic strategy resolution: find-or-create a strategy config row by config hash.
// Uses upsert + fallback SELECT to eliminate TOCTOU race conditions.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import {
  extractStrategyConfig,
  hashStrategyConfig,
  labelStrategyConfig,
  defaultStrategyName,
  normalizeEnabledAgents,
  type StrategyConfig,
  type StrategyConfigRow,
} from '@evolution/lib/core/strategyConfig';

type SupabaseService = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

export interface ResolvedStrategy {
  id: string;
  isNew: boolean;
}

interface ResolveFromConfigOptions {
  config: StrategyConfig;
  createdBy: StrategyConfigRow['created_by'];
  customName?: string;
}

interface ResolveFromRunConfigOptions {
  runConfig: {
    generationModel?: string;
    judgeModel?: string;
    maxIterations?: number;
    agentModels?: Record<string, string>;
    enabledAgents?: string[];
    singleArticle?: boolean;
  };
  createdBy: StrategyConfigRow['created_by'];
  customName?: string;
}

/**
 * Resolve or create a strategy config from an already-extracted StrategyConfig.
 * Uses atomic upsert + fallback SELECT to eliminate TOCTOU race conditions.
 */
export async function resolveOrCreateStrategy(
  opts: ResolveFromConfigOptions,
  supabase?: SupabaseService,
): Promise<ResolvedStrategy> {
  const sb = supabase ?? await createSupabaseServiceClient();

  const config: StrategyConfig = {
    ...opts.config,
    enabledAgents: normalizeEnabledAgents(opts.config.enabledAgents),
  };
  // Strategy reuse: hashStrategyConfig produces a stable SHA-256 hash from
  // (generationModel, judgeModel, iterations, enabledAgents, singleArticle).
  // Identical configs produce the same hash → INSERT hits the unique constraint
  // and falls back to SELECT, returning the existing strategy row. This dedup
  // is intentional: multiple runs/experiments sharing a config share one strategy.
  const configHash = hashStrategyConfig(config);
  const label = labelStrategyConfig(config);
  const name = opts.customName ?? defaultStrategyName(config, configHash);

  // Atomic: try INSERT first (wins the race)
  const { data: created, error: insertErr } = await sb
    .from('evolution_strategy_configs')
    .insert({
      config_hash: configHash,
      name,
      label,
      config,
      created_by: opts.createdBy,
    })
    .select('id')
    .single();

  if (created) {
    return { id: created.id, isNew: true };
  }

  // INSERT failed — likely unique constraint on config_hash. Fallback to SELECT.
  const { data: existing } = await sb
    .from('evolution_strategy_configs')
    .select('id')
    .eq('config_hash', configHash)
    .single();

  if (existing) {
    return { id: existing.id, isNew: false };
  }

  // Neither insert nor select worked — propagate the original error
  throw new Error(`Failed to resolve strategy config: ${insertErr?.message ?? 'unknown error'}`);
}

/**
 * Resolve or create a strategy config from a raw run config (experiment/batch callers).
 * Extracts StrategyConfig internally, then delegates to the core resolver.
 */
export async function resolveOrCreateStrategyFromRunConfig(
  opts: ResolveFromRunConfigOptions,
  supabase?: SupabaseService,
): Promise<ResolvedStrategy> {
  const stratConfig = extractStrategyConfig(
    opts.runConfig as Parameters<typeof extractStrategyConfig>[0],
  );
  return resolveOrCreateStrategy(
    { config: stratConfig, createdBy: opts.createdBy, customName: opts.customName },
    supabase,
  );
}
