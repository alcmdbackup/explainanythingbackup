// Unit tests for runPromptEditorConfig. Mocks @/lib/services/llms (callLLM is called directly,
// NOT via EvolutionLLMClient) and fires the onUsage callback to populate cost.

import { GlobalBudgetExceededError, LLMKillSwitchError } from '@/lib/errors/serviceError';
import {
  runPromptEditorConfig,
  resolvePromptEditorTemperature,
  PROMPT_EDITOR_CALL_SOURCE,
} from './runPromptEditorConfig';
import type { PromptEditorConfig } from './types';

jest.mock('@/lib/services/llms', () => {
  const actual = jest.requireActual('@/lib/services/llms');
  return { ...actual, callLLM: jest.fn() };
});

import { callLLM } from '@/lib/services/llms';
const mockCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;

/** Make the mock resolve `text` and fire onUsage with a given cost. */
function mockLLM(text: string, estimatedCostUsd = 0.0021): void {
  mockCallLLM.mockImplementation(async (...args: unknown[]) => {
    const options = args[9] as { onUsage?: (u: { estimatedCostUsd: number; promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens: number; model: string }) => void } | undefined;
    options?.onUsage?.({ estimatedCostUsd, promptTokens: 100, completionTokens: 200, totalTokens: 300, reasoningTokens: 0, model: 'gpt-4.1-nano' });
    return text;
  });
}

const articleConfig: PromptEditorConfig = {
  label: 'A',
  prompt: { preamble: 'You are an editor.', instructions: 'Improve it.' },
  model: 'gpt-4.1-nano',
  temperature: 0.7,
};

beforeEach(() => mockCallLLM.mockReset());

describe('resolvePromptEditorTemperature', () => {
  it('omits temperature (null) for a model with null maxTemperature (o3-mini)', () => {
    expect(resolvePromptEditorTemperature('o3-mini', 1.0)).toBeNull();
  });
  it('omits temperature when none requested', () => {
    expect(resolvePromptEditorTemperature('gpt-4.1-nano', undefined)).toBeNull();
  });
  it('clamps to the model max', () => {
    expect(resolvePromptEditorTemperature('gpt-4.1-nano', 5)).toBe(2.0);
    expect(resolvePromptEditorTemperature('gpt-4.1-nano', 0.7)).toBe(0.7);
  });
});

describe('runPromptEditorConfig', () => {
  it('makes a single callLLM with model as the 4th positional arg + evolution_prompt_editor source', async () => {
    mockLLM('# Rewritten\n\nA paragraph here. And another sentence.');
    const res = await runPromptEditorConfig('article', '# Src\n\nBody text here.', articleConfig);
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
    const callArgs = mockCallLLM.mock.calls[0]!;
    expect(callArgs[1]).toBe(PROMPT_EDITOR_CALL_SOURCE);
    expect(callArgs[3]).toBe('gpt-4.1-nano'); // model is the 4th positional arg
    expect(callArgs[5]).toBeNull(); // setText must be null (not undefined)
    expect(res.status).toBe('success');
    expect(res.output).toContain('Rewritten');
  });

  it('takes cost from the onUsage callback', async () => {
    mockLLM('# T\n\nOne two. Three four.', 0.0042);
    const res = await runPromptEditorConfig('article', 'src body', articleConfig);
    expect(res.costUsd).toBe(0.0042);
  });

  it('omits temperature in options for a null-maxTemperature model', async () => {
    mockLLM('# T\n\nOne two. Three four.');
    const res = await runPromptEditorConfig('article', 'src', { ...articleConfig, model: 'o3-mini', temperature: 1.5 });
    const opts = mockCallLLM.mock.calls[0]![9] as { temperature?: number };
    expect(opts.temperature).toBeUndefined();
    expect(res.temperatureUsed).toBeNull();
  });

  it('populates formatIssues but still returns output (display-only validation)', async () => {
    // Output with a bullet list → article validateFormat flags it, but output is still returned.
    mockLLM('# Title\n\n- a bullet\n- another');
    const res = await runPromptEditorConfig('article', 'src', articleConfig);
    expect(res.status).toBe('success');
    expect(res.output).toContain('- a bullet');
    expect(res.formatValid).toBe(false);
    expect(res.formatIssues && res.formatIssues.length).toBeGreaterThan(0);
  });

  it('normalizes paragraph dropReason into formatIssues', async () => {
    // 1-char rewrite of a long source → length_under.
    mockLLM('x.');
    const res = await runPromptEditorConfig('paragraph', 'a'.repeat(400), {
      label: 'P', prompt: { directive: 'Tighten.' }, model: 'gpt-4.1-nano',
    });
    expect(res.status).toBe('success');
    expect(res.formatValid).toBe(false);
    expect(res.formatIssues).toContain('length_under');
  });

  it('maps GlobalBudgetExceededError → budget', async () => {
    mockCallLLM.mockRejectedValue(new GlobalBudgetExceededError('over budget'));
    const res = await runPromptEditorConfig('article', 'src', articleConfig);
    expect(res.status).toBe('budget');
    expect(res.output).toBeNull();
  });

  it('maps LLMKillSwitchError → killed', async () => {
    mockCallLLM.mockRejectedValue(new LLMKillSwitchError());
    const res = await runPromptEditorConfig('article', 'src', articleConfig);
    expect(res.status).toBe('killed');
  });

  it('maps abort/timeout → timeout', async () => {
    const e = new Error('Request timed out'); e.name = 'AbortError';
    mockCallLLM.mockRejectedValue(e);
    const res = await runPromptEditorConfig('article', 'src', articleConfig);
    expect(res.status).toBe('timeout');
  });

  it('flags refusal-looking output but keeps status success', async () => {
    mockLLM("I'm sorry, I can't help with that.\n\nMore text.");
    const res = await runPromptEditorConfig('article', 'src', articleConfig);
    expect(res.status).toBe('success');
    expect(res.looksLikeRefusal).toBe(true);
  });

  it('returns error status for an unsupported model without calling the LLM', async () => {
    const res = await runPromptEditorConfig('article', 'src', { ...articleConfig, model: 'not-a-real-model' });
    expect(res.status).toBe('error');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });
});
