// Integration test for the prompt-editor harness ephemerality: running N configs writes NO
// evolution-pipeline rows (no invocations / variants / metrics / arena comparisons). callLLM is
// mocked (firing onUsage) so no real LLM spend or llmCallTracking write occurs; the point here is
// to prove the harness itself never touches the evolution tables.
//
// Ephemerality is asserted STRUCTURALLY, two complementary ways:
//   1. `createSupabaseServiceClient` is mocked to throw — runPromptEditor must never construct a
//      service client. Catches any future regression that wires supabase into the editor path
//      (even one whose return value bypasses the result shape).
//   2. The returned result is purely in-memory — exactly `{configs, totalCostUsd}` and no
//      run/variant/invocation ids on any config row, so a write that leaked an id back would
//      still fail.
//
// Both fire deterministically without touching the shared dev DB. The prior approach counted
// rows in the (global) evolution tables created since a `created_at` window and asserted 0 —
// but that is racy: the live minicomputer batch runner and concurrent CI "E2E Tests (Evolution)"
// jobs write to those same tables within the window, so the count is intermittently 1-2.

jest.mock('@/lib/services/llms', () => {
  const actual = jest.requireActual('@/lib/services/llms');
  return { ...actual, callLLM: jest.fn() };
});

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(() => {
    throw new Error('runPromptEditor must not construct a supabase service client');
  }),
}));

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evolutionTablesExist } from '@evolution/testing/evolution-test-helpers';
import { callLLM } from '@/lib/services/llms';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { runPromptEditor } from '@evolution/lib/promptEditor/runPromptEditor';
import type { PromptEditorRunInput } from '@evolution/lib/promptEditor/types';

const mockCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;
const mockCreateServiceClient = createSupabaseServiceClient as jest.MockedFunction<typeof createSupabaseServiceClient>;

describe('Prompt editor integration — ephemerality', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
  });

  beforeEach(() => {
    mockCallLLM.mockReset();
    mockCreateServiceClient.mockClear();
    mockCallLLM.mockImplementation(async (...args: unknown[]) => {
      const options = args[9] as { onUsage?: (u: { estimatedCostUsd: number; promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens: number; model: string }) => void } | undefined;
      options?.onUsage?.({ estimatedCostUsd: 0.0012, promptTokens: 50, completionTokens: 120, totalTokens: 170, reasoningTokens: 0, model: 'gpt-4.1-nano' });
      return '# Rewritten\n\nFirst sentence here. Second sentence here.';
    });
  });

  it('runs 3 parallel configs and writes NO evolution-pipeline rows', async () => {
    if (!tablesExist) {
      console.warn('evolution tables not migrated — skipping ephemerality integration test');
      return;
    }

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

    // Ephemerality (1/2): structural — runPromptEditor must never construct a supabase service
    // client. The most likely regression that would let it write evolution-pipeline rows is
    // importing `@/lib/utils/supabase/server`; mock-spy surfaces it deterministically without
    // racing the shared dev DB.
    expect(mockCreateServiceClient).not.toHaveBeenCalled();

    // Ephemerality (2/2): the result is purely in-memory — no persisted identifiers. A write
    // that leaked an id back through the return value would fail here even if it bypassed (1).
    expect(Object.keys(result).sort()).toEqual(['configs', 'totalCostUsd']);
    const configKeys = new Set(result.configs.flatMap((c) => Object.keys(c)));
    for (const persistedKey of ['id', 'runId', 'run_id', 'variantId', 'variant_id', 'invocationId']) {
      expect(configKeys.has(persistedKey)).toBe(false);
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
