/**
 * @jest-environment node
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from "openai/helpers/zod";

// Mock dependencies
jest.mock('openai');
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn()
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

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { callOpenAIModel, default_model, lighter_model } from './llms';

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
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-api-key' };

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
    (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);

    // Mock zodResponseFormat
    (zodResponseFormat as jest.Mock).mockReturnValue({ type: 'json_object' });
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('callOpenAIModel', () => {
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

      const result = await callOpenAIModel(
        'Test prompt',
        'test_source',
        'user123',
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
      const result = await callOpenAIModel(
        'Test prompt',
        'test_source',
        'user123',
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

      const result = await callOpenAIModel(
        'Test prompt',
        'test_source',
        'user123',
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
        callOpenAIModel(
          'Test prompt',
          'test_source',
          'user123',
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
        callOpenAIModel(
          'Test prompt',
          'test_source',
          'user123',
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
        callOpenAIModel(
          'Test prompt',
          'test_source',
          'user123',
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
        callOpenAIModel(
          'Test prompt',
          'test_source',
          'user123',
          'gpt-4.1-mini',
          false,
          null,
          null,
          null,
          true
        )
      ).rejects.toThrow('OpenAI API error');

      expect(logger.error).toHaveBeenCalledWith('Error in GPT4omini call: OpenAI API error');
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
        callOpenAIModel(
          'Test prompt',
          'test_source',
          'user123',
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
        callOpenAIModel(
          'Test prompt',
          'test_source',
          'user123',
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
        callOpenAIModel(
          'Test prompt',
          'test_source',
          'user123',
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

    it('should save tracking data even when database save fails', async () => {
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
        error: new Error('Database error')
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await callOpenAIModel(
        'Test prompt',
        'test_source',
        'user123',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        true
      );

      // Should still return result despite database error
      expect(result).toBe('Test response');
      expect(consoleSpy).toHaveBeenCalledWith('Error saving LLM call tracking:', expect.any(Error));

      consoleSpy.mockRestore();
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
      await callOpenAIModel(
        'Test prompt',
        'test_source',
        'user123',
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

      await callOpenAIModel(
        'Test prompt',
        'test_source',
        'user123',
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
  });

  describe('model constants', () => {
    it('should export correct default model', () => {
      expect(default_model).toBe('gpt-4.1-mini');
    });

    it('should export correct lighter model', () => {
      expect(lighter_model).toBe('gpt-4.1-nano');
    });
  });

  describe('edge cases', () => {
    it('should handle invalid tracking data gracefully', async () => {
      // Replace mock with invalid token data
      mockCreateSpy.mockResolvedValueOnce({
        choices: [{
          message: { content: 'Test' },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 'invalid', // Invalid token count
          completion_tokens: 20,
          total_tokens: 30
        },
        model: 'gpt-4.1-mini'
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await callOpenAIModel(
        'Test prompt',
        'test_source',
        'user123',
        'gpt-4.1-mini',
        false,
        null,
        null,
        null,
        false
      );

      // Should still return result
      expect(result).toBe('Test');
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
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
        callOpenAIModel(
          'Test prompt',
          'test_source',
          'user123',
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
});