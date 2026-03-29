/**
 * @jest-environment node
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodResponseFormat } from "openai/helpers/zod";

// Mock dependencies
jest.mock('openai');
jest.mock('@anthropic-ai/sdk');
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn()
}));
jest.mock('@/lib/server_utilities', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));
jest.mock('../../../instrumentation', () => ({
  createLLMSpan: jest.fn(() => ({
    setAttributes: jest.fn(),
    recordException: jest.fn(),
    setStatus: jest.fn(),
    end: jest.fn()
  }))
}));
jest.mock('openai/helpers/zod');
jest.mock('./llmSpendingGate', () => ({
  getSpendingGate: jest.fn(() => ({
    checkBudget: jest.fn().mockResolvedValue(0.01),
    reconcileAfterCall: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { callLLM, callLLMModel, callOpenAIModel, isAnthropicModel, isLocalModel, isOpenRouterModel, DEFAULT_MODEL, LIGHTER_MODEL, type LLMUsageMetadata } from './llms';
import { ServiceError } from '@/lib/errors/serviceError';
import { ERROR_CODES } from '@/lib/errorHandling';

describe('llms', () => {
  let mockCreateSpy: jest.Mock;
  let mockOpenAIInstance: any;
  let mockSupabase: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    // Create the mock OpenAI instance once for all tests
    mockOpenAIInstance = {
      chat: {
        completions: {
          create: jest.fn()
        }
      }
    };

    // Mock the OpenAI constructor to ALWAYS return the same instance
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockOpenAIInstance);
  });

  beforeEach(() => {
    // Store original env and set test API key
    originalEnv = process.env;
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-api-key', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' };

    // Store reference to the create spy (same instance across all tests)
    mockCreateSpy = mockOpenAIInstance.chat.completions.create;

    // Reset the mock's call history and implementation for this test
    mockCreateSpy.mockReset();

    // Mock Supabase
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: {}, error: null })
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

    // Mock zodResponseFormat
    (zodResponseFormat as jest.Mock).mockReturnValue({ type: 'json_object' });
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('callLLM', () => {
    it('should make a successful non-streaming API call', async () => {
      const mockResponse = {
        choices: [{
          message: { content: 'Test response' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        },
        model: 'gpt-4.1-mini'
      };

      mockCreateSpy.mockResolvedValueOnce(mockResponse);

      const result = await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        true
      );

      expect(result).toBe('Test response');
      expect(mockCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4.1-mini',
          messages: expect.arrayContaining([
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Test prompt' }
          ]),
          stream: false
        })
      );
      expect(mockSupabase.from).toHaveBeenCalledWith('llmCallTracking');
    });

    it('should handle streaming API call', async () => {
      // Create an async generator function
      async function* streamGenerator() {
        yield {
          choices: [{ delta: { content: 'Hello ' } }]
        };
        yield {
          choices: [{
            delta: { content: 'World' },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15
          },
          model: 'gpt-4.1-mini'
        };
      }

      // Mock returns a promise that resolves to a new generator when called
      mockCreateSpy.mockImplementationOnce(() => Promise.resolve(streamGenerator()));

      const setText = jest.fn();
      const result = await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        true,
        setText,
        null,
        null,
        true
      );

      expect(result).toBe('Hello World');
      expect(setText).toHaveBeenCalledWith('Hello ');
      expect(setText).toHaveBeenCalledWith('Hello World');
      expect(mockCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: true
        })
      );
    });

    it('should handle structured output with response_obj', async () => {
      const responseSchema = z.object({
        answer: z.string(),
        confidence: z.number()
      });

      // Replace the entire mock for this test
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{
          message: { content: '{"answer":"Test","confidence":0.9}' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        },
        model: 'gpt-4.1-mini'
      });

      const result = await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        responseSchema,
        'TestResponse',
        true
      );

      expect(result).toBe('{"answer":"Test","confidence":0.9}');
      expect(zodResponseFormat).toHaveBeenCalledWith(responseSchema, 'TestResponse');
      expect(mockCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' }
        })
      );
    });

    it('should validate model parameter', async () => {
      await expect(
        callLLM(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'invalid-model' as any,
          false,
          null,
          null,
          null,
          false
        )
      ).rejects.toThrow('Invalid model: invalid-model');
    });

    it('should validate setText for streaming mode', async () => {
      await expect(
        callLLM(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'gpt-4.1-mini',
          true,
          null, // setText is null but streaming is true
          null,
          null,
          false
        )
      ).rejects.toThrow('setText must be a function when streaming is true');
    });

    it('should validate setText for non-streaming mode', async () => {
      await expect(
        callLLM(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'gpt-4.1-mini',
          false,
          jest.fn(), // setText is provided but streaming is false
          null,
          null,
          false
        )
      ).rejects.toThrow('setText must be null when streaming is false');
    });

    it('should handle OpenAI API errors', async () => {
      const apiError = new Error('OpenAI API error');
      // Replace mock to reject
      mockCreateSpy.mockRejectedValueOnce(apiError);

      await expect(
        callLLM(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'gpt-4.1-mini',
          false,
          null,
          null,
          null,
          true
        )
      ).rejects.toThrow('OpenAI API error');

      expect(logger.error).toHaveBeenCalledWith('Error in OpenAI-compatible call: OpenAI API error');
    });

    it('should handle empty response', async () => {
      // Replace mock with empty response
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{
          message: { content: '' },
          finish_reason: 'stop'
        }],
        usage: {},
        model: 'gpt-4.1-mini'
      });

      await expect(
        callLLM(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'gpt-4.1-mini',
          false,
          null,
          null,
          null,
          true
        )
      ).rejects.toThrow('No response received from OpenAI');
    });

    it('should handle missing OPENAI_API_KEY', async () => {
      delete process.env.OPENAI_API_KEY;

      await expect(
        callLLM(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'gpt-4.1-mini',
          false,
          null,
          null,
          null,
          true
        )
      ).rejects.toThrow('OPENAI_API_KEY not found in environment variables');
    });

    it('should throw error when used on client side', async () => {
      // Mock window to simulate client-side environment
      (global as any).window = {};

      await expect(
        callLLM(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'gpt-4.1-mini',
          false,
          null,
          null,
          null,
          true
        )
      ).rejects.toThrow('OpenAI client cannot be used on the client side');

      // Clean up window mock
      delete (global as any).window;
    });

    it('should not throw when database save fails (non-fatal tracking)', async () => {
      // Replace mock with specific response
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Test response' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        },
        model: 'gpt-4.1-mini'
      });

      // Make database save fail
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database error', code: 'PGRST301' }
      });

      // Tracking errors are non-fatal — function should still return the response
      const result = await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        true
      );

      expect(result).toBe('Test response');
      // Tracking failure is logged (warn for first few, error after 3+ failures)
      const loggedViaError = (logger.error as jest.Mock).mock.calls.some(
        ([msg]: [string]) => typeof msg === 'string' && msg.includes('LLM call tracking save failed'),
      );
      const loggedViaWarn = (logger.warn as jest.Mock).mock.calls.some(
        ([msg]: [string]) => typeof msg === 'string' && msg.includes('LLM call tracking save failed'),
      );
      expect(loggedViaError || loggedViaWarn).toBe(true);
    });

    it('should handle streaming with reasoning tokens', async () => {
      // Create an async generator function
      async function* streamGenerator() {
        yield {
          choices: [{ delta: { content: 'Response' } }]
        };
        yield {
          choices: [{
            delta: {},
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15,
            completion_tokens_details: {
              reasoning_tokens: 3
            }
          },
          model: 'gpt-4.1-mini'
        };
      }

      // Mock returns a promise that resolves to a new generator when called
      mockCreateSpy.mockImplementationOnce(() => Promise.resolve(streamGenerator()));

      const setText = jest.fn();
      await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        true,
        setText,
        null,
        null,
        false
      );

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning_tokens: 3
        })
      );
    });

    it('should use correct system message for structured output', async () => {
      const responseSchema = z.object({
        answer: z.string()
      });

      // Replace mock with specific response
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{
          message: { content: '{"answer":"Test"}' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30
        },
        model: 'gpt-4.1-mini'
      });

      await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        responseSchema,
        'TestResponse',
        false
      );

      expect(mockCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            {
              role: 'system',
              content: 'You are a helpful assistant. Please provide your response in JSON format.'
            }
          ])
        })
      );
    });

    it('invokes onUsage callback with correct token metadata after non-streaming call', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, completion_tokens_details: { reasoning_tokens: 5 } },
        model: 'gpt-4.1-mini'
      });

      const onUsage = jest.fn();
      await callLLM('Test prompt', 'test_source', '00000000-0000-4000-8000-000000000001', 'gpt-4.1-mini', false, null, null, null, false, { onUsage });

      expect(onUsage).toHaveBeenCalledTimes(1);
      const usage: LLMUsageMetadata = onUsage.mock.calls[0][0];
      expect(usage.promptTokens).toBe(100);
      expect(usage.completionTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
      expect(usage.reasoningTokens).toBe(5);
      expect(usage.model).toBe('gpt-4.1-mini');
      expect(usage.estimatedCostUsd).toBeGreaterThan(0);
    });

    it('invokes onUsage callback after streaming call', async () => {
      async function* streamGenerator() {
        yield { choices: [{ delta: { content: 'Hello' } }] };
        yield {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
          model: 'gpt-4.1-mini'
        };
      }
      mockCreateSpy.mockImplementationOnce(() => Promise.resolve(streamGenerator()));

      const onUsage = jest.fn();
      const setText = jest.fn();
      await callLLM('Test', 'test_source', '00000000-0000-4000-8000-000000000001', 'gpt-4.1-mini', true, setText, null, null, false, { onUsage });

      expect(onUsage).toHaveBeenCalledTimes(1);
      expect(onUsage.mock.calls[0][0].promptTokens).toBe(20);
      expect(onUsage.mock.calls[0][0].completionTokens).toBe(10);
    });

    it('does not invoke onUsage callback when API call throws', async () => {
      mockCreateSpy.mockRejectedValueOnce(new Error('API failure'));

      const onUsage = jest.fn();
      await expect(
        callLLM('Test', 'test_source', '00000000-0000-4000-8000-000000000001', 'gpt-4.1-mini', false, null, null, null, false, { onUsage })
      ).rejects.toThrow('API failure');

      expect(onUsage).not.toHaveBeenCalled();
    });

    it('does not throw when onUsage callback is omitted (backward compat)', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'gpt-4.1-mini'
      });

      // No onUsage argument — backward compatible
      const result = await callLLM('Test', 'test_source', '00000000-0000-4000-8000-000000000001', 'gpt-4.1-mini', false, null, null, null, false);
      expect(result).toBe('Test response');
    });

    it('swallows onUsage callback errors without breaking the response', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Good response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'gpt-4.1-mini'
      });

      const onUsage = jest.fn(() => { throw new Error('callback boom'); });
      const result = await callLLM('Test', 'test_source', '00000000-0000-4000-8000-000000000001', 'gpt-4.1-mini', false, null, null, null, false, { onUsage });

      expect(result).toBe('Good response');
      expect(onUsage).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('onUsage callback failed', expect.objectContaining({ error: 'callback boom' }));
    });
  });

  describe('model constants', () => {
    it('should export correct default model', () => {
      expect(DEFAULT_MODEL).toBe('gpt-4.1-mini');
    });

    it('should export correct lighter model', () => {
      expect(LIGHTER_MODEL).toBe('gpt-4.1-nano');
    });
  });

  describe('cost tracking', () => {
    it('should include estimated_cost_usd in tracking data', async () => {
      const mockResponse = {
        choices: [{
          message: { content: 'Test response' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10000,
          completion_tokens: 5000,
          total_tokens: 15000
        },
        model: 'gpt-4.1-mini'
      };

      mockCreateSpy.mockResolvedValueOnce(mockResponse);

      await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        false
      );

      // gpt-4.1-mini: (10000/1M * 0.40) + (5000/1M * 1.60) = 0.004 + 0.008 = 0.012
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          estimated_cost_usd: expect.any(Number)
        })
      );

      const insertCall = mockSupabase.insert.mock.calls[0][0];
      expect(insertCall.estimated_cost_usd).toBeCloseTo(0.012, 6);
    });

    it('should calculate zero cost for zero tokens', async () => {
      const mockResponse = {
        choices: [{
          message: { content: 'Test response' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        },
        model: 'gpt-4.1-mini'
      };

      mockCreateSpy.mockResolvedValueOnce(mockResponse);

      await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        false
      );

      const insertCall = mockSupabase.insert.mock.calls[0][0];
      expect(insertCall.estimated_cost_usd).toBe(0);
    });

    it('should use default pricing for unknown model', async () => {
      // Mock response with an unknown model (would fall back to default pricing)
      const mockResponse = {
        choices: [{
          message: { content: 'Test response' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500
        },
        model: 'unknown-model-xyz'
      };

      mockCreateSpy.mockResolvedValueOnce(mockResponse);

      await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini', // Request model is valid, but API returns different model
        false,
        null,
        null,
        null,
        false
      );

      // Default pricing: (1000/1M * 10.00) + (500/1M * 30.00) = 0.01 + 0.015 = 0.025
      const insertCall = mockSupabase.insert.mock.calls[0][0];
      expect(insertCall.estimated_cost_usd).toBeCloseTo(0.025, 6);
    });
  });

  describe('evolution_invocation_id tracking', () => {
    const INVOCATION_UUID = '11111111-1111-4111-8111-111111111111';

    it('saveLlmCallTracking writes evolution_invocation_id when provided in tracking data', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Evo response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'gpt-4.1-mini',
      });

      await callLLM(
        'Test prompt',
        'evolution_generate',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        false,
        { evolutionInvocationId: INVOCATION_UUID },
      );

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          evolution_invocation_id: INVOCATION_UUID,
        })
      );
    });

    it('saveLlmCallTracking omits evolution_invocation_id when not provided (non-evolution calls)', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Normal response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'gpt-4.1-mini',
      });

      await callLLM(
        'Test prompt',
        'chat_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        false,
      );

      const insertCall = mockSupabase.insert.mock.calls[0][0];
      expect(insertCall.evolution_invocation_id).toBeUndefined();
    });

    it('callLLM passes evolutionInvocationId from CallLLMOptions to saveLlmCallTracking', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Linked response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 },
        model: 'gpt-4.1-mini',
      });

      const result = await callLLM(
        'Test prompt',
        'evolution_judge',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        false,
        { evolutionInvocationId: INVOCATION_UUID },
      );

      expect(result).toBe('Linked response');

      // Verify the insert call contains the invocation id alongside other tracking fields
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          call_source: 'evolution_judge',
          model: 'gpt-4.1-mini',
          evolution_invocation_id: INVOCATION_UUID,
        })
      );
    });
  });

  describe('edge cases', () => {
    it('should not throw on invalid tracking data (non-fatal tracking)', async () => {
      // Replace mock with invalid token data
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Test' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 'invalid', // Invalid token count - will fail Zod validation
          completion_tokens: 20,
          total_tokens: 30
        },
        model: 'gpt-4.1-mini'
      });

      // Tracking validation errors are non-fatal — function returns the response
      const result = await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        false
      );

      expect(result).toBe('Test');
      const loggedViaError = (logger.error as jest.Mock).mock.calls.some(
        ([msg]: [string]) => typeof msg === 'string' && msg.includes('LLM call tracking save failed'),
      );
      const loggedViaWarn = (logger.warn as jest.Mock).mock.calls.some(
        ([msg]: [string]) => typeof msg === 'string' && msg.includes('LLM call tracking save failed'),
      );
      expect(loggedViaError || loggedViaWarn).toBe(true);
    });

    it('should handle streaming interruption gracefully', async () => {
      // Create an async generator function that throws
      async function* interruptedGenerator() {
        yield {
          choices: [{ delta: { content: 'Partial ' } }]
        };
        throw new Error('Stream interrupted');
      }

      // Mock returns a promise that resolves to a new generator when called
      mockCreateSpy.mockImplementationOnce(() => Promise.resolve(interruptedGenerator()));

      const setText = jest.fn();
      await expect(
        callLLM(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'gpt-4.1-mini',
          true,
          setText,
          null,
          null,
          true
        )
      ).rejects.toThrow('Stream interrupted');

      expect(setText).toHaveBeenCalledWith('Partial ');
    });
  });

  describe('isOpenRouterModel', () => {
    it('should identify gpt-oss-20b as OpenRouter model', () => {
      expect(isOpenRouterModel('gpt-oss-20b')).toBe(true);
    });

    it('should not identify other models as OpenRouter', () => {
      expect(isOpenRouterModel('gpt-4.1-mini')).toBe(false);
      expect(isOpenRouterModel('deepseek-chat')).toBe(false);
      expect(isOpenRouterModel('claude-sonnet-4-20250514')).toBe(false);
      expect(isOpenRouterModel('LOCAL_qwen2.5:14b')).toBe(false);
    });
  });

  describe('OpenRouter model routing', () => {
    it('should route gpt-oss-20b to OpenRouter client with openai/ prefix', async () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'OpenRouter response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'openai/gpt-oss-20b',
      });

      const result = await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-oss-20b',
        false,
        null,
        null,
        null,
        false,
      );

      expect(result).toBe('OpenRouter response');
      // API model should have openai/ prefix prepended
      expect(mockCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'openai/gpt-oss-20b',
        })
      );
    });

    it('should throw when OPENROUTER_API_KEY is missing', async () => {
      delete process.env.OPENROUTER_API_KEY;

      await expect(
        callLLM(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'gpt-oss-20b',
          false,
          null,
          null,
          null,
          false,
        )
      ).rejects.toThrow('OPENROUTER_API_KEY not found in environment variables');
    });

    it('should use json_object response_format for OpenRouter with structured output', async () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
      const responseSchema = z.object({ answer: z.string() });

      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: '{"answer":"test"}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'openai/gpt-oss-20b',
      });

      await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-oss-20b',
        false,
        null,
        responseSchema,
        'TestResponse',
        false,
      );

      expect(mockCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' },
        })
      );
    });

    it('should use validatedModel for cost tracking (prevents pricing mismatch)', async () => {
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10000, completion_tokens: 5000, total_tokens: 15000 },
        model: 'openai/gpt-oss-20b-some-variant', // API may return different model string
      });

      await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-oss-20b',
        false,
        null,
        null,
        null,
        false,
      );

      // gpt-oss-20b: (10000/1M * 0.03) + (5000/1M * 0.11) = 0.0003 + 0.00055 = 0.00085
      const insertCall = mockSupabase.insert.mock.calls[0][0];
      expect(insertCall.estimated_cost_usd).toBeCloseTo(0.00085, 6);
    });
  });

  describe('isLocalModel', () => {
    it('should identify LOCAL_ prefixed models', () => {
      expect(isLocalModel('LOCAL_qwen2.5:14b')).toBe(true);
      expect(isLocalModel('LOCAL_llama3:8b')).toBe(true);
    });

    it('should not identify non-local models', () => {
      expect(isLocalModel('gpt-4.1-mini')).toBe(false);
      expect(isLocalModel('deepseek-chat')).toBe(false);
      expect(isLocalModel('claude-sonnet-4-20250514')).toBe(false);
    });
  });

  describe('local model routing', () => {
    it('should route LOCAL_ models to local client and strip prefix', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Local response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'qwen2.5:14b',
      });

      const result = await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'LOCAL_qwen2.5:14b',
        false,
        null,
        null,
        null,
        false,
      );

      expect(result).toBe('Local response');
      // Verify the model sent to API has LOCAL_ prefix stripped
      expect(mockCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'qwen2.5:14b',
        })
      );
    });

    it('should use json_object response_format for local models with structured output', async () => {
      const responseSchema = z.object({ answer: z.string() });

      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: '{"answer":"test"}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'qwen2.5:14b',
      });

      await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'LOCAL_qwen2.5:14b',
        false,
        null,
        responseSchema,
        'TestResponse',
        false,
      );

      expect(mockCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' },
        })
      );
      // zodResponseFormat should NOT be called for local models
    });

    it('should calculate $0 cost for local model calls', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Free response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10000, completion_tokens: 5000, total_tokens: 15000 },
        model: 'qwen2.5:14b',
      });

      await callLLM(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'LOCAL_qwen2.5:14b',
        false,
        null,
        null,
        null,
        false,
      );

      const insertCall = mockSupabase.insert.mock.calls[0][0];
      expect(insertCall.estimated_cost_usd).toBe(0);
    });
  });

  describe('isAnthropicModel', () => {
    it('should identify claude models as Anthropic', () => {
      expect(isAnthropicModel('claude-sonnet-4-20250514')).toBe(true);
      expect(isAnthropicModel('claude-3-5-sonnet-20241022')).toBe(true);
      expect(isAnthropicModel('claude-3-haiku-20240307')).toBe(true);
    });

    it('should not identify non-Claude models as Anthropic', () => {
      expect(isAnthropicModel('gpt-4.1-mini')).toBe(false);
      expect(isAnthropicModel('deepseek-chat')).toBe(false);
      expect(isAnthropicModel('o3-mini')).toBe(false);
    });
  });

  describe('Anthropic model routing', () => {
    let mockAnthropicCreate: jest.Mock;
    let mockAnthropicInstance: any;

    beforeAll(() => {
      mockAnthropicInstance = {
        messages: {
          create: jest.fn(),
          stream: jest.fn(),
        },
      };
      (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(() => mockAnthropicInstance);
    });

    beforeEach(() => {
      mockAnthropicCreate = mockAnthropicInstance.messages.create;
      mockAnthropicCreate.mockReset();
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    });

    it('should route Claude models to Anthropic provider', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Claude response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 100 },
      });

      const result = await callLLMModel(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'claude-sonnet-4-20250514',
        false,
        null,
      );

      expect(result).toBe('Claude response');
      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          messages: [{ role: 'user', content: 'Test prompt' }],
        })
      );
      // Verify OpenAI was NOT called
      expect(mockCreateSpy).not.toHaveBeenCalled();
    });

    it('should track Anthropic call costs in llmCallTracking', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 1000, output_tokens: 500 },
        stop_reason: 'end_turn',
      });

      await callLLMModel(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'claude-sonnet-4-20250514',
        false,
        null,
      );

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
          finish_reason: 'end_turn',
          estimated_cost_usd: expect.any(Number),
        })
      );

      // claude-sonnet-4: (1000/1M * 3.00) + (500/1M * 15.00) = 0.003 + 0.0075 = 0.0105
      const insertCall = mockSupabase.insert.mock.calls[0][0];
      expect(insertCall.estimated_cost_usd).toBeCloseTo(0.0105, 5);
    });

    it('should throw when ANTHROPIC_API_KEY is missing for Claude model', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(
        callLLMModel(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'claude-sonnet-4-20250514',
          false,
          null,
        )
      ).rejects.toThrow('ANTHROPIC_API_KEY required for Claude models');
    });

    it('should route non-Claude models to OpenAI provider', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'OpenAI response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'gpt-4.1-mini',
      });

      const result = await callLLMModel(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
      );

      expect(result).toBe('OpenAI response');
      expect(mockCreateSpy).toHaveBeenCalled();
      expect(mockAnthropicCreate).not.toHaveBeenCalled();
    });

    it('should handle empty Anthropic response', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '' }],
        usage: { input_tokens: 50, output_tokens: 0 },
        stop_reason: 'end_turn',
      });

      await expect(
        callLLMModel(
          'Test prompt',
          'test_source',
          '00000000-0000-4000-8000-000000000001',
          'claude-sonnet-4-20250514',
          false,
          null,
        )
      ).rejects.toThrow('No response received from Anthropic');
    });

    it('should not throw when saveLlmCallTracking fails in OpenAI path (non-fatal)', async () => {
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{ message: { content: 'Good response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        model: 'gpt-4.1-mini',
      });

      // Make DB save fail
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'DB tracking failure', code: 'PGRST301' },
      });

      // callOpenAIModel should NOT throw — tracking errors are non-fatal
      const result = await callOpenAIModel(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'gpt-4.1-mini',
        false,
        null,
      );

      expect(result).toBe('Good response');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('LLM call tracking save failed (non-fatal'),
        expect.objectContaining({ call_source: 'test_source', model: 'gpt-4.1-mini' }),
      );
    });

    it('should not throw when saveLlmCallTracking fails in Anthropic path (non-fatal)', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Claude response' }],
        usage: { input_tokens: 50, output_tokens: 100 },
        stop_reason: 'end_turn',
      });

      // Make DB save fail
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'DB tracking failure', code: 'PGRST301' },
      });

      const result = await callLLMModel(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'claude-sonnet-4-20250514',
        false,
        null,
      );

      expect(result).toBe('Claude response');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('LLM call tracking save failed (non-fatal'),
        expect.objectContaining({ call_source: 'test_source', model: 'claude-sonnet-4-20250514' }),
      );
    });

    it('should not identify OpenRouter models as Anthropic', () => {
      expect(isAnthropicModel('gpt-oss-20b')).toBe(false);
    });

    it('callOpenAIModel backward compat should also route Claude to Anthropic', async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Via backward compat' }],
        usage: { input_tokens: 50, output_tokens: 100 },
        stop_reason: 'end_turn',
      });

      // callOpenAIModel is now an alias for callLLMModel
      const result = await callOpenAIModel(
        'Test prompt',
        'test_source',
        '00000000-0000-4000-8000-000000000001',
        'claude-sonnet-4-20250514',
        false,
        null,
      );

      expect(result).toBe('Via backward compat');
      expect(mockAnthropicCreate).toHaveBeenCalled();
    });
  });
});