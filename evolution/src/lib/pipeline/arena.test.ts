// Tests for V2 Arena: loadArenaEntries, syncToArena, isArenaEntry type guard.

import { loadArenaEntries, syncToArena, isArenaEntry, type ArenaTextVariation } from './arena';
import type { TextVariation } from '../types';
import type { Rating } from '../shared/rating';
import type { V2Match } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Helpers ────────────────────────────────────────────────────

function makeVariant(overrides: Partial<TextVariation> = {}): TextVariation {
  return {
    id: 'v-1',
    text: '# Test\n\n## Intro\n\nSome content here.',
    version: 1,
    parentIds: [],
    strategy: 'structural_transform',
    createdAt: Date.now() / 1000,
    iterationBorn: 1,
    ...overrides,
  };
}

function makeArenaVariant(overrides: Partial<ArenaTextVariation> = {}): ArenaTextVariation {
  return { ...makeVariant(), fromArena: true, ...overrides } as ArenaTextVariation;
}

function createMockSupabase(overrides: {
  selectResult?: { data: unknown[] | null; error: { message: string } | null };
  rpcResult?: { error: { message: string } | null };
} = {}) {
  const selectResult = overrides.selectResult ?? { data: [], error: null };
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockResolvedValue(selectResult),
  };
  return {
    from: jest.fn().mockReturnValue(chain),
    rpc: jest.fn().mockResolvedValue(overrides.rpcResult ?? { error: null }),
    _chain: chain,
  } as unknown as jest.Mocked<SupabaseClient> & { _chain: typeof chain };
}

// ─── isArenaEntry ───────────────────────────────────────────────

describe('isArenaEntry', () => {
  it('returns true for variants with fromArena=true', () => {
    expect(isArenaEntry(makeArenaVariant())).toBe(true);
  });

  it('returns false for regular variants', () => {
    expect(isArenaEntry(makeVariant())).toBe(false);
  });

  it('returns false for variants with fromArena=false', () => {
    const v = { ...makeVariant(), fromArena: false } as unknown as TextVariation;
    expect(isArenaEntry(v)).toBe(false);
  });
});

// ─── loadArenaEntries ───────────────────────────────────────────

describe('loadArenaEntries', () => {
  it('returns empty when no entries exist', async () => {
    const supabase = createMockSupabase({ selectResult: { data: [], error: null } });
    const result = await loadArenaEntries('prompt-1', supabase);

    expect(result.variants).toHaveLength(0);
    expect(result.ratings.size).toBe(0);
  });

  it('returns empty on DB error', async () => {
    const supabase = createMockSupabase({ selectResult: { data: null, error: { message: 'timeout' } } });
    const result = await loadArenaEntries('prompt-1', supabase);

    expect(result.variants).toHaveLength(0);
    expect(result.ratings.size).toBe(0);
  });

  it('converts DB rows to ArenaTextVariation with fromArena=true', async () => {
    const entries = [
      { id: 'e1', content: '# Entry 1', elo_rating: 1400, mu: 30, sigma: 6, match_count: 10, generation_method: 'pipeline' },
      { id: 'e2', content: '# Entry 2', elo_rating: 1100, mu: 20, sigma: 9, match_count: 5, generation_method: null },
    ];
    const supabase = createMockSupabase({ selectResult: { data: entries, error: null } });
    const result = await loadArenaEntries('prompt-1', supabase);

    expect(result.variants).toHaveLength(2);
    expect(result.variants[0]).toMatchObject({
      id: 'e1',
      text: '# Entry 1',
      version: 0,
      parentIds: [],
      strategy: 'arena_pipeline',
      fromArena: true,
    });
    expect(result.variants[1].strategy).toBe('arena_unknown');
  });

  it('sets up ratings from DB mu/sigma', async () => {
    const entries = [
      { id: 'e1', content: 'x', elo_rating: 1400, mu: 30, sigma: 6, match_count: 10, generation_method: 'pipeline' },
    ];
    const supabase = createMockSupabase({ selectResult: { data: entries, error: null } });
    const result = await loadArenaEntries('prompt-1', supabase);

    expect(result.ratings.get('e1')).toEqual({ mu: 30, sigma: 6 });
  });

  it('uses default mu/sigma when null in DB', async () => {
    const entries = [
      { id: 'e1', content: 'x', elo_rating: 1200, mu: null, sigma: null, match_count: 0, generation_method: null },
    ];
    const supabase = createMockSupabase({ selectResult: { data: entries, error: null } });
    const result = await loadArenaEntries('prompt-1', supabase);

    expect(result.ratings.get('e1')).toEqual({ mu: 25, sigma: 8.333 });
  });

  it('queries only non-archived entries for given topic', async () => {
    const supabase = createMockSupabase();

    await loadArenaEntries('prompt-xyz', supabase);

    expect(supabase.from).toHaveBeenCalledWith('evolution_arena_entries');
    expect(supabase._chain.eq).toHaveBeenCalledWith('topic_id', 'prompt-xyz');
    expect(supabase._chain.is).toHaveBeenCalledWith('archived_at', null);
  });
});

// ─── syncToArena ────────────────────────────────────────────────

describe('syncToArena', () => {
  it('calls sync_to_arena RPC with correct params', async () => {
    const supabase = createMockSupabase();
    const pool: TextVariation[] = [makeVariant({ id: 'v1', text: '# New' })];
    const ratings = new Map<string, Rating>([['v1', { mu: 28, sigma: 7 }]]);
    const matches: V2Match[] = [
      { winnerId: 'v1', loserId: 'v2', result: 'win' as const, confidence: 0.8, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena('run-1', 'prompt-1', pool, ratings, matches, supabase);

    expect(supabase.rpc).toHaveBeenCalledWith('sync_to_arena', expect.objectContaining({
      p_topic_id: 'prompt-1',
      p_run_id: 'run-1',
    }));
  });

  it('excludes arena entries from new entries (only syncs pipeline variants)', async () => {
    const supabase = createMockSupabase();
    const pool: TextVariation[] = [
      makeVariant({ id: 'v-new', text: '# New' }),
      makeArenaVariant({ id: 'v-arena', text: '# Arena' }),
    ];
    const ratings = new Map<string, Rating>([
      ['v-new', { mu: 25, sigma: 8 }],
      ['v-arena', { mu: 30, sigma: 6 }],
    ]);

    await syncToArena('run-1', 'p1', pool, ratings, [], supabase);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    const entries = call[1].p_entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('v-new');
  });

  it('maps draw matches correctly', async () => {
    const supabase = createMockSupabase();
    const matches: V2Match[] = [
      { winnerId: 'a', loserId: 'b', result: 'draw' as const, confidence: 0.5, judgeModel: 'gpt-4.1-nano', reversed: false },
    ];

    await syncToArena('run-1', 'p1', [], new Map(), matches, supabase);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    expect(call[1].p_matches[0].winner).toBe('draw');
  });

  it('uses default rating when variant has no rating', async () => {
    const supabase = createMockSupabase();
    const pool = [makeVariant({ id: 'v-no-rating' })];

    await syncToArena('run-1', 'p1', pool, new Map(), [], supabase);

    const call = (supabase.rpc as jest.Mock).mock.calls[0];
    expect(call[1].p_entries[0].elo_rating).toBe(1200);
    expect(call[1].p_entries[0].mu).toBe(25);
    expect(call[1].p_entries[0].sigma).toBe(8.333);
  });

  it('logs warning on RPC error without throwing', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const supabase = createMockSupabase({ rpcResult: { error: { message: 'RPC failed' } } });

    await syncToArena('run-1', 'p1', [], new Map(), [], supabase);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('sync_to_arena error'));
    consoleSpy.mockRestore();
  });
});
