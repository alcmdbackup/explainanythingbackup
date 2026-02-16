// Tests for evolution feature flags: env var reads, mutex behavior, and defaults.

import { getFeatureFlags, DEFAULT_EVOLUTION_FLAGS } from './featureFlags';

describe('getFeatureFlags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all evolution env vars
    delete process.env.EVOLUTION_TREE_SEARCH;
    delete process.env.EVOLUTION_OUTLINE_GENERATION;
    delete process.env.EVOLUTION_FLOW_CRITIQUE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns all core flags as true and experimentals as false by default', () => {
    const flags = getFeatureFlags();
    expect(flags).toEqual({
      tournamentEnabled: true,
      evolvePoolEnabled: true,
      debateEnabled: true,
      iterativeEditingEnabled: true,
      sectionDecompositionEnabled: true,
      outlineGenerationEnabled: false,
      treeSearchEnabled: false,
      flowCritiqueEnabled: false,
    });
  });

  it('matches DEFAULT_EVOLUTION_FLAGS when no env vars set', () => {
    const flags = getFeatureFlags();
    expect(flags).toEqual(DEFAULT_EVOLUTION_FLAGS);
  });

  it('enables treeSearch and disables iterativeEditing when EVOLUTION_TREE_SEARCH=true (mutex)', () => {
    process.env.EVOLUTION_TREE_SEARCH = 'true';
    const flags = getFeatureFlags();
    expect(flags.treeSearchEnabled).toBe(true);
    expect(flags.iterativeEditingEnabled).toBe(false);
  });

  it('enables outlineGeneration when EVOLUTION_OUTLINE_GENERATION=true', () => {
    process.env.EVOLUTION_OUTLINE_GENERATION = 'true';
    const flags = getFeatureFlags();
    expect(flags.outlineGenerationEnabled).toBe(true);
  });

  it('enables flowCritique when EVOLUTION_FLOW_CRITIQUE=true', () => {
    process.env.EVOLUTION_FLOW_CRITIQUE = 'true';
    const flags = getFeatureFlags();
    expect(flags.flowCritiqueEnabled).toBe(true);
  });

  it('ignores non-"true" values for EVOLUTION_TREE_SEARCH', () => {
    process.env.EVOLUTION_TREE_SEARCH = '1';
    const flags = getFeatureFlags();
    expect(flags.treeSearchEnabled).toBe(false);
    expect(flags.iterativeEditingEnabled).toBe(true);
  });

  it('core flags are always true regardless of env vars', () => {
    process.env.EVOLUTION_TREE_SEARCH = 'true';
    process.env.EVOLUTION_OUTLINE_GENERATION = 'true';
    process.env.EVOLUTION_FLOW_CRITIQUE = 'true';
    const flags = getFeatureFlags();
    expect(flags.tournamentEnabled).toBe(true);
    expect(flags.evolvePoolEnabled).toBe(true);
    expect(flags.debateEnabled).toBe(true);
    expect(flags.sectionDecompositionEnabled).toBe(true);
  });
});
