// Feature flags for gating evolution pipeline agents (tournament, evolve pool, dry-run).
// Fetches flags from the feature_flags table with safe defaults when rows are missing.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Per-agent feature flags for the evolution pipeline. */
export interface EvolutionFeatureFlags {
  /** Whether the Tournament agent runs in COMPETITION phase (false → use CalibrationRanker). */
  tournamentEnabled: boolean;
  /** Whether the EvolutionAgent (evolvePool) runs during iterations. */
  evolvePoolEnabled: boolean;
  /** When true, skip all pipeline execution — log only. */
  dryRunOnly: boolean;
}

/** Safe defaults: agents enabled, dry-run off. */
export const DEFAULT_EVOLUTION_FLAGS: EvolutionFeatureFlags = {
  tournamentEnabled: true,
  evolvePoolEnabled: true,
  dryRunOnly: false,
};

/** Flag name → field mapping. */
const FLAG_MAP: Record<string, keyof EvolutionFeatureFlags> = {
  evolution_tournament_enabled: 'tournamentEnabled',
  evolution_evolve_pool_enabled: 'evolvePoolEnabled',
  evolution_dry_run_only: 'dryRunOnly',
};

const FLAG_NAMES = Object.keys(FLAG_MAP);

/**
 * Fetch evolution feature flags from the feature_flags table.
 * Returns safe defaults for any missing rows.
 */
export async function fetchEvolutionFeatureFlags(
  supabase: SupabaseClient,
): Promise<EvolutionFeatureFlags> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('name, enabled')
    .in('name', FLAG_NAMES);

  if (error) {
    // On error, return safe defaults rather than crashing the pipeline
    return { ...DEFAULT_EVOLUTION_FLAGS };
  }

  const flags: EvolutionFeatureFlags = { ...DEFAULT_EVOLUTION_FLAGS };

  for (const row of data ?? []) {
    const field = FLAG_MAP[row.name];
    if (field) {
      flags[field] = row.enabled as boolean;
    }
  }

  return flags;
}
