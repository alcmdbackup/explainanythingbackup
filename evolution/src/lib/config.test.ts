// Unit tests for resolveConfig — verifying enabledAgents/singleArticle passthrough and budget clamping.

import { resolveConfig, DEFAULT_EVOLUTION_CONFIG, MAX_RUN_BUDGET_USD } from './config';

describe('resolveConfig', () => {
  it('returns defaults when no overrides', () => {
    const config = resolveConfig({});
    expect(config.maxIterations).toBe(DEFAULT_EVOLUTION_CONFIG.maxIterations);
    // Default $5 is clamped to MAX_RUN_BUDGET_USD ($1)
    expect(config.budgetCapUsd).toBe(MAX_RUN_BUDGET_USD);
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
    });
    expect(config.enabledAgents).toEqual(['reflection']);
    expect(config.singleArticle).toBe(true);
  });

  it('deep merge replaces arrays outright (not element-wise)', () => {
    const config = resolveConfig({ enabledAgents: ['debate'] });
    expect(config.enabledAgents).toEqual(['debate']);
  });

  it('undefined override values fall back to defaults', () => {
    const config = resolveConfig({ maxIterations: undefined });
    expect(config.maxIterations).toBe(DEFAULT_EVOLUTION_CONFIG.maxIterations);
  });
});

describe('resolveConfig — expansion auto-clamping', () => {
  it('clamps expansion.maxIterations to 2 when maxIterations is 3', () => {
    const config = resolveConfig({ maxIterations: 3 });
    // minCompetitionIters = + 1
    // 3 <= 8 + 1, so clamp to max(0, 3 - 1) = 2
    expect(config.expansion.maxIterations).toBe(2);
  });

  it('does not clamp when maxIterations is 10 (above threshold)', () => {
    const config = resolveConfig({ maxIterations: 10 });
    // 10 > 8 + 1 = 9, so no clamping
    expect(config.expansion.maxIterations).toBe(DEFAULT_EVOLUTION_CONFIG.expansion.maxIterations);
  });

  it('does not clamp when maxIterations is large enough (50)', () => {
    const config = resolveConfig({ maxIterations: 50 });
    // 50 > 8 + 1 = 9, so no clamping
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

describe('resolveConfig — budget cap clamping', () => {
  it('clamps budgetCapUsd to MAX_RUN_BUDGET_USD when exceeding limit', () => {
    const config = resolveConfig({ budgetCapUsd: 50 });
    expect(config.budgetCapUsd).toBe(MAX_RUN_BUDGET_USD);
  });

  it('preserves budgetCapUsd when within limit', () => {
    const config = resolveConfig({ budgetCapUsd: 0.50 });
    expect(config.budgetCapUsd).toBe(0.50);
  });

  it('clamps default $5 budget to MAX_RUN_BUDGET_USD', () => {
    const config = resolveConfig({});
    expect(config.budgetCapUsd).toBe(MAX_RUN_BUDGET_USD);
  });

  it('MAX_RUN_BUDGET_USD is $1.00', () => {
    expect(MAX_RUN_BUDGET_USD).toBe(1.00);
  });
});

