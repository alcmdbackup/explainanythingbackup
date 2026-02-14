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
