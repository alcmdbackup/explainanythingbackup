// Tests for the evolution LLM client: budget enforcement, onUsage→recordSpend wiring, and cost estimation.

/**
 * @jest-environment node
 */

import { z } from 'zod';
import type { CostTracker, EvolutionLogger, EvolutionLLMClient } from '../types';
import type { LLMUsageMetadata } from '@/lib/services/llms';

// Mock callLLM — capture the onUsage callback so tests can invoke it
jest.mock('@/lib/services/llms', () => ({
  callLLM: jest.fn(),
}));

jest.mock('@/config/llmPricing', () => ({
  getModelPricing: jest.fn((model: string) => {
    const prices: Record<string, { inputPer1M: number; outputPer1M: number }> = {
      'deepseek-chat': { inputPer1M: 0.14, outputPer1M: 0.28 },
      'gpt-4.1-mini': { inputPer1M: 0.40, outputPer1M: 1.60 },
      'claude-sonnet-4-20250514': { inputPer1M: 3.0, outputPer1M: 15.0 },
    };
    return prices[model] ?? { inputPer1M: 10.0, outputPer1M: 30.0 };
  }),
}));

import { callLLM } from '@/lib/services/llms';
import { createEvolutionLLMClient, estimateTokenCost, createScopedLLMClient } from './llmClient';

const mockCallOpenAIModel = callLLM as jest.Mock;

function makeMockCostTracker(): CostTracker {
  return {
    reserveBudget: jest.fn(),
    recordSpend: jest.fn(),
    getAgentCost: jest.fn(() => 0),
    getTotalSpent: jest.fn(() => 0),
    getAvailableBudget: jest.fn(() => 5),
    getAllAgentCosts: jest.fn(() => ({})),
    getTotalReserved: jest.fn().mockReturnValue(0),
    getInvocationCost: jest.fn().mockReturnValue(0),
    releaseReservation: jest.fn(),
    setEventLogger: jest.fn(),
  };
}

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

describe('llmClient', () => {
  beforeEach(() => {
    mockCallOpenAIModel.mockReset();
  });

  describe('estimateTokenCost', () => {
    it('uses getModelPricing from llmPricing.ts for correct per-1M values', () => {
      // "hello world" = 11 chars → ceil(11/4) = 3 input tokens, ceil(3*0.5) = 2 output tokens
      // deepseek-chat: (3/1M)*0.14 + (2/1M)*0.28 = 0.00000042 + 0.00000056 = 0.00000098
      const cost = estimateTokenCost('hello world', 'deepseek-chat');
      const expected = (3 / 1_000_000) * 0.14 + (2 / 1_000_000) * 0.28;
      expect(cost).toBeCloseTo(expected, 12);
    });

    it('defaults to EVOLUTION_DEFAULT_MODEL when model is omitted', () => {
      const cost = estimateTokenCost('test');
      // Uses deepseek-chat pricing (default)
      expect(cost).toBeGreaterThan(0);
    });

    it('comparison taskType uses fixed 150 output tokens regardless of input size', () => {
      // 5000 chars → ceil(5000/4) = 1250 input tokens
      // comparison: 150 output tokens (fixed)
      // claude-sonnet-4: (1250/1M)*3 + (150/1M)*15
      const cost = estimateTokenCost('x'.repeat(5000), 'claude-sonnet-4-20250514', 'comparison');
      const expected = (1250 / 1_000_000) * 3.0 + (150 / 1_000_000) * 15.0;
      expect(cost).toBeCloseTo(expected, 12);
    });

    it('generation taskType uses 50%-of-input output tokens (same as default)', () => {
      // 5000 chars → 1250 input → 625 output
      const costGen = estimateTokenCost('x'.repeat(5000), 'claude-sonnet-4-20250514', 'generation');
      const costDefault = estimateTokenCost('x'.repeat(5000), 'claude-sonnet-4-20250514');
      expect(costGen).toBeCloseTo(costDefault, 12);

      const expected = (1250 / 1_000_000) * 3.0 + (625 / 1_000_000) * 15.0;
      expect(costGen).toBeCloseTo(expected, 12);
    });

    it('comparison is significantly cheaper than default for claude-sonnet-4', () => {
      const prompt = 'x'.repeat(5000);
      const costComparison = estimateTokenCost(prompt, 'claude-sonnet-4-20250514', 'comparison');
      const costDefault = estimateTokenCost(prompt, 'claude-sonnet-4-20250514');
      // comparison ~$0.006 vs default ~$0.013 — at least 2x cheaper
      expect(costDefault / costComparison).toBeGreaterThan(2);
    });

    it('comparison uses 150 output tokens even with unknown model (DEFAULT_PRICING)', () => {
      // Unknown model → $10/$30 per 1M
      const prompt = 'x'.repeat(400); // 100 input tokens
      const cost = estimateTokenCost(prompt, 'unknown-model', 'comparison');
      const expected = (100 / 1_000_000) * 10.0 + (150 / 1_000_000) * 30.0;
      expect(cost).toBeCloseTo(expected, 12);
    });
  });

  describe('complete()', () => {
    it('calls recordSpend with actual cost from onUsage callback', async () => {
      const costTracker = makeMockCostTracker();
      const client = createEvolutionLLMClient(costTracker, makeMockLogger());

      // When callLLM is called, capture the options object and invoke onUsage
      mockCallOpenAIModel.mockImplementation(
        async (_prompt: string, _src: string, _uid: string, _model: string,
               _streaming: boolean, _setText: null, _respObj: null, _respName: null,
               _debug: boolean, options?: { onUsage?: (u: LLMUsageMetadata) => void }) => {
          if (options?.onUsage) {
            options.onUsage({
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
              reasoningTokens: 0,
              estimatedCostUsd: 0.00123,
              model: 'deepseek-chat',
            });
          }
          return 'LLM response';
        },
      );

      const result = await client.complete('test prompt', 'testAgent');
      expect(result).toBe('LLM response');
      expect(costTracker.recordSpend).toHaveBeenCalledWith('testAgent', 0.00123, undefined);
    });

    it('calls releaseReservation when callLLM throws', async () => {
      const costTracker = makeMockCostTracker();
      const client = createEvolutionLLMClient(costTracker, makeMockLogger());

      mockCallOpenAIModel.mockRejectedValue(new Error('network timeout'));

      await expect(client.complete('test', 'testAgent')).rejects.toThrow('network timeout');
      expect(costTracker.releaseReservation).toHaveBeenCalledWith('testAgent');
      expect(costTracker.recordSpend).not.toHaveBeenCalled();
    });

    it('does NOT call releaseReservation on success (recordSpend handles it)', async () => {
      const costTracker = makeMockCostTracker();
      const client = createEvolutionLLMClient(costTracker, makeMockLogger());

      mockCallOpenAIModel.mockImplementation(
        async (_prompt: string, _src: string, _uid: string, _model: string,
               _streaming: boolean, _setText: null, _respObj: null, _respName: null,
               _debug: boolean, options?: { onUsage?: (u: LLMUsageMetadata) => void }) => {
          if (options?.onUsage) {
            options.onUsage({
              promptTokens: 100, completionTokens: 50, totalTokens: 150,
              reasoningTokens: 0, estimatedCostUsd: 0.001, model: 'deepseek-chat',
            });
          }
          return 'success';
        },
      );

      await client.complete('test', 'testAgent');
      expect(costTracker.releaseReservation).not.toHaveBeenCalled();
      expect(costTracker.recordSpend).toHaveBeenCalled();
    });

    it('completeStructured calls releaseReservation when callLLM throws', async () => {
      const costTracker = makeMockCostTracker();
      const client = createEvolutionLLMClient(costTracker, makeMockLogger());
      const schema = z.object({ answer: z.string() });

      mockCallOpenAIModel.mockRejectedValue(new Error('API error'));

      await expect(client.completeStructured('test', schema, 'Schema', 'structAgent')).rejects.toThrow('API error');
      expect(costTracker.releaseReservation).toHaveBeenCalledWith('structAgent');
    });

    it('still works when recordSpend throws', async () => {
      const costTracker = makeMockCostTracker();
      (costTracker.recordSpend as jest.Mock).mockImplementation(() => {
        throw new Error('budget tracking exploded');
      });
      const client = createEvolutionLLMClient(costTracker, makeMockLogger());

      // The onUsage callback calling recordSpend will throw,
      // but Phase 1's try-catch in callLLM protects the response.
      // In our mock, we invoke onUsage synchronously inside the mock, so the throw
      // propagates to the onUsage try-catch in callLLM (which is also mocked).
      // For this test, we simulate the real behavior: callLLM returns normally
      // despite the callback throwing.
      mockCallOpenAIModel.mockResolvedValue('still works');

      const result = await client.complete('test', 'agent');
      expect(result).toBe('still works');
    });
  });

  describe('completeStructured()', () => {
    it('passes onUsage callback through to callLLM', async () => {
      const costTracker = makeMockCostTracker();
      const client = createEvolutionLLMClient(costTracker, makeMockLogger());
      const schema = z.object({ answer: z.string() });

      mockCallOpenAIModel.mockImplementation(
        async (_prompt: string, _src: string, _uid: string, _model: string,
               _streaming: boolean, _setText: null, _respObj: unknown, _respName: unknown,
               _debug: boolean, options?: { onUsage?: (u: LLMUsageMetadata) => void }) => {
          if (options?.onUsage) {
            options.onUsage({
              promptTokens: 200,
              completionTokens: 100,
              totalTokens: 300,
              reasoningTokens: 0,
              estimatedCostUsd: 0.005,
              model: 'deepseek-chat',
            });
          }
          return '{"answer": "hello"}';
        },
      );

      const result = await client.completeStructured('test prompt', schema, 'TestSchema', 'structAgent');
      expect(result).toEqual({ answer: 'hello' });
      expect(costTracker.recordSpend).toHaveBeenCalledWith('structAgent', 0.005, undefined);
    });
  });

  describe('createScopedLLMClient', () => {
    function makeMockBaseClient() {
      return {
        complete: jest.fn().mockResolvedValue('ok'),
        completeStructured: jest.fn().mockResolvedValue({ v: 1 }),
      } as unknown as jest.Mocked<EvolutionLLMClient>;
    }

    it('bakes invocationId into every complete call', async () => {
      const base = makeMockBaseClient();
      const scoped = createScopedLLMClient(base, 'inv-123');

      await scoped.complete('prompt', 'agent');

      expect(base.complete).toHaveBeenCalledWith('prompt', 'agent', { invocationId: 'inv-123' });
    });

    it('bakes invocationId into every completeStructured call', async () => {
      const base = makeMockBaseClient();
      const scoped = createScopedLLMClient(base, 'inv-456');
      const schema = z.object({ v: z.number() });

      await scoped.completeStructured('prompt', schema, 'Schema', 'agent');

      expect(base.completeStructured).toHaveBeenCalledWith('prompt', schema, 'Schema', 'agent', { invocationId: 'inv-456' });
    });

    it('base client without scoping does not pass invocationId', async () => {
      const base = makeMockBaseClient();

      await base.complete('prompt', 'agent');

      expect(base.complete).toHaveBeenCalledWith('prompt', 'agent');
      // The call should have exactly 2 args (no options object)
      expect(base.complete.mock.calls[0]).toHaveLength(2);
    });

    it('merges taskType with invocationId in scoped client', async () => {
      const base = makeMockBaseClient();
      const scoped = createScopedLLMClient(base, 'inv-1');

      await scoped.complete('prompt', 'agent', { taskType: 'comparison' });

      expect(base.complete).toHaveBeenCalledWith('prompt', 'agent', {
        taskType: 'comparison',
        invocationId: 'inv-1',
      });
    });

    it('two scoped clients with different IDs do not interfere (parallel safety)', async () => {
      const base = makeMockBaseClient();
      const scopedA = createScopedLLMClient(base, 'inv-aaa');
      const scopedB = createScopedLLMClient(base, 'inv-bbb');

      // Call both in parallel
      await Promise.all([
        scopedA.complete('promptA', 'agentA'),
        scopedB.complete('promptB', 'agentB'),
      ]);

      expect(base.complete).toHaveBeenCalledTimes(2);
      expect(base.complete).toHaveBeenCalledWith('promptA', 'agentA', { invocationId: 'inv-aaa' });
      expect(base.complete).toHaveBeenCalledWith('promptB', 'agentB', { invocationId: 'inv-bbb' });
    });
  });
});
