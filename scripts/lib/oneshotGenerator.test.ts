/**
 * @jest-environment node
 */
// Tests for oneshotGenerator.ts — validates LLM call routing, title parsing,
// cost calculation, tracking, and error handling with mocked SDK clients.

// Mock OpenAI and Anthropic SDKs before imports
const mockOpenAICreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  }));
});

const mockAnthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  }));
});

import { callLLM, generateOneshotArticle, trackLLMCall } from './oneshotGenerator';

describe('oneshotGenerator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('callLLM', () => {
    it('should route OpenAI models to OpenAI SDK', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        model: 'gpt-4.1',
      });

      const result = await callLLM('test prompt', 'gpt-4.1');
      expect(result.content).toBe('Hello');
      expect(result.promptTokens).toBe(10);
      expect(result.completionTokens).toBe(5);
      expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
    });

    it('should route deepseek models to OpenAI SDK with custom baseURL', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: 'DeepSeek response' } }],
        usage: { prompt_tokens: 8, completion_tokens: 12 },
        model: 'deepseek-chat',
      });

      const result = await callLLM('test prompt', 'deepseek-chat');
      expect(result.content).toBe('DeepSeek response');
      expect(result.model).toBe('deepseek-chat');
    });

    it('should route claude models to Anthropic SDK', async () => {
      mockAnthropicCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Claude response' }],
        usage: { input_tokens: 15, output_tokens: 20 },
      });

      const result = await callLLM('test prompt', 'claude-sonnet-4-20250514');
      expect(result.content).toBe('Claude response');
      expect(result.promptTokens).toBe(15);
      expect(result.completionTokens).toBe(20);
      expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    });

    it('should throw when API key is missing for OpenAI', async () => {
      delete process.env.OPENAI_API_KEY;
      await expect(callLLM('test', 'gpt-4.1')).rejects.toThrow('OPENAI_API_KEY required');
    });

    it('should throw when API key is missing for DeepSeek', async () => {
      delete process.env.DEEPSEEK_API_KEY;
      await expect(callLLM('test', 'deepseek-chat')).rejects.toThrow('DEEPSEEK_API_KEY required');
    });

    it('should throw when API key is missing for Claude', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      await expect(callLLM('test', 'claude-sonnet-4-20250514')).rejects.toThrow('ANTHROPIC_API_KEY required');
    });
  });

  describe('generateOneshotArticle', () => {
    beforeEach(() => {
      // Title call returns valid JSON
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ title1: 'Test Title', title2: 'Alt 1', title3: 'Alt 2' }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
        model: 'gpt-4.1-mini',
      });
      // Article call returns content
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Article body content here.' } }],
        usage: { prompt_tokens: 200, completion_tokens: 500 },
        model: 'gpt-4.1-mini',
      });
    });

    it('should generate title and article', async () => {
      const result = await generateOneshotArticle('Explain photosynthesis', 'gpt-4.1-mini', null);

      expect(result.title).toBe('Test Title');
      expect(result.content).toContain('# Test Title');
      expect(result.content).toContain('Article body content here.');
      expect(result.model).toBe('gpt-4.1-mini');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should accumulate token counts from both calls', async () => {
      const result = await generateOneshotArticle('Explain photosynthesis', 'gpt-4.1-mini', null);

      expect(result.promptTokens).toBe(300); // 100 + 200
      expect(result.completionTokens).toBe(520); // 20 + 500
    });

    it('should calculate total cost from both calls', async () => {
      const result = await generateOneshotArticle('Explain photosynthesis', 'gpt-4.1-mini', null);

      // gpt-4.1-mini: input $0.40/1M, output $1.60/1M
      // Title: (100/1M * 0.40) + (20/1M * 1.60) = 0.00004 + 0.000032 = 0.000072
      // Article: (200/1M * 0.40) + (500/1M * 1.60) = 0.00008 + 0.0008 = 0.00088
      // Total: 0.000072 + 0.00088 = 0.000952
      expect(result.totalCostUsd).toBeCloseTo(0.000952, 5);
    });

    it('should fall back to raw text when title JSON parsing fails', async () => {
      mockOpenAICreate.mockReset();
      // Title call returns non-JSON
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Just a plain title' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10 },
        model: 'gpt-4.1-mini',
      });
      // Article call
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [{ message: { content: 'Body text.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
        model: 'gpt-4.1-mini',
      });

      const result = await generateOneshotArticle('Explain photosynthesis', 'gpt-4.1-mini', null);
      expect(result.title).toBe('Just a plain title');
    });
  });

  describe('trackLLMCall', () => {
    it('should not throw when supabase is null', async () => {
      await expect(
        trackLLMCall(null, {
          prompt: 'test',
          content: 'test',
          callSource: 'test',
          model: 'test',
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          rawResponse: '{}',
          finishReason: 'stop',
        }),
      ).resolves.toBeUndefined();
    });

    it('should insert tracking record to supabase', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      const mockSupabase = {
        from: jest.fn().mockReturnValue({ insert: mockInsert }),
      };

      await trackLLMCall(mockSupabase as any, {
        prompt: 'test prompt',
        content: 'test content',
        callSource: 'oneshot_gpt-4.1',
        model: 'gpt-4.1',
        promptTokens: 100,
        completionTokens: 200,
        costUsd: 0.005,
        rawResponse: '{}',
        finishReason: 'stop',
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('llmCallTracking');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4.1',
          prompt_tokens: 100,
          completion_tokens: 200,
          total_tokens: 300,
        }),
      );
    });

    it('should not throw when supabase insert fails', async () => {
      const mockSupabase = {
        from: jest.fn().mockReturnValue({
          insert: jest.fn().mockRejectedValue(new Error('DB error')),
        }),
      };

      await expect(
        trackLLMCall(mockSupabase as any, {
          prompt: 'test',
          content: 'test',
          callSource: 'test',
          model: 'test',
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          rawResponse: '{}',
          finishReason: 'stop',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
