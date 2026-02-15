// Unit tests for resolveConfig — verifying enabledAgents/singleArticle passthrough.

import { resolveConfig, DEFAULT_EVOLUTION_CONFIG } from './config';

describe('resolveConfig', () => {
  it('returns defaults when no overrides', () => {
    const config = resolveConfig({});
    expect(config.maxIterations).toBe(DEFAULT_EVOLUTION_CONFIG.maxIterations);
    expect(config.budgetCapUsd).toBe(DEFAULT_EVOLUTION_CONFIG.budgetCapUsd);
    expect(config.enabledAgents).toBeUndefined();
    expect(config.singleArticle).toBeUndefined();
  });

  it('passes through enabledAgents when provided', () => {
    const config = resolveConfig({ enabledAgents: ['reflection', 'debate'] });
    expect(config.enabledAgents).toEqual(['reflection', 'debate']);
  });

  it('leaves enabledAgents undefined when not overridden', () => {
    const config = resolveConfig({ maxIterations: 20 });
    expect(config.enabledAgents).toBeUndefined();
  });

  it('passes through singleArticle when provided', () => {
    const config = resolveConfig({ singleArticle: true });
    expect(config.singleArticle).toBe(true);
  });

  it('singleArticle defaults to DEFAULT when not overridden', () => {
    const config = resolveConfig({});
    expect(config.singleArticle).toBe(DEFAULT_EVOLUTION_CONFIG.singleArticle);
  });

  it('merges nested objects without losing new top-level fields', () => {
    const config = resolveConfig({
      enabledAgents: ['reflection'],
      singleArticle: true,
      plateau: { window: 5, threshold: DEFAULT_EVOLUTION_CONFIG.plateau.threshold },
    });
    expect(config.enabledAgents).toEqual(['reflection']);
    expect(config.singleArticle).toBe(true);
    expect(config.plateau.window).toBe(5);
    expect(config.plateau.threshold).toBe(DEFAULT_EVOLUTION_CONFIG.plateau.threshold);
  });
});

describe('resolveConfig — expansion auto-clamping', () => {
  it('clamps expansion.maxIterations to 0 when maxIterations is 3', () => {
    const config = resolveConfig({ maxIterations: 3 });
    // minCompetitionIters = plateau.window(3) + 1 = 4
    // 3 <= 8 + 4, so clamp to max(0, 3 - 4) = 0
    expect(config.expansion.maxIterations).toBe(0);
  });

  it('clamps expansion.maxIterations to 6 when maxIterations is 10', () => {
    const config = resolveConfig({ maxIterations: 10 });
    // 10 <= 8 + 4, so clamp to max(0, 10 - 4) = 6
    expect(config.expansion.maxIterations).toBe(6);
  });

  it('does not clamp when maxIterations is large enough (15)', () => {
    const config = resolveConfig({ maxIterations: 15 });
    // 15 > 8 + 4 = 12, so no clamping
    expect(config.expansion.maxIterations).toBe(DEFAULT_EVOLUTION_CONFIG.expansion.maxIterations);
  });

  it('logs console.warn when clamping occurs', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    resolveConfig({ maxIterations: 3 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Auto-clamped'));
    warnSpy.mockRestore();
  });

  it('does not log console.warn when no clamping needed', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    resolveConfig({ maxIterations: 15 });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('budgetCaps completeness', () => {
  it('includes entries for all LLM-calling agents including pairwise', () => {
    const caps = DEFAULT_EVOLUTION_CONFIG.budgetCaps;
    // Every agent that makes LLM calls must have a budget cap entry.
    // The pairwise agent (used by Tournament for all comparison LLM calls) was
    // the root cause of the over-budget bug when it was missing.
    const requiredAgents = [
      'generation', 'calibration', 'tournament', 'pairwise',
      'evolution', 'reflection', 'debate', 'iterativeEditing',
      'treeSearch', 'outlineGeneration', 'sectionDecomposition', 'flowCritique',
    ];

    for (const agent of requiredAgents) {
      expect(caps).toHaveProperty(agent);
      expect(caps[agent]).toBeGreaterThan(0);
    }
  });

  it('budget cap values sum is reasonable (can exceed 1.0 since not all run every iteration)', () => {
    const caps = DEFAULT_EVOLUTION_CONFIG.budgetCaps;
    const total = Object.values(caps).reduce((sum, v) => sum + v, 0);
    // Should be > 0.5 (enough agents configured) and < 3.0 (not absurdly high)
    expect(total).toBeGreaterThan(0.5);
    expect(total).toBeLessThan(3.0);
  });
});
