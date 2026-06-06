// Integration test for the prompt-editor harness ephemerality: running N configs writes NO
// evolution-pipeline rows (no invocations / variants / metrics / arena comparisons). callLLM is
// mocked (firing onUsage) so no real LLM spend or llmCallTracking write occurs; the point here is
// to prove the harness itself never touches the evolution tables. Row-absence is scoped by a
// created_at window (these tables are global; jest.integration runs serial so the window is safe).

jest.mock('@/lib/services/llms', () => {
  const actual = jest.requireActual('@/lib/services/llms');
  return { ...actual, callLLM: jest.fn() };
});

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evolutionTablesExist } from '@evolution/testing/evolution-test-helpers';
import { callLLM } from '@/lib/services/llms';
import { runPromptEditor } from '@evolution/lib/promptEditor/runPromptEditor';
import type { PromptEditorRunInput } from '@evolution/lib/promptEditor/types';

const mockCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;

describe('Prompt editor integration — ephemerality', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
  });

  beforeEach(() => {
    mockCallLLM.mockReset();
    mockCallLLM.mockImplementation(async (...args: unknown[]) => {
      const options = args[9] as { onUsage?: (u: { estimatedCostUsd: number; promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens: number; model: string }) => void } | undefined;
      options?.onUsage?.({ estimatedCostUsd: 0.0012, promptTokens: 50, completionTokens: 120, totalTokens: 170, reasoningTokens: 0, model: 'gpt-4.1-nano' });
      return '# Rewritten\n\nFirst sentence here. Second sentence here.';
    });
  });

  const countSince = async (table: string, sinceIso: string): Promise<number> => {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .gte('created_at', sinceIso);
    if (error) throw error;
    return count ?? 0;
  };

  it('runs 3 parallel configs and writes NO evolution-pipeline rows', async () => {
    if (!tablesExist) {
      console.warn('evolution tables not migrated — skipping ephemerality integration test');
      return;
    }

    const sinceIso = new Date(Date.now() - 1000).toISOString();

    const input: PromptEditorRunInput = {
      unit: 'article',
      sourceText: '# Source\n\nA body paragraph with two sentences. Here is the second.',
      configs: [
        { label: 'A', prompt: { preamble: 'Editor.', instructions: 'Improve.' }, model: 'gpt-4.1-nano', temperature: 0.7 },
        { label: 'B', prompt: { preamble: 'Editor.', instructions: 'Simplify.' }, model: 'gpt-4.1-nano', temperature: 1.0 },
        { label: 'C', prompt: { preamble: 'Editor.', instructions: 'Restructure.' }, model: 'gpt-4.1-nano', temperature: 0.3 },
      ],
    };

    const result = await runPromptEditor(input);

    // Per-config output + cost.
    expect(result.configs).toHaveLength(3);
    expect(result.configs.every((c) => c.status === 'success')).toBe(true);
    expect(result.configs.every((c) => (c.output ?? '').includes('Rewritten'))).toBe(true);
    expect(result.totalCostUsd).toBeCloseTo(0.0036, 6);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);

    // Ephemerality: no rows in any evolution-pipeline table since the run started.
    for (const table of ['evolution_agent_invocations', 'evolution_variants', 'evolution_metrics', 'evolution_arena_comparisons']) {
      expect(await countSince(table, sinceIso)).toBe(0);
    }
  });

  it('isolates a failing config under Promise.allSettled', async () => {
    if (!tablesExist) return;
    mockCallLLM
      .mockImplementationOnce(async () => { throw new Error('boom'); })
      .mockImplementation(async (...args: unknown[]) => {
        const options = args[9] as { onUsage?: (u: { estimatedCostUsd: number; promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens: number; model: string }) => void } | undefined;
        options?.onUsage?.({ estimatedCostUsd: 0.001, promptTokens: 10, completionTokens: 20, totalTokens: 30, reasoningTokens: 0, model: 'gpt-4.1-nano' });
        return '# Ok\n\nOne. Two.';
      });

    const input: PromptEditorRunInput = {
      unit: 'article',
      sourceText: 'src',
      configs: [
        { label: 'A', prompt: { preamble: 'p', instructions: 'i' }, model: 'gpt-4.1-nano' },
        { label: 'B', prompt: { preamble: 'p', instructions: 'i' }, model: 'gpt-4.1-nano' },
      ],
    };
    const result = await runPromptEditor(input);
    expect(result.configs[0]!.status).toBe('error');
    expect(result.configs[1]!.status).toBe('success');
  });
});
