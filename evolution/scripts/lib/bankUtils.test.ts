/**
 * @jest-environment node
 */
// Tests for bankUtils: topic upsert, entry creation, Elo initialization, and edge cases.

import { addEntryToBank } from './bankUtils';

// Per-table builder mock for Supabase client
function makeBuilder() {
  const b: Record<string, jest.Mock> = {};
  const chain = () => b;
  for (const m of ['select', 'insert', 'upsert', 'update', 'delete',
    'eq', 'ilike', 'is', 'order', 'single']) {
    b[m] = jest.fn(chain);
  }
  return b;
}

function createMockSupabase(setups: Array<(b: Record<string, jest.Mock>) => void>) {
  let callIdx = 0;
  return {
    from: jest.fn(() => {
      const b = makeBuilder();
      setups[callIdx]?.(b);
      callIdx++;
      return b;
    }),
  };
}

const TOPIC_ID = 'aaaa-bbbb-cccc-dddd';
const ENTRY_ID = 'eeee-ffff-gggg-hhhh';

describe('addEntryToBank', () => {
  it('inserts topic, entry, and Elo on success', async () => {
    const eloInserts: Record<string, unknown>[] = [];
    const supabase = createMockSupabase([
      // Topic upsert
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_ID }, error: null }); },
      // Entry insert
      (b) => { b.single.mockResolvedValueOnce({ data: { id: ENTRY_ID }, error: null }); },
      // Elo insert
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          eloInserts.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
    ]);

    const result = await addEntryToBank(supabase as unknown as import('@supabase/supabase-js').SupabaseClient, {
      prompt: 'Explain AI',
      content: '# Article\n\nContent here',
      generation_method: 'oneshot',
      model: 'gpt-4.1',
      total_cost_usd: 0.05,
    });

    expect(result.topic_id).toBe(TOPIC_ID);
    expect(result.entry_id).toBe(ENTRY_ID);
    expect(eloInserts.length).toBe(1);
    expect(eloInserts[0].elo_rating).toBe(1200);
    expect(eloInserts[0].match_count).toBe(0);
  });

  it('falls back to ilike when upsert fails', async () => {
    const supabase = createMockSupabase([
      // Topic upsert FAILS
      (b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'conflict' } }); },
      // Fallback ilike lookup
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_ID }, error: null }); },
      // Entry insert
      (b) => { b.single.mockResolvedValueOnce({ data: { id: ENTRY_ID }, error: null }); },
      // Elo insert
      (b) => { b.insert.mockResolvedValueOnce({ data: null, error: null }); },
    ]);

    const result = await addEntryToBank(supabase as unknown as import('@supabase/supabase-js').SupabaseClient, {
      prompt: 'Existing topic',
      content: 'New article',
      generation_method: 'evolution_winner',
      model: 'deepseek-chat',
    });

    expect(result.topic_id).toBe(TOPIC_ID);
    expect(result.entry_id).toBe(ENTRY_ID);
  });

  it('throws when topic cannot be found or created', async () => {
    const supabase = createMockSupabase([
      // Topic upsert FAILS
      (b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'fail' } }); },
      // Fallback ALSO fails
      (b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); },
    ]);

    await expect(
      addEntryToBank(supabase as unknown as import('@supabase/supabase-js').SupabaseClient, {
        prompt: 'Bad topic',
        content: 'Content',
        generation_method: 'oneshot',
        model: 'gpt-4.1',
      }),
    ).rejects.toThrow('Failed to upsert topic');
  });

  it('sets elo_per_dollar to null when cost is zero', async () => {
    const eloInserts: Record<string, unknown>[] = [];
    const supabase = createMockSupabase([
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_ID }, error: null }); },
      (b) => { b.single.mockResolvedValueOnce({ data: { id: ENTRY_ID }, error: null }); },
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          eloInserts.push(data);
          return Promise.resolve({ data: null, error: null });
        });
      },
    ]);

    await addEntryToBank(supabase as unknown as import('@supabase/supabase-js').SupabaseClient, {
      prompt: 'Test',
      content: 'Content',
      generation_method: 'oneshot',
      model: 'gpt-4.1',
      total_cost_usd: 0,
    });

    expect(eloInserts[0].elo_per_dollar).toBeNull();
  });

  it('passes evolution IDs through to entry insert', async () => {
    const entryInserts: Record<string, unknown>[] = [];
    const supabase = createMockSupabase([
      (b) => { b.single.mockResolvedValueOnce({ data: { id: TOPIC_ID }, error: null }); },
      (b) => {
        b.insert.mockImplementation((data: Record<string, unknown>) => {
          entryInserts.push(data);
          const mockBuilder = makeBuilder();
          mockBuilder.single.mockResolvedValueOnce({ data: { id: ENTRY_ID }, error: null });
          return mockBuilder;
        });
      },
      (b) => { b.insert.mockResolvedValueOnce({ data: null, error: null }); },
    ]);

    await addEntryToBank(supabase as unknown as import('@supabase/supabase-js').SupabaseClient, {
      prompt: 'Test',
      content: 'Winner text',
      generation_method: 'evolution_winner',
      model: 'deepseek-chat',
      evolution_run_id: 'run-123',
      evolution_variant_id: 'var-456',
      metadata: { winner: true },
    });

    expect(entryInserts[0]).toMatchObject({
      generation_method: 'evolution_winner',
      evolution_run_id: 'run-123',
      evolution_variant_id: 'var-456',
      metadata: { winner: true },
    });
  });
});
