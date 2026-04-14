// Integration test: verifies Qwen 2.5 7B (the new default judge) routes correctly
// through the LLM call chain. Mocks the OpenAI SDK at the client level so no real
// OpenRouter API calls are made — asserts the request payload has the correct
// API model ID (`qwen/qwen-2.5-7b-instruct`) and that the model is registered
// as an OpenRouter-routed model.

import { isOpenRouterModel, getOpenRouterApiModelId, DEFAULT_JUDGE_MODEL, getModelInfo } from '@/config/modelRegistry';

describe('judge model routing — Qwen 2.5 7B', () => {
  describe('registry checks', () => {
    it('DEFAULT_JUDGE_MODEL is qwen-2.5-7b-instruct', () => {
      expect(DEFAULT_JUDGE_MODEL).toBe('qwen-2.5-7b-instruct');
    });

    it('is registered as an OpenRouter model', () => {
      expect(isOpenRouterModel('qwen-2.5-7b-instruct')).toBe(true);
    });

    it('API model ID is qwen/qwen-2.5-7b-instruct', () => {
      expect(getOpenRouterApiModelId('qwen-2.5-7b-instruct')).toBe('qwen/qwen-2.5-7b-instruct');
    });

    it('model info matches expected pricing + maxTemperature', () => {
      const info = getModelInfo('qwen-2.5-7b-instruct');
      expect(info).toBeDefined();
      expect(info!.provider).toBe('openrouter');
      expect(info!.inputPer1M).toBe(0.04);
      expect(info!.outputPer1M).toBe(0.10);
      expect(info!.maxTemperature).toBe(2.0);
      expect(info!.supportsEvolution).toBe(true);
    });
  });

  describe('call chain (mocked SDK)', () => {
    // Mock the OpenAI SDK client's create method to capture the request payload
    // without actually hitting OpenRouter.
    let mockCreate: jest.Mock;

    beforeEach(() => {
      mockCreate = jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'mocked response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        model: 'qwen/qwen-2.5-7b-instruct',
      });

      jest.doMock('openai', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          chat: { completions: { create: mockCreate } },
        })),
      }));

      process.env.OPENROUTER_API_KEY = 'test-or-key';
      process.env.OPENAI_API_KEY = 'test-oai-key';
    });

    afterEach(() => {
      jest.dontMock('openai');
      jest.resetModules();
    });

    it('routes qwen-2.5-7b-instruct to OpenRouter with correct API model ID', async () => {
      // Re-require callLLM after the mock is installed so it picks up the mocked SDK.
      const { callLLM } = await import('@/lib/services/llms');

      const result = await callLLM(
        'Test prompt',
        'evolution_ranking',
        '00000000-0000-4000-8000-000000000001',
        'qwen-2.5-7b-instruct',
        false, null, null, null, false,
      );

      expect(result).toBe('mocked response');
      // API model ID sent to OpenRouter must match the registry mapping
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'qwen/qwen-2.5-7b-instruct' }),
      );
    });
  });
});
