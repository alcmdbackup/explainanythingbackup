// Unit tests for resolveConfig: verifies deep merge of per-run overrides with defaults.
// Covers new judgeModel/generationModel fields and partial calibration merges.

import { DEFAULT_EVOLUTION_CONFIG, resolveConfig } from '../config';

describe('resolveConfig', () => {
  it('returns defaults when no overrides', () => {
    const config = resolveConfig({});
    expect(config).toEqual(DEFAULT_EVOLUTION_CONFIG);
  });

  it('merges judgeModel override', () => {
    const config = resolveConfig({ judgeModel: 'gpt-4.1-mini' });
    expect(config.judgeModel).toBe('gpt-4.1-mini');
    expect(config.generationModel).toBe(DEFAULT_EVOLUTION_CONFIG.generationModel);
  });

  it('merges generationModel override', () => {
    const config = resolveConfig({ generationModel: 'gpt-4.1-nano' });
    expect(config.generationModel).toBe('gpt-4.1-nano');
    expect(config.judgeModel).toBe(DEFAULT_EVOLUTION_CONFIG.judgeModel);
  });

  it('preserves default judgeModel and generationModel', () => {
    const config = resolveConfig({});
    expect(config.judgeModel).toBe('gpt-4.1-nano');
    expect(config.generationModel).toBe('gpt-4.1-mini');
  });

  it('merges partial calibration without losing existing fields', () => {
    const config = resolveConfig({ calibration: { opponents: 3, minOpponents: 1 } });
    expect(config.calibration.opponents).toBe(3);
    expect(config.calibration.minOpponents).toBe(1);
  });

  it('preserves calibration.opponents when only minOpponents overridden', () => {
    const config = resolveConfig({
      calibration: { ...DEFAULT_EVOLUTION_CONFIG.calibration, minOpponents: 3 },
    });
    expect(config.calibration.opponents).toBe(5);
    expect(config.calibration.minOpponents).toBe(3);
  });

  it('deep merges nested objects without clobbering', () => {
    const config = resolveConfig({
      plateau: { window: 5, threshold: 0.02 },
      budgetCaps: { generation: 0.50 },
    });
    expect(config.plateau.window).toBe(5);
    expect(config.plateau.threshold).toBe(0.02);
    expect(config.budgetCaps.generation).toBe(0.50);
    expect(config.budgetCaps.tournament).toBe(0.25);
  });

  it('overrides top-level primitives', () => {
    const config = resolveConfig({ maxIterations: 10, budgetCapUsd: 2.0 });
    expect(config.maxIterations).toBe(10);
    expect(config.budgetCapUsd).toBe(2.0);
  });
});
