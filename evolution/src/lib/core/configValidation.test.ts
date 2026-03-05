// Tests for config validation: isTestEntry, validateStrategyConfig, validateRunConfig.

import { isTestEntry, validateStrategyConfig, validateRunConfig } from './configValidation';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';
import type { StrategyConfig } from './strategyConfig';
import type { EvolutionRunConfig } from '../types';

// ─── isTestEntry ────────────────────────────────────────────────

describe('isTestEntry', () => {
  it('filters "test_strategy"', () => {
    expect(isTestEntry('test_strategy')).toBe(true);
  });

  it('filters "Test Prompt"', () => {
    expect(isTestEntry('Test Prompt')).toBe(true);
  });

  it('keeps "Economy"', () => {
    expect(isTestEntry('Economy')).toBe(false);
  });

  it('filters "Contest" (accepted false positive)', () => {
    expect(isTestEntry('Contest')).toBe(true);
  });

  it('keeps empty string', () => {
    expect(isTestEntry('')).toBe(false);
  });

  it('filters "TESTING"', () => {
    expect(isTestEntry('TESTING')).toBe(true);
  });
});

// ─── validateStrategyConfig ─────────────────────────────────────

/** Valid baseline config matching Economy preset. */
function validStrategy(): StrategyConfig {
  return {
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterations: 15,
  };
}

describe('validateStrategyConfig', () => {
  it('passes for valid Economy-style config', () => {
    const result = validateStrategyConfig(validStrategy());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('errors on invalid generationModel', () => {
    const config = { ...validStrategy(), generationModel: 'gpt-99-turbo' };
    const result = validateStrategyConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid generation model');
    expect(result.errors[0]).toContain('gpt-99-turbo');
  });

  it('errors on invalid judgeModel', () => {
    const config = { ...validStrategy(), judgeModel: 'not-a-model' };
    const result = validateStrategyConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid judge model');
  });

  it('accepts empty string model (treated as unset — defaults apply at resolve time)', () => {
    const config = { ...validStrategy(), generationModel: '' };
    const result = validateStrategyConfig(config);
    expect(result.valid).toBe(true);
  });

  it('errors on agent dependency violation', () => {
    const config: StrategyConfig = {
      ...validStrategy(),
      enabledAgents: ['iterativeEditing'], // requires 'reflection'
    };
    const result = validateStrategyConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('reflection')])
    );
  });

  it('accepts treeSearch and iterativeEditing together (mutex removed)', () => {
    const config: StrategyConfig = {
      ...validStrategy(),
      enabledAgents: ['reflection', 'treeSearch', 'iterativeEditing'],
    };
    const result = validateStrategyConfig(config);
    expect(result.valid).toBe(true);
  });

  it('errors on iterations <= 0', () => {
    const config = { ...validStrategy(), iterations: 0 };
    const result = validateStrategyConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Iterations must be > 0')])
    );
  });

  it('returns all errors at once (no short-circuit)', () => {
    const config: StrategyConfig = {
      generationModel: 'bad-model',
      judgeModel: 'bad-judge',
      iterations: -1,
    };
    const result = validateStrategyConfig(config);
    expect(result.valid).toBe(false);
    // Should have at least 3 errors: gen model, judge model, iterations
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('generation model'),
      expect.stringContaining('judge model'),
      expect.stringContaining('Iterations must be > 0'),
    ]));
  });
});

// ─── validateRunConfig ──────────────────────────────────────────

function validRunConfig(): EvolutionRunConfig {
  return { ...DEFAULT_EVOLUTION_CONFIG };
}

describe('validateRunConfig', () => {
  it('passes for DEFAULT_EVOLUTION_CONFIG', () => {
    const result = validateRunConfig(validRunConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('errors on missing generationModel in resolved config', () => {
    const config = { ...validRunConfig(), generationModel: undefined };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Invalid generation model')])
    );
  });

  it('errors on budgetCapUsd === 0', () => {
    const config = { ...validRunConfig(), budgetCapUsd: 0 };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Budget cap must be > 0')])
    );
  });

  it('errors on budgetCapUsd < 0', () => {
    const config = { ...validRunConfig(), budgetCapUsd: -1 };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Budget cap must be > 0')])
    );
  });

  it('errors on budgetCapUsd === Infinity', () => {
    const config = { ...validRunConfig(), budgetCapUsd: Infinity };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('finite')])
    );
  });

  it('errors when maxIterations <= expansion.maxIterations', () => {
    const config = { ...validRunConfig(), maxIterations: 5, expansion: { ...validRunConfig().expansion, maxIterations: 5 } };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('must be > expansion.maxIterations')])
    );
  });

  it('errors when expansion.minPool < 5 (expansion enabled)', () => {
    const config = {
      ...validRunConfig(),
      expansion: { ...validRunConfig().expansion, minPool: 2 },
    };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('minPool must be >= 5')])
    );
  });

  it('errors when expansion.diversityThreshold > 1', () => {
    const config = {
      ...validRunConfig(),
      expansion: { ...validRunConfig().expansion, diversityThreshold: 1.5 },
    };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('diversityThreshold')])
    );
  });

  it('skips expansion constraints when expansion disabled', () => {
    const config = {
      ...validRunConfig(),
      maxIterations: 3,
      expansion: { ...validRunConfig().expansion, maxIterations: 0, minPool: 1 },
    };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(true);
  });

  it('errors on generation.strategies <= 0', () => {
    const config = {
      ...validRunConfig(),
      generation: { strategies: 0 },
    };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Generation strategies must be > 0')])
    );
  });

  it('errors on calibration.opponents <= 0', () => {
    const config = {
      ...validRunConfig(),
      calibration: { opponents: 0 },
    };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Calibration opponents must be > 0')])
    );
  });

  it('errors on tournament.topK <= 0', () => {
    const config = {
      ...validRunConfig(),
      tournament: { topK: 0 },
    };
    const result = validateRunConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Tournament topK must be > 0')])
    );
  });
});

// ─── preparePipelineRun validation integration ──────────────────

describe('preparePipelineRun validation integration', () => {
  it('throws when config overrides produce an invalid resolved config', () => {
    // Dynamic import to avoid pulling in all pipeline dependencies at module level
    const { preparePipelineRun } = jest.requireActual('../index') as typeof import('../index');

    expect(() =>
      preparePipelineRun({
        runId: 'test-run',
        originalText: 'Some text',
        title: 'Test',
        explanationId: null,
        llmClientId: 'test',
        configOverrides: {
          generationModel: 'nonexistent-model' as never,
        },
      })
    ).toThrow('Invalid run config');
  });

  it('does not throw for valid DEFAULT_EVOLUTION_CONFIG', () => {
    const { preparePipelineRun } = jest.requireActual('../index') as typeof import('../index');

    expect(() =>
      preparePipelineRun({
        runId: 'test-run',
        originalText: 'Some text',
        title: 'Test',
        explanationId: null,
        llmClientId: 'test',
        configOverrides: {},
      })
    ).not.toThrow();
  });
});
