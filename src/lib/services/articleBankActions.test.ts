// Unit tests for article bank server actions: CRUD, Elo updates, soft-delete cascading,
// and cross-topic summary aggregation.

import {
  addToBankAction,
  getBankTopicAction,
  getBankTopicsAction,
  getBankEntriesAction,
  getBankEntryDetailAction,
  getBankLeaderboardAction,
  getBankMatchHistoryAction,
  runBankComparisonAction,
  getCrossTopicSummaryAction,
  deleteBankEntryAction,
  deleteBankTopicAction,
} from './articleBankActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { compareWithBiasMitigation } from '@/lib/evolution/comparison';

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

jest.mock('@/lib/evolution/comparison', () => ({
  compareWithBiasMitigation: jest.fn(),
}));

jest.mock('@/lib/services/llms', () => ({
  callLLMModel: jest.fn().mockResolvedValue('A'),
}));

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

describe('addToBankAction', () => {
  it('creates topic and entry when no existing topic matches', async () => {
    const eloInsertData: Record<string, unknown>[] = [];
    const mock = createTableAwareMock([
      // 1. select existing topic → not found
      (b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); },
      // 2. insert new topic
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null }); },
      // 3. article_bank_entries insert
      (b) => { b.single.mockResolvedValueOnce({ data: { id: ENTRY_UUID_A }, error: null }); },
      // 4. article_bank_elo insert
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          eloInsertData.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await addToBankAction({
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
    expect(eloInsertData[0]).toMatchObject({ elo_rating: 1200, match_count: 0 });
  });

  it('uses existing topic when prompt matches', async () => {
    const mock = createTableAwareMock([
      // 1. select existing topic → found
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_UUID }, error: null }); },
      // 2. article_bank_entries insert
      (b) => { b.single.mockResolvedValueOnce({ data: { id: ENTRY_UUID_A }, error: null }); },
      // 3. article_bank_elo insert
      (b) => { b.insert.mockResolvedValueOnce({ data: null, error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await addToBankAction({
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

    const result = await addToBankAction({
      prompt: 'Test',
      content: 'Content',
      generation_method: 'oneshot',
      model: 'gpt-4.1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('getBankTopicAction', () => {
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

    const result = await getBankTopicAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.prompt).toBe('Test');
  });

  it('rejects invalid UUID', async () => {
    const result = await getBankTopicAction('not-a-uuid');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid topic ID');
  });
});

describe('getBankEntriesAction', () => {
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

    const result = await getBankEntriesAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(2);
  });
});

describe('getBankEntryDetailAction', () => {
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

    const result = await getBankEntryDetailAction(ENTRY_UUID_A);
    expect(result.success).toBe(true);
    expect(result.data?.metadata).toHaveProperty('call_source');
  });
});

describe('getBankLeaderboardAction', () => {
  it('returns Elo-ranked entries with method/model', async () => {
    const mock = createTableAwareMock([
      // 1. Elo rows
      (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { id: 'elo-1', entry_id: ENTRY_UUID_A, elo_rating: 1250, elo_per_dollar: 50, match_count: 3 },
            { id: 'elo-2', entry_id: ENTRY_UUID_B, elo_rating: 1150, elo_per_dollar: -10, match_count: 3 },
          ],
          error: null,
        });
      },
      // 2. Entry details
      (b) => {
        b.is.mockResolvedValueOnce({
          data: [
            { id: ENTRY_UUID_A, generation_method: 'oneshot', model: 'gpt-4.1', total_cost_usd: 0.05, created_at: '2026-01-01' },
            { id: ENTRY_UUID_B, generation_method: 'evolution_winner', model: 'deepseek-chat', total_cost_usd: 0.01, created_at: '2026-01-02' },
          ],
          error: null,
        });
      },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getBankLeaderboardAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(2);
    expect(result.data![0].elo_rating).toBe(1250);
    expect(result.data![0].generation_method).toBe('oneshot');
    expect(result.data![1].elo_per_dollar).toBe(-10);
  });

  it('returns empty array when no entries', async () => {
    const mock = createTableAwareMock([
      (b) => { b.order.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getBankLeaderboardAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe('runBankComparisonAction', () => {
  it('runs all pairs and updates Elo', async () => {
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
      // 2. Fetch Elo rows
      (b) => {
        b.eq.mockResolvedValueOnce({
          data: [
            { entry_id: ENTRY_UUID_A, elo_rating: 1200, match_count: 0 },
            { entry_id: ENTRY_UUID_B, elo_rating: 1200, match_count: 0 },
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

    const result = await runBankComparisonAction(TOPIC_UUID, 'gpt-4.1-nano');
    expect(result.success).toBe(true);
    expect(result.data?.comparisons_run).toBe(1);
    expect(result.data?.entries_updated).toBe(2);

    // Winner (A) should have higher Elo than loser (B)
    expect(upsertCalls.length).toBe(2);
    const eloA = upsertCalls.find((c) => c.entry_id === ENTRY_UUID_A);
    const eloB = upsertCalls.find((c) => c.entry_id === ENTRY_UUID_B);
    expect(eloA).toBeTruthy();
    expect(eloB).toBeTruthy();
    expect((eloA!.elo_rating as number)).toBeGreaterThan((eloB!.elo_rating as number));
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

    const result = await runBankComparisonAction(TOPIC_UUID);
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
      // Fetch Elo (empty)
      (b) => { b.eq.mockResolvedValueOnce({ data: [], error: null }); },
      // Insert comparison — capture the winner_id
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          insertCalls.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
      // Upsert Elo A
      (b) => { b.upsert.mockResolvedValueOnce({ data: null, error: null }); },
      // Upsert Elo B
      (b) => { b.upsert.mockResolvedValueOnce({ data: null, error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    (compareWithBiasMitigation as jest.Mock).mockResolvedValue({
      winner: 'TIE', confidence: 0.5, turns: 2,
    });

    const result = await runBankComparisonAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.comparisons_run).toBe(1);

    // TIE: winner_id should be null
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].winner_id).toBeNull();
  });
});

describe('getCrossTopicSummaryAction', () => {
  it('aggregates by generation method', async () => {
    const mock = createTableAwareMock([
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

  it('returns empty when no entries', async () => {
    const mock = createTableAwareMock([
      (b) => { b.is.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getCrossTopicSummaryAction();
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe('deleteBankEntryAction', () => {
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

    const result = await deleteBankEntryAction(ENTRY_UUID_A);
    expect(result.success).toBe(true);
    expect(result.data?.deleted).toBe(true);
    // 3 from() calls
    expect(mock.from).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid UUID', async () => {
    const result = await deleteBankEntryAction('bad');
    expect(result.success).toBe(false);
  });
});

describe('deleteBankTopicAction', () => {
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

    const result = await deleteBankTopicAction(TOPIC_UUID);
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

    await addToBankAction({
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

    await addToBankAction({
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

describe('getBankTopicsAction', () => {
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

    const result = await getBankTopicsAction();
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

    const result = await getBankTopicsAction();
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

    const result = await getBankTopicsAction();
    expect(result.success).toBe(true);
    const topic = result.data![0];
    expect(topic.entry_count).toBe(0);
    expect(topic.elo_min).toBeNull();
    expect(topic.elo_max).toBeNull();
    expect(topic.best_method).toBeNull();
  });
});

describe('getBankMatchHistoryAction', () => {
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

    const result = await getBankMatchHistoryAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data?.length).toBe(1);
    expect(result.data![0].winner_id).toBe(ENTRY_UUID_A);
  });

  it('returns empty when no matches', async () => {
    const mock = createTableAwareMock([
      (b) => { b.order.mockResolvedValueOnce({ data: [], error: null }); },
    ]);
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getBankMatchHistoryAction(TOPIC_UUID);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('rejects invalid UUID', async () => {
    const result = await getBankMatchHistoryAction('not-a-uuid');
    expect(result.success).toBe(false);
  });
});
