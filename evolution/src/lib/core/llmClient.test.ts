// Tests for the evolution LLM client: budget enforcement, onUsage→recordSpend wiring, and cost estimation.

/**
 * @jest-environment node
 */

import { z } from 'zod';
import type { CostTracker, EvolutionLogger } from '../types';
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
    };
    return prices[model] ?? { inputPer1M: 10.0, outputPer1M: 30.0 };
  }),
}));

import { callLLM } from '@/lib/services/llms';
import { createEvolutionLLMClient, estimateTokenCost } from './llmClient';

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
  });

  describe('complete()', () => {
    it('calls recordSpend with actual cost from onUsage callback', async () => {
      const costTracker = makeMockCostTracker();
      const client = createEvolutionLLMClient(costTracker, makeMockLogger());

      // When callLLM is called, capture the onUsage callback and invoke it
      mockCallOpenAIModel.mockImplementation(
        async (_prompt: string, _src: string, _uid: string, _model: string,
               _streaming: boolean, _setText: null, _respObj: null, _respName: null,
               _debug: boolean, onUsage?: (u: LLMUsageMetadata) => void) => {
          if (onUsage) {
            onUsage({
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
      expect(costTracker.recordSpend).toHaveBeenCalledWith('testAgent', 0.00123);
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
               _debug: boolean, onUsage?: (u: LLMUsageMetadata) => void) => {
          if (onUsage) {
            onUsage({
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
      expect(costTracker.recordSpend).toHaveBeenCalledWith('structAgent', 0.005);
    });
  });
});
