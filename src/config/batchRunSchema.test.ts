/**
 * Unit tests for batchRunSchema: validation, expansion, filtering.
 */

import {
  BatchConfigSchema,
  AgentBudgetCapsSchema,
  AgentModelsSchema,
  expandBatchConfig,
  filterByBudget,
  validateBatchConfig,
  type BatchConfig,
  type ExpandedRun,
} from './batchRunSchema';

describe('batchRunSchema', () => {
  describe('AgentBudgetCapsSchema', () => {
    it('accepts valid budget caps', () => {
      const caps = { generation: 0.25, calibration: 0.15, tournament: 0.25 };
      expect(AgentBudgetCapsSchema.parse(caps)).toEqual(caps);
    });

    it('rejects caps exceeding 1.0 total', () => {
      const caps = { generation: 0.5, calibration: 0.5, tournament: 0.5 };
      expect(() => AgentBudgetCapsSchema.parse(caps)).toThrow('must sum to <= 1.0');
    });

    it('allows empty caps', () => {
      expect(AgentBudgetCapsSchema.parse({})).toEqual({});
    });
  });

  describe('AgentModelsSchema', () => {
    it('accepts valid model overrides', () => {
      const models = { tournament: 'gpt-4.1-mini', evolution: 'deepseek-chat' };
      expect(AgentModelsSchema.parse(models)).toEqual(models);
    });

    it('rejects invalid models', () => {
      expect(() => AgentModelsSchema.parse({ tournament: 'gpt-3' })).toThrow();
    });
  });

  describe('BatchConfigSchema', () => {
    const validConfig: BatchConfig = {
      name: 'test-batch',
      totalBudgetUsd: 50.0,
      safetyMargin: 0.1,
      matrix: {
        prompts: ['Explain photosynthesis'],
        generationModels: ['deepseek-chat'],
        judgeModels: ['gpt-4.1-nano'],
        iterations: [10],
      },
    };

    it('accepts valid config', () => {
      expect(BatchConfigSchema.parse(validConfig)).toMatchObject(validConfig);
    });

    it('rejects invalid name characters', () => {
      const invalid = { ...validConfig, name: 'test batch!' };
      expect(() => BatchConfigSchema.parse(invalid)).toThrow('alphanumeric');
    });

    it('applies default safety margin', () => {
      const noMargin = { ...validConfig };
      delete (noMargin as Record<string, unknown>).safetyMargin;
      const parsed = BatchConfigSchema.parse(noMargin);
      expect(parsed.safetyMargin).toBe(0.1);
    });

    it('accepts config with per-agent model variants', () => {
      const withVariants: BatchConfig = {
        ...validConfig,
        matrix: {
          ...validConfig.matrix!,
          agentModelVariants: [
            {},
            { tournament: 'gpt-4.1-mini' },
          ],
        },
      };
      expect(BatchConfigSchema.parse(withVariants)).toMatchObject(withVariants);
    });
  });

  describe('expandBatchConfig', () => {
    it('expands matrix to Cartesian product', () => {
      const config: BatchConfig = {
        name: 'test',
        totalBudgetUsd: 100,
        safetyMargin: 0.1,
        matrix: {
          prompts: ['A', 'B'],
          generationModels: ['deepseek-chat', 'gpt-4.1-mini'],
          judgeModels: ['gpt-4.1-nano'],
          iterations: [5, 10],
        },
      };

      const expanded = expandBatchConfig(config);

      // 2 prompts × 2 models × 1 judge × 2 iterations = 8 runs
      expect(expanded.length).toBe(8);
    });

    it('applies defaults to expanded runs', () => {
      const config: BatchConfig = {
        name: 'test',
        totalBudgetUsd: 100,
        safetyMargin: 0.1,
        defaults: {
          budgetCapUsd: 3.0,
          mode: 'minimal',
        },
        matrix: {
          prompts: ['A'],
          generationModels: ['deepseek-chat'],
          judgeModels: ['gpt-4.1-nano'],
          iterations: [10],
        },
      };

      const expanded = expandBatchConfig(config);

      expect(expanded[0].budgetCapUsd).toBe(3.0);
      expect(expanded[0].mode).toBe('minimal');
    });

    it('expands agent model variants', () => {
      const config: BatchConfig = {
        name: 'test',
        totalBudgetUsd: 100,
        safetyMargin: 0.1,
        matrix: {
          prompts: ['A'],
          generationModels: ['deepseek-chat'],
          judgeModels: ['gpt-4.1-nano'],
          iterations: [10],
          agentModelVariants: [
            {},
            { tournament: 'gpt-4.1-mini' },
            { evolution: 'gpt-4.1-mini' },
          ],
        },
      };

      const expanded = expandBatchConfig(config);

      // 1 prompt × 1 model × 1 judge × 1 iteration × 3 variants = 3 runs
      expect(expanded.length).toBe(3);
      expect(expanded[0].agentModels).toBeUndefined();
      expect(expanded[1].agentModels).toEqual({ tournament: 'gpt-4.1-mini' });
      expect(expanded[2].agentModels).toEqual({ evolution: 'gpt-4.1-mini' });
    });

    it('adds explicit runs to matrix expansion', () => {
      const config: BatchConfig = {
        name: 'test',
        totalBudgetUsd: 100,
        safetyMargin: 0.1,
        defaults: {
          budgetCapUsd: 5.0,
        },
        matrix: {
          prompts: ['A'],
          generationModels: ['deepseek-chat'],
          judgeModels: ['gpt-4.1-nano'],
          iterations: [10],
        },
        runs: [
          {
            prompt: 'B',
            generationModel: 'gpt-4.1-mini',
            judgeModel: 'gpt-4.1-nano',
            iterations: 15,
            budgetCapUsd: 10.0,
          },
        ],
      };

      const expanded = expandBatchConfig(config);

      expect(expanded.length).toBe(2); // 1 from matrix + 1 explicit
      expect(expanded[1].prompt).toBe('B');
      expect(expanded[1].budgetCapUsd).toBe(10.0);
    });
  });

  describe('filterByBudget', () => {
    const makeRuns = (costs: number[]): ExpandedRun[] => costs.map((cost, i) => ({
      prompt: `Run ${i}`,
      generationModel: 'deepseek-chat',
      judgeModel: 'gpt-4.1-nano',
      iterations: 10,
      budgetCapUsd: 5.0,
      mode: 'full' as const,
      estimatedCost: cost,
      priority: 0,
      status: 'pending' as const,
    }));

    it('marks runs as skipped when over budget', () => {
      const runs = makeRuns([2.0, 3.0, 4.0, 5.0]); // Total: 14.0
      const filtered = filterByBudget(runs, 10.0, 0.1, 'cost_asc'); // Effective: 9.0

      const skipped = filtered.filter(r => r.status === 'skipped');
      const pending = filtered.filter(r => r.status === 'pending');

      // 2.0 + 3.0 + 4.0 = 9.0 fits, 5.0 skipped
      expect(pending.length).toBe(3);
      expect(skipped.length).toBe(1);
      expect(skipped[0].estimatedCost).toBe(5.0);
    });

    it('sorts by cost_asc', () => {
      const runs = makeRuns([5.0, 2.0, 4.0, 1.0]);
      const filtered = filterByBudget(runs, 100.0, 0.1, 'cost_asc');

      expect(filtered[0].estimatedCost).toBe(1.0);
      expect(filtered[1].estimatedCost).toBe(2.0);
      expect(filtered[2].estimatedCost).toBe(4.0);
      expect(filtered[3].estimatedCost).toBe(5.0);
    });

    it('applies safety margin', () => {
      const runs = makeRuns([5.0, 5.0]); // Total: 10.0
      const filtered = filterByBudget(runs, 10.0, 0.2, 'cost_asc'); // Effective: 8.0

      const pending = filtered.filter(r => r.status === 'pending');
      expect(pending.length).toBe(1); // Only first 5.0 fits in 8.0
    });
  });

  describe('validateBatchConfig', () => {
    it('returns success with valid config', () => {
      const config = {
        name: 'test',
        totalBudgetUsd: 50,
        matrix: {
          prompts: ['A'],
          generationModels: ['deepseek-chat'],
          judgeModels: ['gpt-4.1-nano'],
          iterations: [10],
        },
      };

      const result = validateBatchConfig(config);
      expect(result.success).toBe(true);
    });

    it('returns error messages for invalid config', () => {
      const config = {
        name: 'invalid name!',
        totalBudgetUsd: -10,
      };

      const result = validateBatchConfig(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(e => e.includes('name'))).toBe(true);
      }
    });
  });
});
