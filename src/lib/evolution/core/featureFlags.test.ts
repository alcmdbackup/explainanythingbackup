// Tests for evolution feature flag fetching and pipeline integration.

import { fetchEvolutionFeatureFlags, DEFAULT_EVOLUTION_FLAGS } from './featureFlags';

function mockSupabase(rows: { name: string; enabled: boolean }[], error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: error ? null : rows, error }),
      }),
    }),
  } as never;
}

describe('fetchEvolutionFeatureFlags', () => {
  it('returns defaults when all flags present and enabled', async () => {
    const flags = await fetchEvolutionFeatureFlags(
      mockSupabase([
        { name: 'evolution_tournament_enabled', enabled: true },
        { name: 'evolution_evolve_pool_enabled', enabled: true },
        { name: 'evolution_dry_run_only', enabled: false },
      ]),
    );
    expect(flags).toEqual({
      tournamentEnabled: true,
      evolvePoolEnabled: true,
      dryRunOnly: false,
      debateEnabled: true,
      iterativeEditingEnabled: true,
      outlineGenerationEnabled: false,
      treeSearchEnabled: false,
      sectionDecompositionEnabled: true,
      flowCritiqueEnabled: false,
    });
  });

  it('returns correct values when flags are toggled', async () => {
    const flags = await fetchEvolutionFeatureFlags(
      mockSupabase([
        { name: 'evolution_tournament_enabled', enabled: false },
        { name: 'evolution_evolve_pool_enabled', enabled: false },
        { name: 'evolution_dry_run_only', enabled: true },
      ]),
    );
    expect(flags).toEqual({
      tournamentEnabled: false,
      evolvePoolEnabled: false,
      dryRunOnly: true,
      debateEnabled: true,
      iterativeEditingEnabled: true,
      outlineGenerationEnabled: false,
      treeSearchEnabled: false,
      sectionDecompositionEnabled: true,
      flowCritiqueEnabled: false,
    });
  });

  it('uses defaults for missing flags', async () => {
    const flags = await fetchEvolutionFeatureFlags(
      mockSupabase([{ name: 'evolution_tournament_enabled', enabled: false }]),
    );
    expect(flags.tournamentEnabled).toBe(false);
    expect(flags.evolvePoolEnabled).toBe(true); // default
    expect(flags.dryRunOnly).toBe(false); // default
  });

  it('returns all defaults for empty table', async () => {
    const flags = await fetchEvolutionFeatureFlags(mockSupabase([]));
    expect(flags).toEqual(DEFAULT_EVOLUTION_FLAGS);
  });

  it('returns safe defaults on query error', async () => {
    const flags = await fetchEvolutionFeatureFlags(
      mockSupabase([], { code: '42P01', message: 'table not found' }),
    );
    expect(flags).toEqual(DEFAULT_EVOLUTION_FLAGS);
  });
});
