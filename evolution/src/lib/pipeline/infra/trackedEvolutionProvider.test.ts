/**
 * Unit tests for createTrackedEvolutionProvider — the shared tracked LLM provider that routes
 * evolution calls through callLLM with fail-closed tracking (Layer 2, llm_costs_too_low_in_dash).
 */

import { callLLM } from '@/lib/services/llms';
import { evolutionSource } from '@/lib/services/llmCallSource';
import {
  createTrackedEvolutionProvider,
  EVOLUTION_SYSTEM_USERID,
  EVOLUTION_MAX_OUTPUT_TOKENS,
} from './trackedEvolutionProvider';

jest.mock('@/lib/services/llms', () => ({ callLLM: jest.fn() }));

const mockCallLLM = callLLM as jest.Mock;

// Minimal Supabase stand-in; the factory only forwards it as trackingDb.
const fakeDb = { __db: true } as never;

describe('createTrackedEvolutionProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Simulate callLLM firing onUsage (as saveTrackingAndNotify does) then returning text.
    mockCallLLM.mockImplementation(async (...args: unknown[]) => {
      const opts = args[9] as { onUsage?: (u: unknown) => void };
      opts.onUsage?.({ promptTokens: 10, completionTokens: 20, reasoningTokens: 3, cachedPromptTokens: 1 });
      return 'generated text';
    });
  });

  it('routes through callLLM with fail-closed tracking + injected db + FK + cap', async () => {
    const provider = createTrackedEvolutionProvider({ db: fakeDb });
    const result = await provider.complete('a prompt', 'generation', { invocationId: 'inv-1' });

    expect(result.text).toBe('generated text');
    // onUsage populated the returned usage (capturedUsage path).
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20, reasoningTokens: 3, cachedPromptTokens: 1 });

    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const args = mockCallLLM.mock.calls[0];
    expect(args[1]).toBe(evolutionSource('generation')); // call_source = evolution_generation
    expect(args[2]).toBe(EVOLUTION_SYSTEM_USERID);
    expect(args[3]).toBe('deepseek-chat'); // default model, parsed by allowedLLMModelSchema
    const opts = args[9] as Record<string, unknown>;
    expect(opts.trackingDb).toBe(fakeDb);
    expect(opts.requireTracking).toBe(true);
    expect(opts.maxOutputTokens).toBe(EVOLUTION_MAX_OUTPUT_TOKENS);
    expect(opts.evolutionInvocationId).toBe('inv-1');
  });

  it('honours an explicit model and maxOutputTokens override', async () => {
    const provider = createTrackedEvolutionProvider({ db: fakeDb, defaultModel: 'gpt-4.1-nano', maxOutputTokens: 999 });
    await provider.complete('p', 'ranking');
    const args = mockCallLLM.mock.calls[0];
    expect(args[3]).toBe('gpt-4.1-nano');
    expect((args[9] as Record<string, unknown>).maxOutputTokens).toBe(999);
  });

  it('rejects an unregistered model via allowedLLMModelSchema (no silent live call)', async () => {
    const provider = createTrackedEvolutionProvider({ db: fakeDb });
    await expect(provider.complete('p', 'generation', { model: 'not-a-real-model-xyz' })).rejects.toThrow();
    expect(mockCallLLM).not.toHaveBeenCalled();
  });
});
