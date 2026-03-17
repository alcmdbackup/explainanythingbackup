// Barrel smoke test: verifies all V2 exports resolve correctly.

describe('V2 barrel (index.ts)', () => {
  it('resolves via require.resolve', () => {
    expect(() => require.resolve('@evolution/lib/v2/')).not.toThrow();
  });

  it('dynamic import resolves full transitive dep tree', async () => {
    const v2 = await import('@evolution/lib/v2/');
    expect(v2).toBeDefined();
  });

  it('exports all V1 runtime re-exports', async () => {
    const v2 = await import('@evolution/lib/v2/');

    // Classes
    expect(v2.BudgetExceededError).toBeDefined();
    expect(typeof v2.BudgetExceededError).toBe('function');
    expect(v2.BudgetExceededError.prototype).toBeDefined();

    // Rating functions
    expect(typeof v2.createRating).toBe('function');
    expect(typeof v2.updateRating).toBe('function');
    expect(typeof v2.updateDraw).toBe('function');
    expect(typeof v2.toEloScale).toBe('function');
    expect(typeof v2.isConverged).toBe('function');
    expect(typeof v2.computeEloPerDollar).toBe('function');

    // Rating constants
    expect(typeof v2.DEFAULT_MU).toBe('number');
    expect(typeof v2.DEFAULT_SIGMA).toBe('number');
    expect(typeof v2.DEFAULT_CONVERGENCE_SIGMA).toBe('number');
    expect(typeof v2.ELO_SIGMA_SCALE).toBe('number');
    expect(typeof v2.DECISIVE_CONFIDENCE_THRESHOLD).toBe('number');

    // Comparison
    expect(typeof v2.compareWithBiasMitigation).toBe('function');
    expect(typeof v2.parseWinner).toBe('function');
    expect(typeof v2.aggregateWinners).toBe('function');
    expect(typeof v2.buildComparisonPrompt).toBe('function');

    // Reversal
    expect(typeof v2.run2PassReversal).toBe('function');

    // Cache
    expect(typeof v2.ComparisonCache).toBe('function');
    expect(typeof v2.MAX_CACHE_SIZE).toBe('number');

    // Format
    expect(typeof v2.validateFormat).toBe('function');
    expect(typeof v2.FORMAT_RULES).toBe('string');

    // Factory
    expect(typeof v2.createTextVariation).toBe('function');

    // Error classification
    expect(typeof v2.isTransientError).toBe('function');

    // V2 strategy (forked)
    expect(typeof v2.hashStrategyConfig).toBe('function');
    expect(typeof v2.labelStrategyConfig).toBe('function');
  });

  it('rating constants have expected values', async () => {
    const v2 = await import('@evolution/lib/v2/');
    expect(v2.DEFAULT_MU).toBe(25);
    expect(v2.DEFAULT_SIGMA).toBeCloseTo(25 / 3);
    expect(v2.DEFAULT_CONVERGENCE_SIGMA).toBe(3.0);
    expect(v2.MAX_CACHE_SIZE).toBe(500);
  });
});
