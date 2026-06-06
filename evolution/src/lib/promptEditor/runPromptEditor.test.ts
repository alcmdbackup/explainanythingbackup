// Unit tests for runPromptEditor: pre-flight cost-cap rejection, parallel dispatch, and
// per-config failure isolation under Promise.allSettled.

import {
  runPromptEditor,
  estimatePromptEditorRunCost,
  PromptEditorCostCapError,
  PROMPT_EDITOR_PER_RUN_CAP_USD,
} from './runPromptEditor';
import type { PromptEditorRunInput } from './types';

jest.mock('@/lib/services/llms', () => {
  const actual = jest.requireActual('@/lib/services/llms');
  return { ...actual, callLLM: jest.fn() };
});

import { callLLM } from '@/lib/services/llms';
const mockCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;

beforeEach(() => mockCallLLM.mockReset());

const cfg = (label: string, model = 'gpt-4.1-nano') => ({
  label,
  prompt: { preamble: 'p', instructions: 'i' },
  model,
  temperature: 0.7,
});

describe('estimatePromptEditorRunCost', () => {
  it('sums a positive estimate across configs', () => {
    const input: PromptEditorRunInput = {
      unit: 'article',
      sourceText: 'word '.repeat(500),
      configs: [cfg('A'), cfg('B')],
    };
    expect(estimatePromptEditorRunCost(input)).toBeGreaterThan(0);
  });
});

describe('runPromptEditor', () => {
  it('throws PromptEditorCostCapError when the estimate exceeds the cap', async () => {
    // gpt-4o is pricier; a huge source over several configs blows the $0.50 cap.
    const input: PromptEditorRunInput = {
      unit: 'article',
      sourceText: 'x'.repeat(4_000_000),
      configs: [cfg('A', 'gpt-4o'), cfg('B', 'gpt-4o')],
    };
    await expect(runPromptEditor(input)).rejects.toBeInstanceOf(PromptEditorCostCapError);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('runs all configs in parallel and aggregates cost', async () => {
    mockCallLLM.mockImplementation(async (...args: unknown[]) => {
      const options = args[9] as { onUsage?: (u: { estimatedCostUsd: number; promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens: number; model: string }) => void } | undefined;
      options?.onUsage?.({ estimatedCostUsd: 0.001, promptTokens: 10, completionTokens: 20, totalTokens: 30, reasoningTokens: 0, model: 'gpt-4.1-nano' });
      return '# T\n\nSentence one. Sentence two.';
    });
    const input: PromptEditorRunInput = { unit: 'article', sourceText: 'short src', configs: [cfg('A'), cfg('B'), cfg('C')] };
    const res = await runPromptEditor(input);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);
    expect(res.configs).toHaveLength(3);
    expect(res.configs.every((c) => c.status === 'success')).toBe(true);
    expect(res.totalCostUsd).toBeCloseTo(0.003, 6);
  });

  it('isolates one failing config (rejection does not block siblings)', async () => {
    mockCallLLM
      .mockImplementationOnce(async () => { throw new Error('boom'); })
      .mockImplementation(async (...args: unknown[]) => {
        const options = args[9] as { onUsage?: (u: { estimatedCostUsd: number; promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens: number; model: string }) => void } | undefined;
        options?.onUsage?.({ estimatedCostUsd: 0.002, promptTokens: 10, completionTokens: 20, totalTokens: 30, reasoningTokens: 0, model: 'gpt-4.1-nano' });
        return '# Ok\n\nOne. Two.';
      });
    const input: PromptEditorRunInput = { unit: 'article', sourceText: 'src', configs: [cfg('A'), cfg('B')] };
    const res = await runPromptEditor(input);
    expect(res.configs[0]!.status).toBe('error');
    expect(res.configs[1]!.status).toBe('success');
  });

  it('keeps the cap constant', () => {
    expect(PROMPT_EDITOR_PER_RUN_CAP_USD).toBe(0.5);
  });
});
