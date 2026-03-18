// Tests for configValidation: isTestEntry, validateStrategyConfig, validateRunConfig.

import { isTestEntry, validateStrategyConfig, validateRunConfig } from './configValidation';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import type { StrategyConfig } from './strategyConfig';
import type { EvolutionRunConfig } from '../types';

describe('isTestEntry', () => {
  it('returns true for names containing "test"', () => {
    expect(isTestEntry('[TEST] My Strategy')).toBe(true);
    expect(isTestEntry('testing_config')).toBe(true);
  });

  it('returns true case-insensitively', () => {
    expect(isTestEntry('Test Strategy')).toBe(true);
    expect(isTestEntry('MY TEST')).toBe(true);
  });

  it('returns false for non-test names', () => {
    expect(isTestEntry('Production Strategy')).toBe(false);
    expect(isTestEntry('best_config')).toBe(false);
  });
});

describe('validateStrategyConfig', () => {
  const validConfig: StrategyConfig = {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterations: 10,
  };

  it('accepts valid config', () => {
    const result = validateStrategyConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid generation model', () => {
    const result = validateStrategyConfig({ ...validConfig, generationModel: 'nonexistent-model' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid generation model');
  });

  it('rejects invalid judge model', () => {
    const result = validateStrategyConfig({ ...validConfig, judgeModel: 'bad-model' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid judge model');
  });

  it('rejects zero iterations', () => {
    const result = validateStrategyConfig({ ...validConfig, iterations: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Iterations must be > 0');
  });

  it('rejects negative iterations', () => {
    const result = validateStrategyConfig({ ...validConfig, iterations: -1 });
    expect(result.valid).toBe(false);
  });

  it('allows undefined iterations (uses defaults)', () => {
    const { iterations: _, ...noIter } = validConfig;
    const result = validateStrategyConfig(noIter as StrategyConfig);
    expect(result.valid).toBe(true);
  });

  it('rejects budget below minimum', () => {
    const result = validateStrategyConfig({ ...validConfig, budgetCapUsd: 0.001 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('>= $0.01');
  });
});

describe('validateRunConfig', () => {
  const validRunConfig: EvolutionRunConfig = { ...DEFAULT_EVOLUTION_CONFIG };

  it('accepts valid run config', () => {
    const result = validateRunConfig(validRunConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing generation model', () => {
    const result = validateRunConfig({ ...validRunConfig, generationModel: '' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid generation model');
  });

  it('rejects zero maxIterations', () => {
    const result = validateRunConfig({ ...validRunConfig, maxIterations: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('maxIterations must be > 0');
  });

  it('rejects zero budget', () => {
    const result = validateRunConfig({ ...validRunConfig, budgetCapUsd: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects non-finite budget', () => {
    const result = validateRunConfig({ ...validRunConfig, budgetCapUsd: Infinity });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('finite'))).toBe(true);
  });
});
