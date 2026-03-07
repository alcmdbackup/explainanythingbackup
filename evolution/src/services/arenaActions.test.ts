// Unit tests for Arena server actions: CRUD, OpenSkill updates, soft-delete cascading,
// and cross-topic summary aggregation.

import {
  addToArenaAction,
  generateAndAddToArenaAction,
  getArenaTopicAction,
  getArenaTopicsAction,
  getArenaEntriesAction,
  getArenaEntryDetailAction,
  getArenaLeaderboardAction,
  getArenaMatchHistoryAction,
  runArenaComparisonAction,
  runArenaComparisonInternal,
  getCrossTopicSummaryAction,
  deleteArenaEntryAction,
  deleteArenaTopicAction,
  getPromptBankCoverageAction,
  getPromptBankMethodSummaryAction,
} from './arenaActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { compareWithBiasMitigation } from '@evolution/lib/comparison';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

jest.mock('@evolution/lib/comparison', () => ({
  compareWithBiasMitigation: jest.fn(),
}));

const mockCallLLMModel = jest.fn().mockImplementation(
  async (_prompt: string, _source: string, _userId: string, _model: string,
    _streaming: boolean, _setText: null, _respObj: null, _respName: null,
    _debug: boolean, options?: { onUsage?: (u: { estimatedCostUsd: number }) => void; evolutionInvocationId?: string },
  ) => {
    if (options?.onUsage) options.onUsage({ estimatedCostUsd: 0.001 });
    return '{"title1":"Test Title"}';
  },
);
jest.mock('@/lib/services/llms', () => ({
  callLLMModel: (...args: unknown[]) => mockCallLLMModel(...args),
}));

jest.mock('@/lib/prompts', () => ({
  createTitlePrompt: jest.fn((p: string) => `title:${p}`),
  createExplanationPrompt: jest.fn((t: string) => `explain:${t}`),
}));

jest.mock('@/lib/schemas/schemas', () => {
  const actual = jest.requireActual('@/lib/schemas/schemas');
  return {
    ...actual,
    titleQuerySchema: { parse: (data: unknown) => data },
  };
});

jest.mock('@/lib/errorHandling', () => ({
  handleError: jest.fn((error: Error, context: string) => ({
    code: 'INTERNAL_ERROR',
    message: error.message,
    details: { context },
  })),
}));

// Per-table builder that creates isolated chain mocks for each .from() call
function makeBuilder() {
  const b: Record<string, jest.Mock> = {};
  const chain = () => b;
  for (const m of [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'or', 'ilike',
    'order', 'limit', 'range', 'single', 'maybeSingle',
  ]) {
    b[m] = jest.fn(chain);
  }
  return b;
}

/** Creates a mock supabase client where each .from() call gets its own builder,
 *  configured via the setups array (one per .from() call in order). */
function createTableAwareMock(
  setups: Array<(b: Record<string, jest.Mock>) => void>,
) {
  let callIdx = 0;
  return {
    from: jest.fn(() => {
      const b = makeBuilder();
      const setup = setups[callIdx];
      callIdx++;
      setup?.(b);
      return b;
    }),
  };
}

const TOPIC_UUID = '11111111-1111-1111-1111-111111111111';
const ENTRY_UUID_A = '22222222-2222-2222-2222-222222222222';
const ENTRY_UUID_B = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue('admin-user-id');
});

describe('addToArenaAction', () => {
  it('creates topic and entry when no existing topic matches', async () => {
    const eloInsertData: Record<string, unknown>[] = [];
    const mock = createTableAwareMock([
      // 1. select existing topic → not found
      (b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); },
      // 2. insert new topic
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null }); },
      // 3. evolution_arena_entries insert
      (b) => { b.single.mockResolvedValueOnce({ data: { id: ENTRY_UUID_A }, error: null }); },
      // 4. evolution_arena_elo insert
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          eloInsertData.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await addToArenaAction({
      prompt: 'Explain quantum entanglement',
      content: '# Quantum Entanglement\n\nArticle text...',
      generation_method: 'oneshot',
      model: 'gpt-4.1',
      total_cost_usd: 0.05,
    });

    expect(result.success).toBe(true);
    expect(result.data?.topic_id).toBe(TOPIC_UUID);
    expect(result.data?.entry_id).toBe(ENTRY_UUID_A);
    expect(eloInsertData.length).toBe(1);
    expect(eloInsertData[0]).toMatchObject({ mu: 25, match_count: 0 });
    expect(eloInsertData[0]).toHaveProperty('sigma');
    expect(eloInsertData[0]).toHaveProperty('ordinal');
    expect(eloInsertData[0]).toHaveProperty('elo_rating');
  });

  it('uses existing topic when prompt matches', async () => {
    const mock = createTableAwareMock([
      // 1. select existing topic → found
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null }); },
      // 2. evolution_arena_entries insert
      (b) => { b.single.mockResolvedValueOnce({ data: { id: ENTRY_UUID_A }, error: null }); },
      // 3. evolution_arena_elo insert
      (b) => { b.insert.mockResolvedValueOnce({ data: null, error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await addToArenaAction({
      prompt: 'Test prompt',
      content: 'Content',
      generation_method: 'evolution_winner',
      model: 'deepseek-chat',
    });

    expect(result.success).toBe(true);
    expect(result.data?.topic_id).toBe(TOPIC_UUID);
  });

  it('returns error when admin check fails', async () => {
    (requireAdmin as jest.Mock).mockRejectedValue(new Error('Unauthorized'));

    const result = await addToArenaAction({
      prompt: 'Test',
      content: 'Content',
      generation_method: 'oneshot',
      model: 'gpt-4.1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('getArenaTopicAction', () => {
  it('returns topic by ID', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.single.mockResolvedValueOnce({
          data: { id: TOPIC_UUID, prompt: 'Test', title: 'Title', created_at: '2026-01-01' },
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaTopicAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.prompt).toBe('Test');
  });

  it('rejects invalid UUID', async () => {
    const result = await getArenaTopicAction('not-a-uuid');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid topic ID');
  });
});

describe('getArenaEntriesAction', () => {
  it('returns entries for a topic', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, topic_id: TOPIC_UUID, generation_method: 'oneshot', model: 'gpt-4.1' },
            { id: ENTRY_UUID_B, topic_id: TOPIC_UUID, generation_method: 'evolution_winner', model: 'deepseek-chat' },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaEntriesAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(2);
  });
});

describe('getArenaEntryDetailAction', () => {
  it('returns full entry with metadata', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.single.mockResolvedValueOnce({
          data: {
            id: ENTRY_UUID_A,
            metadata: { model: 'gpt-4.1', call_source: 'oneshot_gpt-4.1' },
          },
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaEntryDetailAction(ENTRY_UUID_A);
    expect(result.success).toBe(true);
    expect(result.data?.metadata).toHaveProperty('call_source');
  });
});

describe('getArenaLeaderboardAction', () => {
  it('returns ordinal-ranked entries with method/model', async () => {
    const mock = createTableAwareMock([
      // 1. Rating rows (sorted by ordinal DESC)
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: 'elo-1', entry_id: ENTRY_UUID_A, mu: 28, sigma: 3, ordinal: 19, elo_rating: 1250, elo_per_dollar: 50, match_count: 3 },
            { id: 'elo-2', entry_id: ENTRY_UUID_B, mu: 22, sigma: 3, ordinal: 13, elo_rating: 1150, elo_per_dollar: -10, match_count: 3 },
          ],
          error: null,
        });
      },
      // 2. Entry details (no evolution_run_id → no batch lookups)
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, generation_method: 'oneshot', model: 'gpt-4.1', total_cost_usd: 0.05, created_at: '2026-01-01', evolution_run_id: null },
            { id: ENTRY_UUID_B, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.01, created_at: '2026-01-02', evolution_run_id: null },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaLeaderboardAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(2);
    expect(result.data![0].mu).toBe(28);
    expect(result.data![0].sigma).toBe(3);
    expect(result.data![0].ordinal).toBe(19);
    expect(result.data![0].elo_rating).toBe(1250);
    expect(result.data![0].display_elo).toBeDefined();
    expect(result.data![0].generation_method).toBe('oneshot');
    expect(result.data![0].run_cost_usd).toBeNull();
    expect(result.data![0].strategy_label).toBeNull();
    expect(result.data![0].experiment_name).toBeNull();
    expect(result.data![1].elo_per_dollar).toBe(-10);
  });

  it('computes ci_lower and ci_upper from mu and sigma via ordinalToEloScale', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: 'elo-1', entry_id: ENTRY_UUID_A, mu: 28, sigma: 3, ordinal: 19, elo_rating: 1250, elo_per_dollar: 50, match_count: 5 },
            { id: 'elo-2', entry_id: ENTRY_UUID_B, mu: 22, sigma: 7, ordinal: 1, elo_rating: 1016, elo_per_dollar: 10, match_count: 1 },
          ],
          error: null,
        });
      },
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, generation_method: 'oneshot', model: 'gpt-4.1', total_cost_usd: 0.05, created_at: '2026-01-01', evolution_run_id: null },
            { id: ENTRY_UUID_B, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.01, created_at: '2026-01-02', evolution_run_id: null },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaLeaderboardAction(TOPIC_UUID);
    expect(result.success).toBe(true);

    // Entry A: mu=28, sigma=3 → ci_lower = ordinalToEloScale(28-5.88) ≈ 1554, ci_upper = ordinalToEloScale(28+5.88) ≈ 1742
    const entryA = result.data![0];
    expect(entryA.ci_lower).toBeDefined();
    expect(entryA.ci_upper).toBeDefined();
    expect(entryA.ci_upper).toBeGreaterThan(entryA.ci_lower);
    // ci_upper - ci_lower should reflect 2*1.96*sigma on the Elo scale
    const ciWidthA = entryA.ci_upper - entryA.ci_lower;

    // Entry B: mu=22, sigma=7 → wider CI
    const entryB = result.data![1];
    const ciWidthB = entryB.ci_upper - entryB.ci_lower;
    // Higher sigma → wider confidence interval
    expect(ciWidthB).toBeGreaterThan(ciWidthA);
  });

  it('entries with overlapping CIs indicate statistically tied rankings', async () => {
    // Entry A: mu=25, sigma=4 → range on mu: [17.16, 32.84]
    // Entry B: mu=23, sigma=4 → range on mu: [15.16, 30.84]
    // CIs overlap → not statistically distinguishable
    const mock = createTableAwareMock([
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: 'elo-1', entry_id: ENTRY_UUID_A, mu: 25, sigma: 4, ordinal: 13, elo_rating: 1408, elo_per_dollar: 40, match_count: 3 },
            { id: 'elo-2', entry_id: ENTRY_UUID_B, mu: 23, sigma: 4, ordinal: 11, elo_rating: 1376, elo_per_dollar: 30, match_count: 3 },
          ],
          error: null,
        });
      },
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, generation_method: 'oneshot', model: 'gpt-4.1', total_cost_usd: 0.05, created_at: '2026-01-01', evolution_run_id: null },
            { id: ENTRY_UUID_B, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.01, created_at: '2026-01-02', evolution_run_id: null },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaLeaderboardAction(TOPIC_UUID);
    expect(result.success).toBe(true);

    const a = result.data![0];
    const b = result.data![1];
    // CIs should overlap: A's ci_lower < B's ci_upper AND B's ci_lower < A's ci_upper
    expect(a.ci_lower).toBeLessThan(b.ci_upper);
    expect(b.ci_lower).toBeLessThan(a.ci_upper);
  });

  it('display_elo is always inside ci_lower..ci_upper (unlike elo_rating)', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: 'elo-1', entry_id: ENTRY_UUID_A, mu: 28, sigma: 6, ordinal: 10, elo_rating: 1160, elo_per_dollar: 50, match_count: 2 },
            { id: 'elo-2', entry_id: ENTRY_UUID_B, mu: 22, sigma: 7, ordinal: 1, elo_rating: 1016, elo_per_dollar: 10, match_count: 1 },
          ],
          error: null,
        });
      },
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, generation_method: 'oneshot', model: 'gpt-4.1', total_cost_usd: 0.05, created_at: '2026-01-01', evolution_run_id: null },
            { id: ENTRY_UUID_B, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.01, created_at: '2026-01-02', evolution_run_id: null },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaLeaderboardAction(TOPIC_UUID);
    expect(result.success).toBe(true);

    for (const entry of result.data!) {
      // display_elo = ordinalToEloScale(mu) should always be inside CI
      expect(entry.display_elo).toBeGreaterThanOrEqual(entry.ci_lower);
      expect(entry.display_elo).toBeLessThanOrEqual(entry.ci_upper);
    }
  });

  it('populates run_cost_usd, strategy_label, experiment_name from batch lookups', async () => {
    const RUN_UUID = '44444444-4444-4444-4444-444444444444';
    const STRAT_UUID = '55555555-5555-5555-5555-555555555555';
    const EXP_UUID = '66666666-6666-6666-6666-666666666666';
    const mock = createTableAwareMock([
      // 1. Elo rows
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: 'elo-1', entry_id: ENTRY_UUID_A, mu: 28, sigma: 3, ordinal: 19, elo_rating: 1250, elo_per_dollar: 50, match_count: 3 },
          ],
          error: null,
        });
      },
      // 2. Entry details with evolution_run_id
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, generation_method: 'evolution_winner', model: 'gpt-4.1', total_cost_usd: 0.01, created_at: '2026-01-01', evolution_run_id: RUN_UUID },
          ],
          error: null,
        });
      },
      // 3. evolution_runs batch lookup
      (b) => {
        b.in.mockResolvedValueOnce({
          data: [
            { id: RUN_UUID, total_cost_usd: 0.42, strategy_config_id: STRAT_UUID, experiment_id: EXP_UUID },
          ],
          error: null,
        });
      },
      // 4. evolution_strategy_configs batch lookup
      (b) => {
        b.in.mockResolvedValueOnce({
          data: [{ id: STRAT_UUID, label: 'Aggressive v2' }],
          error: null,
        });
      },
      // 5. evolution_experiments batch lookup
      (b) => {
        b.in.mockResolvedValueOnce({
          data: [{ id: EXP_UUID, name: 'Model Comparison' }],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaLeaderboardAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data![0].run_cost_usd).toBe(0.42);
    expect(result.data![0].evolution_run_id).toBe(RUN_UUID);
    expect(result.data![0].strategy_label).toBe('Aggressive v2');
    expect(result.data![0].experiment_name).toBe('Model Comparison');
  });

  it('returns null run_cost_usd when no evolution_run_id', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: 'elo-1', entry_id: ENTRY_UUID_A, mu: 28, sigma: 3, ordinal: 19, elo_rating: 1250, elo_per_dollar: 50, match_count: 3 },
          ],
          error: null,
        });
      },
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, generation_method: 'oneshot', model: 'gpt-4.1', total_cost_usd: 0.05, created_at: '2026-01-01', evolution_run_id: null },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaLeaderboardAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data![0].run_cost_usd).toBeNull();
    expect(result.data![0].evolution_run_id).toBeNull();
    expect(result.data![0].strategy_label).toBeNull();
    expect(result.data![0].experiment_name).toBeNull();
  });

  it('returns empty array when no entries', async () => {
    const mock = createTableAwareMock([
      (b) => { b.order.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaLeaderboardAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe('runArenaComparisonAction', () => {
  it('runs all pairs and updates ratings via OpenSkill', async () => {
    const upsertCalls: Record<string, unknown>[] = [];
    const mock = createTableAwareMock([
      // 1. Fetch entries
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, content: 'Article A text', total_cost_usd: 0.05 },
            { id: ENTRY_UUID_B, content: 'Article B text', total_cost_usd: 0.01 },
          ],
          error: null,
        });
      },
      // 2. Fetch rating rows (mu/sigma/ordinal)
      (b) => {
        b.eq.mockResolvedValueOnce({
          data: [
            { entry_id: ENTRY_UUID_A, mu: 25, sigma: 8.333, ordinal: 0, match_count: 0 },
            { entry_id: ENTRY_UUID_B, mu: 25, sigma: 8.333, ordinal: 0, match_count: 0 },
          ],
          error: null,
        });
      },
      // 3. Insert comparison
      (b) => { b.insert.mockResolvedValueOnce({ data: null, error: null }); },
      // 4. Upsert Elo for entry A
      (b) => {
        b.upsert.mockImplementation((data: Record<string, unknown>) => {
          upsertCalls.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
      // 5. Upsert Elo for entry B
      (b) => {
        b.upsert.mockImplementation((data: Record<string, unknown>) => {
          upsertCalls.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    // A wins with full confidence
    (compareWithBiasMitigation as jest.Mock).mockResolvedValue({
      winner: 'A', confidence: 1.0, turns: 2,
    });

    const result = await runArenaComparisonAction(TOPIC_UUID, 'gpt-4.1-nano');
    expect(result.success).toBe(true);
    expect(result.data?.comparisons_run).toBe(1);
    expect(result.data?.entries_updated).toBe(2);

    // Winner (A) should have higher ordinal than loser (B)
    expect(upsertCalls.length).toBe(2);
    const rA = upsertCalls.find((c) => c.entry_id === ENTRY_UUID_A);
    const rB = upsertCalls.find((c) => c.entry_id === ENTRY_UUID_B);
    expect(rA).toBeTruthy();
    expect(rB).toBeTruthy();
    expect((rA!.ordinal as number)).toBeGreaterThan((rB!.ordinal as number));
    expect((rA!.elo_rating as number)).toBeGreaterThan((rB!.elo_rating as number));
    // Verify mu/sigma are persisted
    expect(rA).toHaveProperty('mu');
    expect(rA).toHaveProperty('sigma');
  });

  it('returns 0 comparisons when fewer than 2 entries', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [{ id: ENTRY_UUID_A, content: 'Only one', total_cost_usd: 0.05 }],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await runArenaComparisonAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.comparisons_run).toBe(0);
  });

  it('handles TIE result (no winner_id)', async () => {
    const insertCalls: Record<string, unknown>[] = [];
    const mock = createTableAwareMock([
      // Fetch entries
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, content: 'A', total_cost_usd: 0.05 },
            { id: ENTRY_UUID_B, content: 'B', total_cost_usd: 0.01 },
          ],
          error: null,
        });
      },
      // Fetch ratings (empty — will be initialized with createRating())
      (b) => { b.eq.mockResolvedValueOnce({ data: [], error: null }); },
      // Insert comparison — capture the winner_id
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          insertCalls.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
      // Upsert rating A
      (b) => { b.upsert.mockResolvedValueOnce({ data: null, error: null }); },
      // Upsert rating B
      (b) => { b.upsert.mockResolvedValueOnce({ data: null, error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    (compareWithBiasMitigation as jest.Mock).mockResolvedValue({
      winner: 'TIE', confidence: 0.5, turns: 2,
    });

    const result = await runArenaComparisonAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.comparisons_run).toBe(1);

    // TIE: winner_id should be null
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].winner_id).toBeNull();
  });
});

describe('runArenaComparisonInternal', () => {
  it('runs comparison without requireAdmin', async () => {
    const upsertCalls: Record<string, unknown>[] = [];
    const mock = createTableAwareMock([
      // 1. Fetch entries
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, content: 'Article A', total_cost_usd: 0.05 },
            { id: ENTRY_UUID_B, content: 'Article B', total_cost_usd: 0.01 },
          ],
          error: null,
        });
      },
      // 2. Fetch rating rows (mu/sigma/ordinal)
      (b) => {
        b.eq.mockResolvedValueOnce({
          data: [
            { entry_id: ENTRY_UUID_A, mu: 25, sigma: 8.333, ordinal: 0, match_count: 0 },
            { entry_id: ENTRY_UUID_B, mu: 25, sigma: 8.333, ordinal: 0, match_count: 0 },
          ],
          error: null,
        });
      },
      // 3. Insert comparison
      (b) => { b.insert.mockResolvedValueOnce({ data: null, error: null }); },
      // 4. Upsert rating A
      (b) => {
        b.upsert.mockImplementation((data: Record<string, unknown>) => {
          upsertCalls.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
      // 5. Upsert rating B
      (b) => {
        b.upsert.mockImplementation((data: Record<string, unknown>) => {
          upsertCalls.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    (compareWithBiasMitigation as jest.Mock).mockResolvedValue({
      winner: 'A', confidence: 0.8, turns: 2,
    });

    // Call internal function with explicit userId — no requireAdmin call
    const result = await runArenaComparisonInternal(TOPIC_UUID, 'system', 'gpt-4.1-nano', 1);

    expect(result.success).toBe(true);
    expect(result.data?.comparisons_run).toBe(1);
    expect(result.data?.entries_updated).toBe(2);

    // requireAdmin should NOT have been called
    expect(requireAdmin).not.toHaveBeenCalled();
  });
});

describe('getCrossTopicSummaryAction', () => {
  it('aggregates by generation method', async () => {
    const mock = createTableAwareMock([
      // Active topics query
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [{ id: TOPIC_UUID }],
          error: null,
        });
      },
      // Entries
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, topic_id: TOPIC_UUID, generation_method: 'oneshot', total_cost_usd: 0.05 },
            { id: ENTRY_UUID_B, topic_id: TOPIC_UUID, generation_method: 'evolution_winner', total_cost_usd: 0.01 },
          ],
          error: null,
        });
      },
      // Elo
      (b) => {
        b.in.mockResolvedValueOnce({
          data: [
            { entry_id: ENTRY_UUID_A, elo_rating: 1300, elo_per_dollar: 2000 },
            { entry_id: ENTRY_UUID_B, elo_rating: 1100, elo_per_dollar: -10000 },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getCrossTopicSummaryAction();
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(2);

    const oneshot = result.data!.find((s) => s.generation_method === 'oneshot');
    expect(oneshot?.avg_elo).toBe(1300);
    expect(oneshot?.win_rate).toBe(1); // oneshot wins the only topic
  });

  it('returns empty when no active topics', async () => {
    const mock = createTableAwareMock([
      (b) => { b.is.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getCrossTopicSummaryAction();
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe('deleteArenaEntryAction', () => {
  it('soft-deletes entry and hard-deletes comparisons/Elo', async () => {
    const mock = createTableAwareMock([
      // 1. Soft-delete entry
      (b) => { b.eq.mockResolvedValueOnce({ error: null }); },
      // 2. Hard-delete comparisons
      (b) => { b.or.mockResolvedValueOnce({ error: null }); },
      // 3. Hard-delete Elo
      (b) => { b.eq.mockResolvedValueOnce({ error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await deleteArenaEntryAction(ENTRY_UUID_A);
    expect(result.success).toBe(true);
    expect(result.data?.deleted).toBe(true);
    // 3 from() calls
    expect(mock.from).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid UUID', async () => {
    const result = await deleteArenaEntryAction('bad');
    expect(result.success).toBe(false);
  });
});

describe('deleteArenaTopicAction', () => {
  it('soft-deletes topic, hard-deletes comparisons/Elo, soft-deletes entries', async () => {
    const mock = createTableAwareMock([
      // 1. Soft-delete topic
      (b) => { b.eq.mockResolvedValueOnce({ error: null }); },
      // 2. Hard-delete comparisons
      (b) => { b.eq.mockResolvedValueOnce({ error: null }); },
      // 3. Hard-delete Elo
      (b) => { b.eq.mockResolvedValueOnce({ error: null }); },
      // 4. Soft-delete entries
      (b) => { b.eq.mockResolvedValueOnce({ error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await deleteArenaTopicAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.deleted).toBe(true);
    expect(mock.from).toHaveBeenCalledTimes(4);
  });
});

describe('elo_per_dollar edge cases', () => {
  it('initializes with null elo_per_dollar when cost is 0', async () => {
    const eloInsertData: Record<string, unknown>[] = [];
    const mock = createTableAwareMock([
      // 1. select existing topic → not found
      (b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); },
      // 2. insert new topic
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null }); },
      // 3. insert entry
      (b) => { b.single.mockResolvedValueOnce({ data: { id: ENTRY_UUID_A }, error: null }); },
      // 4. insert elo
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          eloInsertData.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    await addToArenaAction({
      prompt: 'Test',
      content: 'Content',
      generation_method: 'oneshot',
      model: 'gpt-4.1',
      total_cost_usd: 0,
    });

    expect(eloInsertData.length).toBe(1);
    expect(eloInsertData[0].elo_per_dollar).toBeNull();
  });

  it('initializes with null elo_per_dollar when cost is null', async () => {
    const eloInsertData: Record<string, unknown>[] = [];
    const mock = createTableAwareMock([
      // 1. select existing topic → not found
      (b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); },
      // 2. insert new topic
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null }); },
      // 3. insert entry
      (b) => { b.single.mockResolvedValueOnce({ data: { id: ENTRY_UUID_A }, error: null }); },
      // 4. insert elo
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          eloInsertData.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    await addToArenaAction({
      prompt: 'Test',
      content: 'Content',
      generation_method: 'oneshot',
      model: 'gpt-4.1',
      // total_cost_usd omitted (defaults to null)
    });

    expect(eloInsertData.length).toBe(1);
    expect(eloInsertData[0].elo_per_dollar).toBeNull();
  });
});

describe('getArenaTopicsAction', () => {
  it('returns topics with aggregated stats', async () => {
    const mock = createTableAwareMock([
      // Topics query
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: TOPIC_UUID, prompt: 'Explain AI', title: null, created_at: '2026-01-01' },
          ],
          error: null,
        });
      },
      // Entries query
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, topic_id: TOPIC_UUID, generation_method: 'oneshot', total_cost_usd: 0.05 },
            { id: ENTRY_UUID_B, topic_id: TOPIC_UUID, generation_method: 'evolution_winner', total_cost_usd: 0.01 },
          ],
          error: null,
        });
      },
      // Elo query
      (b) => {
        b.in.mockResolvedValueOnce({
          data: [
            { topic_id: TOPIC_UUID, entry_id: ENTRY_UUID_A, elo_rating: 1300 },
            { topic_id: TOPIC_UUID, entry_id: ENTRY_UUID_B, elo_rating: 1100 },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaTopicsAction();
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(1);

    const topic = result.data![0];
    expect(topic.entry_count).toBe(2);
    expect(topic.elo_min).toBe(1100);
    expect(topic.elo_max).toBe(1300);
    expect(topic.total_cost).toBeCloseTo(0.06);
    expect(topic.best_method).toBe('oneshot'); // Higher Elo
  });

  it('returns empty array when no topics', async () => {
    const mock = createTableAwareMock([
      (b) => { b.order.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaTopicsAction();
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('handles topics with no entries', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [{ id: TOPIC_UUID, prompt: 'Empty topic', title: null, created_at: '2026-01-01' }],
          error: null,
        });
      },
      (b) => { b.is.mockResolvedValueOnce({ data: [], error: null }); },
      (b) => { b.in.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaTopicsAction();
    expect(result.success).toBe(true);
    const topic = result.data![0];
    expect(topic.entry_count).toBe(0);
    expect(topic.elo_min).toBeNull();
    expect(topic.elo_max).toBeNull();
    expect(topic.best_method).toBeNull();
  });

  it('includes archived topics when includeArchived is true', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: TOPIC_UUID, prompt: 'Active topic', title: null, status: 'active', created_at: '2026-01-01' },
            { id: '44444444-4444-4444-4444-444444444444', prompt: 'Archived', title: null, status: 'archived', created_at: '2026-01-01' },
          ],
          error: null,
        });
      },
      (b) => { b.is.mockResolvedValueOnce({ data: [], error: null }); },
      (b) => { b.in.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaTopicsAction({ includeArchived: true });
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(2);

    // Verify .eq('status', 'active') was NOT called (includeArchived skips it)
    const fromCalls = mock.from.mock.results;
    const topicsBuilder = fromCalls[0].value;
    // eq should not have been called with 'status' since includeArchived is true
    const eqCalls = topicsBuilder.eq.mock.calls;
    expect(eqCalls.some((c: string[]) => c[0] === 'status')).toBe(false);
  });

  it('filters archived topics by default', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [{ id: TOPIC_UUID, prompt: 'Active', title: null, status: 'active', created_at: '2026-01-01' }],
          error: null,
        });
      },
      (b) => { b.is.mockResolvedValueOnce({ data: [], error: null }); },
      (b) => { b.in.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaTopicsAction();
    expect(result.success).toBe(true);

    // Verify .eq('status', 'active') WAS called
    const fromCalls = mock.from.mock.results;
    const topicsBuilder = fromCalls[0].value;
    const eqCalls = topicsBuilder.eq.mock.calls;
    expect(eqCalls.some((c: string[]) => c[0] === 'status' && c[1] === 'active')).toBe(true);
  });
});

describe('getArenaMatchHistoryAction', () => {
  it('returns comparisons for a topic', async () => {
    const mock = createTableAwareMock([
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            {
              id: 'comp-1',
              topic_id: TOPIC_UUID,
              entry_a_id: ENTRY_UUID_A,
              entry_b_id: ENTRY_UUID_B,
              winner_id: ENTRY_UUID_A,
              confidence: 0.85,
              judge_model: 'gpt-4.1-nano',
              dimension_scores: null,
              created_at: '2026-01-01',
            },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaMatchHistoryAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data![0].winner_id).toBe(ENTRY_UUID_A);
  });

  it('returns empty when no matches', async () => {
    const mock = createTableAwareMock([
      (b) => { b.order.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getArenaMatchHistoryAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('rejects invalid UUID', async () => {
    const result = await getArenaMatchHistoryAction('not-a-uuid');
    expect(result.success).toBe(false);
  });
});

describe('addToArenaAction — retry on unique constraint violation', () => {
  it('retries select after unique violation on insert', async () => {
    let fromCallIdx = 0;
    const mock = {
      from: jest.fn(() => {
        const b = makeBuilder();
        fromCallIdx++;
        if (fromCallIdx === 1) {
          // First select: not found
          b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
        } else if (fromCallIdx === 2) {
          // Insert fails with unique constraint (23505)
          b.single.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'unique violation' } });
        } else if (fromCallIdx === 3) {
          // Retry select: found
          b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null });
        } else if (fromCallIdx === 4) {
          // Entry insert
          b.single.mockResolvedValueOnce({ data: { id: ENTRY_UUID_A }, error: null });
        } else if (fromCallIdx === 5) {
          // Elo insert
          b.insert.mockResolvedValueOnce({ data: null, error: null });
        }
        return b;
      }),
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await addToArenaAction({
      prompt: 'Concurrent test',
      content: 'Content',
      generation_method: 'oneshot',
      model: 'gpt-4.1',
    });

    expect(result.success).toBe(true);
    expect(result.data?.topic_id).toBe(TOPIC_UUID);
    // 5 from() calls: select, insert(fail), retry select, entry insert, elo insert
    expect(mock.from).toHaveBeenCalledTimes(5);
  });
});

describe('generateAndAddToArenaAction', () => {
  it('accumulates cost from LLM calls and stores in entry', async () => {
    const entryInsertData: Record<string, unknown>[] = [];
    const eloInsertData: Record<string, unknown>[] = [];
    const mock = createTableAwareMock([
      // 1. topic select → not found
      (b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); },
      // 2. topic insert
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null }); },
      // 3. entry insert — capture data
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          entryInsertData.push(data);
          const chain = () => b;
          b.select = jest.fn(chain);
          b.single = jest.fn().mockResolvedValueOnce({ data: { id: ENTRY_UUID_A }, error: null });
          return b;
        });
      },
      // 4. elo insert — capture data
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          eloInsertData.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    // Each callLLMModel mock invokes onUsage with 0.001, two calls = 0.002
    const result = await generateAndAddToArenaAction({
      prompt: 'Test generation',
      model: 'gpt-4.1-mini',
    });

    expect(result.success).toBe(true);

    // Entry should have accumulated cost from 2 LLM calls
    expect(entryInsertData.length).toBe(1);
    expect(entryInsertData[0].total_cost_usd).toBeCloseTo(0.002);

    // Elo should use computeEloPerDollar with the cost
    expect(eloInsertData.length).toBe(1);
    expect(eloInsertData[0].elo_per_dollar).not.toBeNull();
  });
});

// ─── Prompt Bank Coverage Action ────────────────────────────────

describe('getPromptBankCoverageAction', () => {
  it('returns coverage matrix with correct structure', async () => {
    // For each of the 5 prompts, we need:
    //   1. topic select (ilike) → found
    //   2. entries select → some entries
    //   3. elo select → some elo data
    const setups: Array<(b: Record<string, jest.Mock>) => void> = [];

    for (let i = 0; i < 5; i++) {
      // topic select
      setups.push((b) => {
        b.single.mockResolvedValueOnce({ data: { id: `topic-${i}` }, error: null });
      });
      // entries select
      setups.push((b) => {
        b.single.mockImplementation(() => b); // chain
        const entries = i === 0 ? [
          { id: 'e1', generation_method: 'oneshot', model: 'gpt-4.1-mini', metadata: {} },
        ] : [];
        // Override the final promise resolution
        b.is.mockReturnValue(Promise.resolve({ data: entries, error: null }));
      });
      // elo select
      setups.push((b) => {
        b.eq.mockReturnValue(Promise.resolve({
          data: i === 0 ? [{ entry_id: 'e1', elo_rating: 1250, match_count: 3 }] : [],
          error: null,
        }));
      });
    }

    const mock = createTableAwareMock(setups);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getPromptBankCoverageAction();

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(5);
    expect(result.data![0]).toHaveProperty('prompt');
    expect(result.data![0]).toHaveProperty('difficulty');
    expect(result.data![0]).toHaveProperty('domain');
    expect(result.data![0]).toHaveProperty('methods');
  });

  it('marks missing topics with null topicId', async () => {
    const setups: Array<(b: Record<string, jest.Mock>) => void> = [];
    for (let i = 0; i < 5; i++) {
      // topic not found for all
      setups.push((b) => {
        b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
      });
    }

    const mock = createTableAwareMock(setups);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getPromptBankCoverageAction();

    expect(result.success).toBe(true);
    expect(result.data!.every((r) => r.topicId === null)).toBe(true);
    expect(result.data!.every((r) =>
      Object.values(r.methods).every((c) => !c.exists),
    )).toBe(true);
  });
});

// ─── Prompt Bank Method Summary Action ──────────────────────────

describe('getPromptBankMethodSummaryAction', () => {
  it('returns empty array when no topics exist', async () => {
    // 5 topic lookups, all not found
    const setups: Array<(b: Record<string, jest.Mock>) => void> = [];
    for (let i = 0; i < 5; i++) {
      setups.push((b) => {
        b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
      });
    }

    const mock = createTableAwareMock(setups);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getPromptBankMethodSummaryAction();

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('groups entries by method label including evolution checkpoints', async () => {
    const T0 = 'a0000000-0000-0000-0000-000000000000';
    const T1 = 'b0000000-0000-0000-0000-000000000000';
    const setups: Array<(b: Record<string, jest.Mock>) => void> = [];

    // Topic lookups: first 2 found, rest not
    setups.push((b) => { b.single.mockResolvedValueOnce({ data: { id: T0 }, error: null }); });
    setups.push((b) => { b.single.mockResolvedValueOnce({ data: { id: T1 }, error: null }); });
    for (let i = 2; i < 5; i++) {
      setups.push((b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); });
    }

    // Entries across 2 topics: oneshot + evolution with metadata.iterations
    setups.push((b) => {
      b.is.mockReturnValue(Promise.resolve({
        data: [
          { id: 'e1', topic_id: T0, generation_method: 'oneshot', model: 'gpt-4.1-mini', total_cost_usd: 0.03, metadata: {} },
          { id: 'e2', topic_id: T0, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.10, metadata: { iterations: 10 } },
          { id: 'e3', topic_id: T1, generation_method: 'oneshot', model: 'gpt-4.1-mini', total_cost_usd: 0.02, metadata: {} },
          { id: 'e4', topic_id: T1, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.08, metadata: { iterations: 3 } },
        ],
        error: null,
      }));
    });

    // Elo: all have match_count > 0
    setups.push((b) => {
      b.in.mockReturnValue(Promise.resolve({
        data: [
          { entry_id: 'e1', elo_rating: 1250, elo_per_dollar: 1666, match_count: 5 },
          { entry_id: 'e2', elo_rating: 1300, elo_per_dollar: 1000, match_count: 5 },
          { entry_id: 'e3', elo_rating: 1180, elo_per_dollar: null, match_count: 3 },
          { entry_id: 'e4', elo_rating: 1350, elo_per_dollar: 1875, match_count: 3 },
        ],
        error: null,
      }));
    });

    const mock = createTableAwareMock(setups);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getPromptBankMethodSummaryAction();
    expect(result.success).toBe(true);
    const data = result.data!;

    // 12 labels: 3 oneshot + 3 evolution checkpoints + 3 outline evolution checkpoints + 3 tree-search evolution checkpoints
    expect(data).toHaveLength(12);

    const oneshotMini = data.find((d) => d.label === 'oneshot_gpt-4.1-mini');
    const evo10 = data.find((d) => d.label === 'evolution_deepseek_10iter');
    const evo3 = data.find((d) => d.label === 'evolution_deepseek_3iter');
    const evo5 = data.find((d) => d.label === 'evolution_deepseek_5iter');

    // oneshot_gpt-4.1-mini: 2 entries, avg Elo = (1250+1180)/2 = 1215
    expect(oneshotMini!.avgElo).toBe(1215);
    expect(oneshotMini!.entryCount).toBe(2);
    expect(oneshotMini!.type).toBe('oneshot');

    // evolution_deepseek_10iter: 1 entry matched by metadata.iterations=10
    expect(evo10!.avgElo).toBe(1300);
    expect(evo10!.entryCount).toBe(1);
    expect(evo10!.type).toBe('evolution');

    // evolution_deepseek_3iter: 1 entry matched by metadata.iterations=3
    expect(evo3!.avgElo).toBe(1350);
    expect(evo3!.entryCount).toBe(1);

    // evolution_deepseek_5iter: no entries
    expect(evo5!.avgElo).toBe(0);
    expect(evo5!.entryCount).toBe(0);
  });

  it('calculates win rates across multiple topics', async () => {
    const T0 = 'a0000000-0000-0000-0000-000000000000';
    const T1 = 'b0000000-0000-0000-0000-000000000000';
    const T2 = 'c0000000-0000-0000-0000-000000000000';
    const setups: Array<(b: Record<string, jest.Mock>) => void> = [];

    // 3 topics found, 2 not
    setups.push((b) => { b.single.mockResolvedValueOnce({ data: { id: T0 }, error: null }); });
    setups.push((b) => { b.single.mockResolvedValueOnce({ data: { id: T1 }, error: null }); });
    setups.push((b) => { b.single.mockResolvedValueOnce({ data: { id: T2 }, error: null }); });
    for (let i = 3; i < 5; i++) {
      setups.push((b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); });
    }

    // Topic 0: oneshot_mini wins; Topic 1 & 2: evo_10iter wins
    setups.push((b) => {
      b.is.mockReturnValue(Promise.resolve({
        data: [
          { id: 'e1', topic_id: T0, generation_method: 'oneshot', model: 'gpt-4.1-mini', total_cost_usd: 0.03, metadata: {} },
          { id: 'e2', topic_id: T0, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.10, metadata: { iterations: 10 } },
          { id: 'e3', topic_id: T1, generation_method: 'oneshot', model: 'gpt-4.1-mini', total_cost_usd: 0.03, metadata: {} },
          { id: 'e4', topic_id: T1, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.10, metadata: { iterations: 10 } },
          { id: 'e5', topic_id: T2, generation_method: 'oneshot', model: 'gpt-4.1', total_cost_usd: 0.05, metadata: {} },
          { id: 'e6', topic_id: T2, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.10, metadata: { iterations: 10 } },
        ],
        error: null,
      }));
    });

    setups.push((b) => {
      b.in.mockReturnValue(Promise.resolve({
        data: [
          { entry_id: 'e1', elo_rating: 1300, elo_per_dollar: 3333, match_count: 5 },
          { entry_id: 'e2', elo_rating: 1250, elo_per_dollar: 500, match_count: 5 },
          { entry_id: 'e3', elo_rating: 1200, elo_per_dollar: 0, match_count: 3 },
          { entry_id: 'e4', elo_rating: 1350, elo_per_dollar: 1500, match_count: 3 },
          { entry_id: 'e5', elo_rating: 1100, elo_per_dollar: -2000, match_count: 2 },
          { entry_id: 'e6', elo_rating: 1400, elo_per_dollar: 2000, match_count: 2 },
        ],
        error: null,
      }));
    });

    const mock = createTableAwareMock(setups);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getPromptBankMethodSummaryAction();
    expect(result.success).toBe(true);
    const data = result.data!;

    const oneshotMini = data.find((d) => d.label === 'oneshot_gpt-4.1-mini');
    const evo10 = data.find((d) => d.label === 'evolution_deepseek_10iter');
    const oneshotFull = data.find((d) => d.label === 'oneshot_gpt-4.1');

    // oneshot_gpt-4.1-mini: wins topic 0 only → winCount=1, winRate=1/3
    expect(oneshotMini!.winCount).toBe(1);
    expect(oneshotMini!.winRate).toBeCloseTo(0.333, 2);

    // evolution_deepseek_10iter: wins topics 1 and 2 → winCount=2, winRate=2/3
    expect(evo10!.winCount).toBe(2);
    expect(evo10!.winRate).toBeCloseTo(0.667, 2);

    // oneshot_gpt-4.1: loses topic 2 → winCount=0
    expect(oneshotFull!.winCount).toBe(0);
    expect(oneshotFull!.winRate).toBe(0);
  });

  it('excludes entries with match_count=0 from Elo averages', async () => {
    const setups: Array<(b: Record<string, jest.Mock>) => void> = [];

    // 1 topic found, 4 not
    setups.push((b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null }); });
    for (let i = 1; i < 5; i++) {
      setups.push((b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); });
    }

    // 2 entries: one compared (match_count=4), one uncompared (match_count=0)
    setups.push((b) => {
      b.is.mockReturnValue(Promise.resolve({
        data: [
          { id: 'e1', topic_id: TOPIC_UUID, generation_method: 'oneshot', model: 'gpt-4.1-mini', total_cost_usd: 0.03, metadata: {} },
          { id: 'e2', topic_id: TOPIC_UUID, generation_method: 'oneshot', model: 'gpt-4.1', total_cost_usd: 0.05, metadata: {} },
        ],
        error: null,
      }));
    });

    setups.push((b) => {
      b.in.mockReturnValue(Promise.resolve({
        data: [
          { entry_id: 'e1', elo_rating: 1280, elo_per_dollar: 2666, match_count: 4 },
          { entry_id: 'e2', elo_rating: 1200, elo_per_dollar: 0, match_count: 0 },
        ],
        error: null,
      }));
    });

    const mock = createTableAwareMock(setups);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getPromptBankMethodSummaryAction();
    expect(result.success).toBe(true);
    const data = result.data!;

    const oneshotMini = data.find((d) => d.label === 'oneshot_gpt-4.1-mini');
    const oneshotFull = data.find((d) => d.label === 'oneshot_gpt-4.1');

    // e1: match_count=4 → included in avgElo
    expect(oneshotMini!.avgElo).toBe(1280);
    expect(oneshotMini!.entryCount).toBe(1);

    // e2: match_count=0 → excluded from avgElo, but counted via countUncomparedEntries
    expect(oneshotFull!.avgElo).toBe(0);
    expect(oneshotFull!.entryCount).toBe(1);
  });

  it('sorts results by avgElo descending', async () => {
    const T0 = 'a0000000-0000-0000-0000-000000000000';
    const setups: Array<(b: Record<string, jest.Mock>) => void> = [];

    setups.push((b) => { b.single.mockResolvedValueOnce({ data: { id: T0 }, error: null }); });
    for (let i = 1; i < 5; i++) {
      setups.push((b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); });
    }

    setups.push((b) => {
      b.is.mockReturnValue(Promise.resolve({
        data: [
          { id: 'e1', topic_id: T0, generation_method: 'oneshot', model: 'gpt-4.1-mini', total_cost_usd: 0.03, metadata: {} },
          { id: 'e2', topic_id: T0, generation_method: 'oneshot', model: 'gpt-4.1', total_cost_usd: 0.05, metadata: {} },
          { id: 'e3', topic_id: T0, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.10, metadata: { iterations: 10 } },
        ],
        error: null,
      }));
    });

    setups.push((b) => {
      b.in.mockReturnValue(Promise.resolve({
        data: [
          { entry_id: 'e1', elo_rating: 1100, elo_per_dollar: -3333, match_count: 3 },
          { entry_id: 'e2', elo_rating: 1350, elo_per_dollar: 3000, match_count: 3 },
          { entry_id: 'e3', elo_rating: 1250, elo_per_dollar: 500, match_count: 3 },
        ],
        error: null,
      }));
    });

    const mock = createTableAwareMock(setups);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getPromptBankMethodSummaryAction();
    expect(result.success).toBe(true);
    const data = result.data!;

    // Methods with entries should be sorted by avgElo descending
    const withElo = data.filter((d) => d.avgElo > 0);
    expect(withElo.length).toBe(3);
    expect(withElo[0].label).toBe('oneshot_gpt-4.1');       // 1350
    expect(withElo[1].label).toBe('evolution_deepseek_10iter'); // 1250
    expect(withElo[2].label).toBe('oneshot_gpt-4.1-mini');  // 1100
  });

  it('computes summary with correct fields', async () => {
    // 5 topic lookups: first found, rest not
    const setups: Array<(b: Record<string, jest.Mock>) => void> = [];

    // First prompt: topic found
    setups.push((b) => {
      b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null });
    });
    // Rest: not found
    for (let i = 1; i < 5; i++) {
      setups.push((b) => {
        b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
      });
    }

    // Entries fetch (for the found topics)
    setups.push((b) => {
      b.is.mockReturnValue(Promise.resolve({
        data: [
          { id: ENTRY_UUID_A, topic_id: TOPIC_UUID, generation_method: 'oneshot', model: 'gpt-4.1-mini', total_cost_usd: 0.03, metadata: {} },
        ],
        error: null,
      }));
    });

    // Elo fetch
    setups.push((b) => {
      b.in.mockReturnValue(Promise.resolve({
        data: [
          { entry_id: ENTRY_UUID_A, elo_rating: 1250, elo_per_dollar: 1666, match_count: 5 },
        ],
        error: null,
      }));
    });

    const mock = createTableAwareMock(setups);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getPromptBankMethodSummaryAction();

    expect(result.success).toBe(true);
    expect(result.data!.length).toBeGreaterThan(0);
    const firstMethod = result.data![0];
    expect(firstMethod).toHaveProperty('label');
    expect(firstMethod).toHaveProperty('type');
    expect(firstMethod).toHaveProperty('avgElo');
    expect(firstMethod).toHaveProperty('avgCostUsd');
    expect(firstMethod).toHaveProperty('winCount');
    expect(firstMethod).toHaveProperty('winRate');
    expect(firstMethod).toHaveProperty('entryCount');
  });
});
