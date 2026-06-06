// Tests for the Match Viewer actions: getRecentMatchesAction (run-id filter, previews,
// test-content !inner embed), getComparisonDetailAction (content join + missing variant),
// and rejudgeComparisonAction (display-only: callLLM model+temp, NO DB write, passes,
// pre-LLM rejection of invalid model / over-long prompt).
// (match_viewer_with_experimentation_procedures_20260605)

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { createTableAwareMock } from '@evolution/testing/service-test-mocks';
import { callLLM } from '@/lib/services/llms';

jest.mock('@/lib/utils/supabase/server', () => ({ createSupabaseServiceClient: jest.fn() }));
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));
jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));
jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));
jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/services/llms', () => ({ callLLM: jest.fn() }));

import {
  getRecentMatchesAction,
  getComparisonDetailAction,
  rejudgeComparisonAction,
} from './arenaActions';

const CMP = '550e8400-e29b-41d4-a716-446655440000';
const RUN = '660e8400-e29b-41d4-a716-446655440001';
const VA = 'aaaaaaaa-e29b-41d4-a716-446655440002';
const VB = 'bbbbbbbb-e29b-41d4-a716-446655440003';
const mockCallLLM = callLLM as jest.Mock;

const compRow = {
  id: CMP, prompt_id: RUN, entry_a: VA, entry_b: VB,
  winner: 'a', confidence: 1, run_id: RUN, status: 'complete', created_at: '2026-06-01T00:00:00Z',
  evolution_prompts: { prompt_kind: 'article' },
};

beforeEach(() => jest.clearAllMocks());

describe('getRecentMatchesAction', () => {
  it('filters by run_id, paginates, and attaches variant previews', async () => {
    let compBuilder: Record<string, jest.Mock> | undefined;
    const mock = createTableAwareMock([
      (b) => { compBuilder = b; b.then = jest.fn((r) => r({ data: [compRow], error: null, count: 1 })); },
      (b) => { b.then = jest.fn((r) => r({ data: [
        { id: VA, variant_content: 'Photosynthesis content here' },
        { id: VB, variant_content: 'A plant content here' },
      ], error: null })); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const res = await getRecentMatchesAction({ runId: RUN, limit: 50, offset: 0 });
    expect(res.success).toBe(true);
    expect(res.data!.total).toBe(1);
    expect(res.data!.items[0]!.entry_a_preview).toBe('Photosynthesis content here');
    expect(res.data!.items[0]!.entry_b_preview).toBe('A plant content here');
    expect(res.data!.items[0]!.kind).toBe('article');
    expect(compBuilder!.eq).toHaveBeenCalledWith('run_id', RUN);
    expect(compBuilder!.range).toHaveBeenCalledWith(0, 49);
  });

  it('applies the two-level !inner test-content embed (+ left-join prompt embed) when filterTestContent is on', async () => {
    let compBuilder: Record<string, jest.Mock> | undefined;
    const mock = createTableAwareMock([
      (b) => { compBuilder = b; b.then = jest.fn((r) => r({ data: [], error: null, count: 0 })); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const res = await getRecentMatchesAction({ filterTestContent: true });
    expect(res.success).toBe(true);
    expect(compBuilder!.select).toHaveBeenCalledWith(
      '*, evolution_prompts(prompt_kind), evolution_runs!inner(evolution_strategies!inner(is_test_content))',
      { count: 'exact' },
    );
    expect(compBuilder!.eq).toHaveBeenCalledWith('evolution_runs.evolution_strategies.is_test_content', false);
  });

  it('uses the inner prompt embed + prompt_kind filter when kind is set', async () => {
    let compBuilder: Record<string, jest.Mock> | undefined;
    const mock = createTableAwareMock([
      (b) => { compBuilder = b; b.then = jest.fn((r) => r({ data: [], error: null, count: 0 })); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const res = await getRecentMatchesAction({ kind: 'paragraph' });
    expect(res.success).toBe(true);
    expect(compBuilder!.select).toHaveBeenCalledWith('*, evolution_prompts!inner(prompt_kind)', { count: 'exact' });
    expect(compBuilder!.eq).toHaveBeenCalledWith('evolution_prompts.prompt_kind', 'paragraph');
  });

  it('rejects an invalid runId', async () => {
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(createTableAwareMock([]));
    const res = await getRecentMatchesAction({ runId: 'not-a-uuid' });
    expect(res.success).toBe(false);
  });
});

describe('getComparisonDetailAction', () => {
  it('joins both variants’ content and renders missing ones as null', async () => {
    const mock = createTableAwareMock([
      (b) => { b.single!.mockResolvedValueOnce({ data: compRow, error: null }); },
      // Only entry_a exists; entry_b was deleted.
      (b) => { b.then = jest.fn((r) => r({ data: [{ id: VA, variant_content: 'A text', elo_score: 1243 }], error: null })); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const res = await getComparisonDetailAction({ comparisonId: CMP });
    expect(res.success).toBe(true);
    expect(res.data!.entry_a_content).toBe('A text');
    expect(res.data!.entry_a_elo).toBe(1243);
    expect(res.data!.entry_b_content).toBeNull();
    expect(res.data!.entry_b_elo).toBeNull();
  });
});

describe('rejudgeComparisonAction', () => {
  function dbWithBothVariants() {
    const builders: Record<string, jest.Mock>[] = [];
    const mock = createTableAwareMock([
      (b) => { builders.push(b); b.single!.mockResolvedValueOnce({ data: { entry_a: VA, entry_b: VB }, error: null }); },
      (b) => { builders.push(b); b.then = jest.fn((r) => r({ data: [
        { id: VA, variant_content: 'Text A content' },
        { id: VB, variant_content: 'Text B content' },
      ], error: null })); },
    ]);
    return { mock, builders };
  }

  it('runs 2 passes via callLLM with the chosen model + temperature, writes nothing, returns passes', async () => {
    mockCallLLM.mockResolvedValue('A');
    const { mock, builders } = dbWithBothVariants();
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const res = await rejudgeComparisonAction({
      comparisonId: CMP, judgeModel: 'qwen-2.5-7b-instruct', temperature: 0.7,
    });

    expect(res.success).toBe(true);
    expect(mockCallLLM).toHaveBeenCalledTimes(2);
    const firstArgs = mockCallLLM.mock.calls[0]!;
    expect(firstArgs[3]).toBe('qwen-2.5-7b-instruct');        // model
    expect((firstArgs[9] as { temperature?: number }).temperature).toBe(0.7);
    // No write to evolution_arena_comparisons (comparisons builder is builders[0]).
    expect(builders[0]!.insert).not.toHaveBeenCalled();
    expect(builders[0]!.update).not.toHaveBeenCalled();
    expect(builders[0]!.upsert).not.toHaveBeenCalled();
    // Two passes, each carrying the exact prompt + raw response.
    expect(res.data!.passes).toHaveLength(2);
    expect(res.data!.passes[0]!.prompt).toContain('## Text A');
    expect(res.data!.passes[0]!.rawResponse).toBe('A');
    expect(res.data!.passes[1]!.direction).toBe('reverse');
  });

  it('threads a custom prompt: not verdict-only + reasoning-tolerant verdict parse', async () => {
    mockCallLLM.mockResolvedValue('Text A explains the mechanism more clearly.\nYour answer: A');
    const { mock } = dbWithBothVariants();
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const res = await rejudgeComparisonAction({
      comparisonId: CMP, judgeModel: 'qwen-2.5-7b-instruct',
      customPrompt: 'Explain why the winning text is better, then give your verdict.',
    });

    expect(res.success).toBe(true);
    const prompt = res.data!.passes[0]!.prompt;
    expect(prompt).toContain('Explain why the winning text is better');   // override threaded
    expect(prompt).not.toContain('Respond with ONLY');                    // not forced verdict-only
    // Reasoning-tolerant parser reads the trailing "Your answer: A" past the explanation.
    expect(res.data!.passes[0]!.parsedWinner).toBe('A');
  });

  it('rejects an invalid judgeModel BEFORE any callLLM call', async () => {
    const { mock } = dbWithBothVariants();
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
    const res = await rejudgeComparisonAction({ comparisonId: CMP, judgeModel: 'not-a-model' });
    expect(res.success).toBe(false);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('rejects an over-long custom prompt BEFORE any callLLM call', async () => {
    const { mock } = dbWithBothVariants();
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);
    const res = await rejudgeComparisonAction({
      comparisonId: CMP, judgeModel: 'qwen-2.5-7b-instruct', customPrompt: 'x'.repeat(5000),
    });
    expect(res.success).toBe(false);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });
});
