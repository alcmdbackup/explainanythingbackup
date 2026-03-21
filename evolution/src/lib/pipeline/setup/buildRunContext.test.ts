// Tests for buildRunContext, loadArenaEntries, and isArenaEntry.

import { buildRunContext, loadArenaEntries, isArenaEntry, type ClaimedRun, type ArenaTextVariation } from './buildRunContext';
import type { TextVariation } from '../../types';
import type { SupabaseClient } from '@supabase/supabase-js';

const validText = `# Test Article

## Introduction

This is a generated test variant for the evolution pipeline. It demonstrates proper formatting with headings and paragraphs. The content validates correctly against format rules.

## Details

The pipeline generates variants through multiple strategies. Each variant competes in pairwise comparisons. Higher-rated variants advance through subsequent iterations.`;

function makeClaimedRun(overrides?: Partial<ClaimedRun>): ClaimedRun {
  return {
    id: 'run-1',
    explanation_id: 1,
    prompt_id: null,
    experiment_id: null,
    strategy_config_id: 'strat-1',
    budget_cap_usd: 5,
    ...overrides,
  };
}

function makeMockDb(opts?: { contentText?: string; strategyConfig?: Record<string, unknown> | null; strategyError?: boolean }) {
  const updates: Array<{ table: string; data: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; data: Record<string, unknown> }> = [];

  return {
    db: {
      from: jest.fn((table: string) => ({
        update: jest.fn((data: Record<string, unknown>) => {
          updates.push({ table, data });
          return {
            eq: jest.fn(() => ({
              in: jest.fn(async () => ({ error: null })),
            })),
          };
        }),
        insert: jest.fn((data: Record<string, unknown>) => {
          inserts.push({ table, data });
          return {
            select: jest.fn(() => ({
              single: jest.fn(async () => ({
                data: { id: `inv-${Math.random().toString(36).slice(2, 6)}` },
                error: null,
              })),
            })),
          };
        }),
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(async () => {
              if (table === 'explanations') {
                return {
                  data: opts?.contentText ? { content: opts.contentText } : null,
                  error: opts?.contentText ? null : { message: 'not found' },
                };
              }
              if (table === 'evolution_strategy_configs') {
                if (opts?.strategyError) {
                  return { data: null, error: { message: 'db error' } };
                }
                const config = opts?.strategyConfig ?? {
                  generationModel: 'gpt-4.1-nano',
                  judgeModel: 'gpt-4.1-nano',
                  iterations: 1,
                };
                return { data: { config }, error: null };
              }
              if (table === 'evolution_arena_topics') {
                return { data: { prompt: 'test prompt' }, error: null };
              }
              return { data: null, error: null };
            }),
          })),
        })),
      })),
    } as never,
    updates,
    inserts,
  };
}

function makeProvider() {
  return { complete: jest.fn(async () => validText) };
}

describe('buildRunContext', () => {
  it('resolves context for explanation-based run', async () => {
    const { db } = makeMockDb({ contentText: validText });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.originalText).toBe(validText);
      expect(result.context.config.iterations).toBe(1);
      expect(result.context.initialPool).toEqual([]);
    }
  });

  it('returns error when strategy config not found', async () => {
    const { db } = makeMockDb({ contentText: validText, strategyError: true });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Strategy');
    }
  });

  it('returns error when strategy config is invalid', async () => {
    const { db } = makeMockDb({ contentText: validText, strategyConfig: { generationModel: null } });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('invalid config');
    }
  });

  it('returns error when content not found', async () => {
    const { db } = makeMockDb({ contentText: undefined });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Explanation');
    }
  });

  it('returns error when both explanation_id and prompt_id are null', async () => {
    const { db } = makeMockDb();
    const run = makeClaimedRun({ explanation_id: null, prompt_id: null });

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('No content source');
    }
  });

  it('applies budget_cap_usd from claimed run', async () => {
    const { db } = makeMockDb({ contentText: validText });
    const run = makeClaimedRun({ budget_cap_usd: 7.5 });

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.config.budgetUsd).toBe(7.5);
    }
  });
});

// ─── Arena helpers ──────────────────────────────────────────────

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
