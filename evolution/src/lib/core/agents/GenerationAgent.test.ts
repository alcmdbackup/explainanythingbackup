// Tests for GenerationAgent: verifies delegation to generateVariants() with correct arguments.

import { GenerationAgent, type GenerationInput } from './GenerationAgent';
import type { AgentContext } from '../types';
import { generateVariants } from '../../pipeline/loop/generateVariants';
import { generationExecutionDetailSchema } from '../../schemas';

jest.mock('../../pipeline/loop/generateVariants', () => ({
  generateVariants: jest.fn(),
}));

jest.mock('../../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-gen-1'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

const mockGenerateVariants = generateVariants as jest.MockedFunction<typeof generateVariants>;

function createMockContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    db: {} as any,
    runId: 'run-gen-1',
    iteration: 2,
    executionOrder: 1,
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    costTracker: {
      reserve: jest.fn(),
      recordSpend: jest.fn(),
      release: jest.fn(),
      getTotalSpent: jest.fn().mockReturnValue(0),
      getPhaseCosts: jest.fn().mockReturnValue({}),
      getAvailableBudget: jest.fn().mockReturnValue(5),
    },
    config: {
      iterations: 5,
      budgetUsd: 10,
      judgeModel: 'gpt-4o',
      generationModel: 'gpt-4o',
    },
    invocationId: 'inv-gen-1',
    randomSeed: BigInt(0),
    ...overrides,
  };
}

const mockVariants = [
  { id: 'v1', text: 'variant1', version: 0, parentIds: [], strategy: 'gen', createdAt: 0, iterationBorn: 0 },
];

const mockGenResult = {
  variants: mockVariants,
  strategyResults: [{ name: 'gen', promptLength: 100, status: 'success' as const, variantId: 'v1', textLength: 50 }],
};

describe('GenerationAgent', () => {
  let agent: GenerationAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new GenerationAgent();
  });

  it('has name "generation"', () => {
    expect(agent.name).toBe('generation');
  });

  it('uses generationExecutionDetailSchema', () => {
    expect(agent.executionDetailSchema).toBe(generationExecutionDetailSchema);
  });

  describe('execute()', () => {
    it('delegates to generateVariants with correct arguments', async () => {
      mockGenerateVariants.mockResolvedValue(mockGenResult as any);

      const input: GenerationInput = {
        text: 'explain photosynthesis',
        llm: { generate: jest.fn() } as any,
      };
      const ctx = createMockContext();

      await agent.execute(input, ctx);

      expect(mockGenerateVariants).toHaveBeenCalledWith(
        'explain photosynthesis', 2, input.llm, ctx.config, undefined, ctx.logger,
      );
    });

    it('passes feedback when provided', async () => {
      mockGenerateVariants.mockResolvedValue({ variants: [], strategyResults: [] } as any);

      const feedback = { weakestDimension: 'clarity', suggestions: ['be more specific'] };
      const input: GenerationInput = {
        text: 'explain gravity',
        llm: { generate: jest.fn() } as any,
        feedback,
      };
      const ctx = createMockContext({ iteration: 3 });

      await agent.execute(input, ctx);

      expect(mockGenerateVariants).toHaveBeenCalledWith(
        'explain gravity', 3, input.llm, ctx.config, feedback, ctx.logger,
      );
    });

    it('returns AgentOutput with variants and detail', async () => {
      const twoVariants = [
        { id: 'v1', text: 'a', version: 0, parentIds: [], strategy: 'gen', createdAt: 0, iterationBorn: 0 },
        { id: 'v2', text: 'b', version: 0, parentIds: [], strategy: 'gen', createdAt: 0, iterationBorn: 0 },
      ];
      mockGenerateVariants.mockResolvedValue({
        variants: twoVariants,
        strategyResults: [
          { name: 's1', promptLength: 100, status: 'success' as const, variantId: 'v1' },
          { name: 's2', promptLength: 100, status: 'success' as const, variantId: 'v2' },
        ],
      } as any);

      const input: GenerationInput = { text: 'test', llm: {} as any };
      const ctx = createMockContext();

      const output = await agent.execute(input, ctx);
      expect(output.result).toHaveLength(2);
      expect(output.detail.detailType).toBe('generation');
      expect(output.detail.strategies).toHaveLength(2);
      expect(output.childVariantIds).toEqual(['v1', 'v2']);
    });

    it('propagates errors from generateVariants', async () => {
      mockGenerateVariants.mockRejectedValue(new Error('LLM timeout'));

      const input: GenerationInput = { text: 'test', llm: {} as any };
      const ctx = createMockContext();

      await expect(agent.execute(input, ctx)).rejects.toThrow('LLM timeout');
    });

    it('uses iteration from context', async () => {
      mockGenerateVariants.mockResolvedValue({ variants: [], strategyResults: [] } as any);

      const input: GenerationInput = { text: 'test', llm: {} as any };
      const ctx = createMockContext({ iteration: 7 });

      await agent.execute(input, ctx);

      expect(mockGenerateVariants).toHaveBeenCalledWith(
        'test', 7, input.llm, ctx.config, undefined, ctx.logger,
      );
    });

    it('uses config from context', async () => {
      mockGenerateVariants.mockResolvedValue({ variants: [], strategyResults: [] } as any);

      const customConfig = { iterations: 10, budgetUsd: 20, judgeModel: 'claude-3', generationModel: 'claude-3' };
      const input: GenerationInput = { text: 'test', llm: {} as any };
      const ctx = createMockContext({ config: customConfig });

      await agent.execute(input, ctx);

      expect(mockGenerateVariants).toHaveBeenCalledWith(
        'test', expect.any(Number), input.llm, customConfig, undefined, ctx.logger,
      );
    });
  });

  describe('run() integration', () => {
    it('wraps execute with invocation tracking via base class', async () => {
      mockGenerateVariants.mockResolvedValue({ variants: [], strategyResults: [] } as any);
      const ctx = createMockContext();

      const result = await agent.run(
        { text: 'test', llm: {} as any },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.invocationId).toBe('inv-gen-1');
    });
  });
});
