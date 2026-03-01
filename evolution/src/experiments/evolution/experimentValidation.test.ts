// Unit tests for experiment validation orchestrator.
// Tests the composed validation pipeline: factor registry → L8 → resolve → validate → cost.

import { describe, it, expect, jest } from '@jest/globals';
import { validateExperimentConfig, estimateBatchCost, estimateBatchCostDetailed } from './experimentValidation';
import type { FactorInput, ExpandedRunConfig } from './experimentValidation';
import { DEFAULT_EVOLUTION_CONFIG } from '@evolution/lib/config';

// ─── Helpers ─────────────────────────────────────────────────────

/** Valid 3-factor input that should pass all checks. */
function validFactors(): Record<string, FactorInput> {
  return {
    genModel: { low: 'gpt-4.1-mini', high: 'gpt-4o' },
    iterations: { low: 5, high: 15 },
    supportAgents: { low: 'off', high: 'on' },
  };
}

const SAMPLE_PROMPTS = ['Explain photosynthesis', 'Explain gravity'];

// ─── Guard checks ────────────────────────────────────────────────

describe('validateExperimentConfig guards', () => {
  it('rejects fewer than 2 factors', async () => {
    const result = await validateExperimentConfig(
      { genModel: { low: 'gpt-4.1-mini', high: 'gpt-4o' } },
      SAMPLE_PROMPTS,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('At least 2 factors')]),
    );
  });

  it('rejects 0 prompts', async () => {
    const result = await validateExperimentConfig(validFactors(), []);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('At least 1 prompt')]),
    );
  });

  it('rejects more than 10 prompts', async () => {
    const prompts = Array.from({ length: 11 }, (_, i) => `Prompt ${i}`);
    const result = await validateExperimentConfig(validFactors(), prompts);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Maximum 10 prompts')]),
    );
  });
});

// ─── Factor registry validation ──────────────────────────────────

describe('validateExperimentConfig factor validation', () => {
  it('rejects unknown factor keys', async () => {
    const factors = {
      ...validFactors(),
      unknownFactor: { low: 'a', high: 'b' },
    };
    const result = await validateExperimentConfig(factors, SAMPLE_PROMPTS);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Unknown factor: unknownFactor')]),
    );
  });

  it('rejects invalid factor values', async () => {
    const factors: Record<string, FactorInput> = {
      genModel: { low: 'invalid-model-x', high: 'gpt-4o' },
      iterations: { low: 5, high: 15 },
    };
    const result = await validateExperimentConfig(factors, SAMPLE_PROMPTS);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('Invalid genModel low value')]),
    );
  });

  it('warns when low === high for a factor', async () => {
    const factors: Record<string, FactorInput> = {
      genModel: { low: 'gpt-4o', high: 'gpt-4o' },
      iterations: { low: 5, high: 15 },
    };
    // This produces a warning but low === high for a valid value is not an error itself
    // The guard check (< 2 effective factors) doesn't catch this—it's a semantic warning
    const result = await validateExperimentConfig(factors, SAMPLE_PROMPTS);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('identical low/high')]),
    );
  });
});

// ─── Successful validation ───────────────────────────────────────

describe('validateExperimentConfig success path', () => {
  it('validates and expands a 3-factor config into 8 L8 rows', async () => {
    const result = await validateExperimentConfig(validFactors(), SAMPLE_PROMPTS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.expandedConfigs).toHaveLength(8);
  });

  it('each expanded config has a valid row number', async () => {
    const result = await validateExperimentConfig(validFactors(), SAMPLE_PROMPTS);
    const rows = result.expandedConfigs.map(c => c.row);
    expect(rows).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('expanded configs have resolved model fields', async () => {
    const result = await validateExperimentConfig(validFactors(), SAMPLE_PROMPTS);
    for (const { config } of result.expandedConfigs) {
      expect(config.generationModel).toBeDefined();
      expect(config.judgeModel).toBeDefined();
      expect(config.maxIterations).toBeGreaterThan(0);
    }
  });

  it('applies configDefaults to expanded configs', async () => {
    const result = await validateExperimentConfig(
      validFactors(),
      SAMPLE_PROMPTS,
      { budgetCapUsd: 99.99 },
    );
    expect(result.valid).toBe(true);
    for (const { config } of result.expandedConfigs) {
      expect(config.budgetCapUsd).toBe(99.99);
    }
  });

  it('returns estimatedTotalCost > 0 for valid config', async () => {
    const result = await validateExperimentConfig(validFactors(), SAMPLE_PROMPTS);
    expect(result.estimatedTotalCost).toBeGreaterThan(0);
  });
});

// ─── Cost estimation ─────────────────────────────────────────────

describe('estimateBatchCost', () => {
  it('returns positive cost for valid configs', async () => {
    const configs: ExpandedRunConfig[] = [
      { row: 1, config: DEFAULT_EVOLUTION_CONFIG },
    ];
    const cost = await estimateBatchCost(configs, ['Test prompt']);
    expect(cost).toBeGreaterThan(0);
  });

  it('scales linearly with number of prompts', async () => {
    const configs: ExpandedRunConfig[] = [
      { row: 1, config: DEFAULT_EVOLUTION_CONFIG },
    ];
    const cost1 = await estimateBatchCost(configs, ['Prompt A']);
    const cost2 = await estimateBatchCost(configs, ['Prompt A', 'Prompt B']);
    expect(cost2).toBeCloseTo(cost1 * 2, 1);
  });
});

// ─── Early exit on errors ────────────────────────────────────────

describe('validateExperimentConfig early exit', () => {
  it('returns empty expandedConfigs when factor errors exist', async () => {
    const factors: Record<string, FactorInput> = {
      genModel: { low: 'bad-model', high: 'also-bad' },
      iterations: { low: 5, high: 15 },
    };
    const result = await validateExperimentConfig(factors, SAMPLE_PROMPTS);
    expect(result.valid).toBe(false);
    expect(result.expandedConfigs).toEqual([]);
    expect(result.estimatedTotalCost).toBe(0);
  });

  it('aggregates multiple factor-level errors', async () => {
    const factors: Record<string, FactorInput> = {
      genModel: { low: 'bad', high: 'also-bad' },
      iterations: { low: 0, high: 31 },
    };
    const result = await validateExperimentConfig(factors, SAMPLE_PROMPTS);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('returns empty perRowCosts on error', async () => {
    const result = await validateExperimentConfig(
      { genModel: { low: 'gpt-4.1-mini', high: 'gpt-4o' } },
      SAMPLE_PROMPTS,
    );
    expect(result.perRowCosts).toEqual([]);
  });
});

// ─── Per-row cost estimation ─────────────────────────────────────

describe('estimateBatchCostDetailed', () => {
  it('returns per-row array with correct length', async () => {
    const configs: ExpandedRunConfig[] = [
      { row: 1, config: DEFAULT_EVOLUTION_CONFIG },
      { row: 2, config: DEFAULT_EVOLUTION_CONFIG },
    ];
    const { total, perRow } = await estimateBatchCostDetailed(configs, ['Prompt A']);
    expect(perRow).toHaveLength(2);
    expect(perRow[0].row).toBe(1);
    expect(perRow[1].row).toBe(2);
    expect(total).toBeGreaterThan(0);
  });

  it('wrapper estimateBatchCost returns same scalar total', async () => {
    const configs: ExpandedRunConfig[] = [
      { row: 1, config: DEFAULT_EVOLUTION_CONFIG },
    ];
    const prompts = ['Prompt A'];
    const { total } = await estimateBatchCostDetailed(configs, prompts);
    const scalar = await estimateBatchCost(configs, prompts);
    expect(scalar).toBeCloseTo(total, 10);
  });

  it('per-row estimatedCostPerPrompt * promptCount = totalCost', async () => {
    const configs: ExpandedRunConfig[] = [
      { row: 1, config: DEFAULT_EVOLUTION_CONFIG },
    ];
    const prompts = ['A', 'B', 'C'];
    const { perRow } = await estimateBatchCostDetailed(configs, prompts);
    expect(perRow[0].totalCost).toBeCloseTo(perRow[0].estimatedCostPerPrompt * 3, 10);
  });

  it('each row has a valid confidence level', async () => {
    const configs: ExpandedRunConfig[] = [
      { row: 1, config: DEFAULT_EVOLUTION_CONFIG },
    ];
    const { perRow } = await estimateBatchCostDetailed(configs, ['Prompt']);
    expect(['high', 'medium', 'low']).toContain(perRow[0].confidence);
  });
});

// ─── Expanded configs with factors ──────────────────────────────

describe('validateExperimentConfig factors field', () => {
  it('expandedConfigs entries include factors field', async () => {
    const result = await validateExperimentConfig(validFactors(), SAMPLE_PROMPTS);
    expect(result.valid).toBe(true);
    for (const ec of result.expandedConfigs) {
      expect(ec.factors).toBeDefined();
      expect(typeof ec.factors).toBe('object');
    }
  });

  it('perRowCosts populated matching expandedConfigs length', async () => {
    const result = await validateExperimentConfig(validFactors(), SAMPLE_PROMPTS);
    expect(result.perRowCosts).toHaveLength(result.expandedConfigs.length);
    for (const rc of result.perRowCosts) {
      expect(rc.estimatedCostPerPrompt).toBeGreaterThan(0);
    }
  });
});
