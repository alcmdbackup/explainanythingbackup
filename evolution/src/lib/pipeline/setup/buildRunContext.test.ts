// Tests for buildRunContext, loadArenaEntries, and isArenaEntry.

import { buildRunContext, loadArenaEntries, isArenaEntry, type ClaimedRun, type ArenaTextVariation } from './buildRunContext';
import type { Variant } from '../../types';
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
    strategy_id: 'strat-1',
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
          const invId = `inv-${String(inserts.length).padStart(6, '0')}`;
          return {
            select: jest.fn(() => ({
              single: jest.fn(async () => ({
                data: { id: invId },
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
              if (table === 'evolution_strategies') {
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
              if (table === 'evolution_prompts') {
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

  it('passes generationGuidance from strategy config to EvolutionConfig', async () => {
    const guidance = [
      { strategy: 'engagement_amplify', percent: 60 },
      { strategy: 'tone_transform', percent: 40 },
    ];
    const { db } = makeMockDb({
      contentText: validText,
      strategyConfig: {
        generationModel: 'gpt-4.1-nano',
        judgeModel: 'gpt-4.1-nano',
        iterations: 1,
        generationGuidance: guidance,
      },
    });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.config.generationGuidance).toEqual(guidance);
    }
  });

  it('omits generationGuidance from config when strategy has none', async () => {
    const { db } = makeMockDb({ contentText: validText });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.config.generationGuidance).toBeUndefined();
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

  it('generated random_seed always fits in PostgreSQL signed BIGINT range', async () => {
    // Regression: prior implementation built (high<<32 | low) with both halves up to
    // 0xffffffff, which produced unsigned 64-bit values up to 2^64 - 1. PostgreSQL BIGINT
    // is signed (max 2^63 - 1 ≈ 9.22e18), so writes failed with "out of range for type bigint".
    // Run the generator many times to catch any path that could exceed the bound.
    const MAX_BIGINT = BigInt('9223372036854775807');
    for (let i = 0; i < 1000; i++) {
      const { db } = makeMockDb({ contentText: validText });
      const run = makeClaimedRun();
      const result = await buildRunContext('run-1', run, db, makeProvider());
      if ('context' in result) {
        expect(result.context.randomSeed).toBeGreaterThanOrEqual(BigInt(0));
        expect(result.context.randomSeed).toBeLessThanOrEqual(MAX_BIGINT);
      }
    }
  });
});

// ─── Arena helpers ──────────────────────────────────────────────

function makeVariant(overrides: Partial<Variant> = {}): Variant {
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
    const v = { ...makeVariant(), fromArena: false } as unknown as Variant;
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
      { id: 'e1', variant_content: '# Entry 1', elo_score: 1400, mu: 30, sigma: 6, arena_match_count: 10, generation_method: 'pipeline' },
      { id: 'e2', variant_content: '# Entry 2', elo_score: 1100, mu: 20, sigma: 9, arena_match_count: 5, generation_method: null },
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
    expect(result.variants[1]!.strategy).toBe('arena_unknown');
  });

  it('sets up ratings from DB mu/sigma', async () => {
    const entries = [
      { id: 'e1', variant_content: 'x', elo_score: 1400, mu: 30, sigma: 6, arena_match_count: 10, generation_method: 'pipeline' },
    ];
    const supabase = createMockSupabase({ selectResult: { data: entries, error: null } });
    const result = await loadArenaEntries('prompt-1', supabase);

    // mu=30 → elo=1200+(30-25)*16=1280; sigma=6 → uncertainty=6*16=96
    expect(result.ratings.get('e1')).toEqual({ elo: 1280, uncertainty: 96 });
  });

  it('uses default mu/sigma when null in DB', async () => {
    const entries = [
      { id: 'e1', variant_content: 'x', elo_score: 1200, mu: null, sigma: null, arena_match_count: 0, generation_method: null },
    ];
    const supabase = createMockSupabase({ selectResult: { data: entries, error: null } });
    const result = await loadArenaEntries('prompt-1', supabase);

    // mu=25 (default) → elo=1200; sigma=25/3 (default) → uncertainty=400/3
    expect(result.ratings.get('e1')).toEqual({ elo: 1200, uncertainty: 400 / 3 });
  });

  it('queries only non-archived entries for given topic', async () => {
    const supabase = createMockSupabase();

    await loadArenaEntries('prompt-xyz', supabase);

    expect(supabase.from).toHaveBeenCalledWith('evolution_variants');
    expect(supabase._chain.eq).toHaveBeenCalledWith('prompt_id', 'prompt-xyz');
    expect(supabase._chain.eq).toHaveBeenCalledWith('synced_to_arena', true);
    expect(supabase._chain.is).toHaveBeenCalledWith('archived_at', null);
  });
});

// ─── buildRunContext seed-reuse behavior ────────────────────────────────────────

/**
 * Mock DB that handles the dual evolution_variants usage:
 * 1. Seed query: .select().eq().eq().eq().is().order().limit().single() — return seedEntry
 * 2. loadArenaEntries: .select().eq().eq().is()  (awaited at .is()) — return []
 */
function makeSeedAwareDb(opts: {
  seedEntry?: { variant_content: string; id?: string; mu?: number; sigma?: number; arena_match_count?: number; synced_to_arena?: boolean } | null;
  promptText?: string;
}): SupabaseClient {
  // Default the new fields so existing test cases continue to satisfy resolveContent's
  // synced_to_arena invariant. Tests that want to assert seed-row-row reuse can override.
  const enrichedSeed = opts.seedEntry ? {
    id: 'seed-id',
    mu: 25,
    sigma: 8.333,
    arena_match_count: 0,
    synced_to_arena: true,
    ...opts.seedEntry,
  } : opts.seedEntry;
  opts = { ...opts, seedEntry: enrichedSeed };
  return {
    from: jest.fn((table: string) => {
      const chain: Record<string, jest.Mock> = {} as Record<string, jest.Mock>;

      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn(() => chain);
      chain.insert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(async () => ({ data: { id: 'log-1' }, error: null })),
        })),
      }));
      chain.update = jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null, data: null })),
      }));

      // .is() returns a thenable-chain so:
      //   - seed query can continue: .is().order().limit().single()
      //   - loadArenaEntries awaits .is() directly
      chain.is = jest.fn(() => {
        const thenableChain: Record<string, unknown> = {};
        thenableChain.order = jest.fn(() => thenableChain);
        thenableChain.limit = jest.fn(() => thenableChain);
        // Called at end of seed query chain
        thenableChain.single = jest.fn(async () => ({
          data: opts.seedEntry ?? null,
          error: null,
        }));
        // Called when loadArenaEntries awaits .is() directly
        thenableChain.then = (
          resolve: (v: { data: unknown[]; error: null }) => unknown,
          _reject?: unknown,
        ) => Promise.resolve({ data: [], error: null }).then(resolve);
        return thenableChain;
      });

      // .single() for non-variants tables
      chain.single = jest.fn(async () => {
        if (table === 'evolution_strategies') {
          return {
            data: { config: { generationModel: 'gpt-4o', judgeModel: 'gpt-4o', iterations: 1 } },
            error: null,
          };
        }
        if (table === 'evolution_prompts') {
          return { data: { prompt: opts.promptText ?? 'test prompt text' }, error: null };
        }
        if (table === 'evolution_runs') {
          return { data: { random_seed: null }, error: null };
        }
        return { data: null, error: null };
      });

      return chain;
    }),
  } as unknown as SupabaseClient;
}

const promptRun = makeClaimedRun({ explanation_id: null, prompt_id: 'prompt-abc' });

describe('buildRunContext — seed reuse', () => {
  it('explanation-based run: returns originalText from DB, no seedPrompt', async () => {
    const db = makeMockDb({ contentText: validText });
    const result = await buildRunContext('run-1', makeClaimedRun(), db.db, makeProvider());
    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.originalText).toBe(validText);
      expect(result.context.seedPrompt).toBeUndefined();
    }
  });

  it('prompt-based run, arena has seed: returns originalText=seedContent, no seedPrompt', async () => {
    const seedContent = '# Seed Article\n\n## Intro\n\nSeed text.';
    const db = makeSeedAwareDb({ seedEntry: { variant_content: seedContent } });
    const result = await buildRunContext('run-1', promptRun, db, makeProvider());
    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.originalText).toBe(seedContent);
      expect(result.context.seedPrompt).toBeUndefined();
    }
  });

  it('prompt-based run, no arena seed: originalText=null, seedPrompt=promptText', async () => {
    const db = makeSeedAwareDb({ seedEntry: null, promptText: 'Explain neural networks' });
    const result = await buildRunContext('run-1', promptRun, db, makeProvider());
    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.originalText).toBeNull();
      expect(result.context.seedPrompt).toBe('Explain neural networks');
    }
  });

  it('seed query uses order(elo_score DESC) and limit(1)', async () => {
    const db = makeSeedAwareDb({ seedEntry: null });
    const fromSpy = db.from as jest.Mock;
    await buildRunContext('run-1', promptRun, db, makeProvider());

    // Verify at least one call to evolution_variants was made
    const tables = (fromSpy.mock.calls as Array<[string]>).map(([t]) => t);
    expect(tables).toContain('evolution_variants');

    // For each evolution_variants call, check if the thenableChain had .order() called
    type ChainResult = { is: { mock: { results: Array<{ value: { order: { mock: { calls: unknown[] } }; limit: { mock: { calls: unknown[] } } } }> } } };
    const variantChains = (fromSpy.mock.results as Array<{ value: ChainResult }>)
      .filter((_r, i) => (fromSpy.mock.calls as Array<[string]>)[i]?.[0] === 'evolution_variants')
      .map((r) => r.value);

    const orderWasCalled = variantChains.some((chain) =>
      chain.is.mock.results.some((r) => r.value?.order?.mock?.calls?.length > 0)
    );
    expect(orderWasCalled).toBe(true);
  });

  it('prompt-based run, archived seed is excluded (returns seedPrompt)', async () => {
    // The query uses .is('archived_at', null) so archived entries are excluded.
    // Simulate by returning null (no unarchived seed found).
    const db = makeSeedAwareDb({ seedEntry: null });
    const result = await buildRunContext('run-1', promptRun, db, makeProvider());
    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.originalText).toBeNull();
      expect(result.context.seedPrompt).toBeDefined();
    }
  });

  // ─── 2026-04-14: seedVariantRow load + EVOLUTION_REUSE_SEED_RATING gate ───

  it('seed exists + EVOLUTION_REUSE_SEED_RATING=true: returns seedVariantRow with mu/sigma/match_count', async () => {
    const prevFlag = process.env.EVOLUTION_REUSE_SEED_RATING;
    process.env.EVOLUTION_REUSE_SEED_RATING = 'true';
    try {
      const db = makeSeedAwareDb({ seedEntry: {
        id: 'seed-uuid-1', variant_content: '# Seed', mu: 18.75, sigma: 7.15, arena_match_count: 5, synced_to_arena: true,
      } });
      const result = await buildRunContext('run-1', promptRun, db, makeProvider());
      expect('context' in result).toBe(true);
      if ('context' in result) {
        expect(result.context.seedVariantRow).toBeDefined();
        expect(result.context.seedVariantRow?.id).toBe('seed-uuid-1');
        expect(result.context.seedVariantRow?.mu).toBeCloseTo(18.75);
        expect(result.context.seedVariantRow?.sigma).toBeCloseTo(7.15);
        expect(result.context.seedVariantRow?.arena_match_count).toBe(5);
        // Lossless string form preserved for optimistic-concurrency UPDATE.
        expect(result.context.seedVariantRow?.muRaw).toBe('18.75');
        expect(result.context.seedVariantRow?.sigmaRaw).toBe('7.15');
      }
    } finally {
      if (prevFlag === undefined) delete process.env.EVOLUTION_REUSE_SEED_RATING;
      else process.env.EVOLUTION_REUSE_SEED_RATING = prevFlag;
    }
  });

  it('seed exists + EVOLUTION_REUSE_SEED_RATING=false: seedVariantRow is undefined (fallback)', async () => {
    const prevFlag = process.env.EVOLUTION_REUSE_SEED_RATING;
    process.env.EVOLUTION_REUSE_SEED_RATING = 'false';
    try {
      const db = makeSeedAwareDb({ seedEntry: {
        id: 'seed-uuid-1', variant_content: '# Seed', mu: 18.75, sigma: 7.15, arena_match_count: 5, synced_to_arena: true,
      } });
      const result = await buildRunContext('run-1', promptRun, db, makeProvider());
      expect('context' in result).toBe(true);
      if ('context' in result) {
        // originalText still resolved (text reuse is independent of rating reuse)
        expect(result.context.originalText).toBe('# Seed');
        // But seedVariantRow is omitted → runIterationLoop falls through to fresh-baseline path
        expect(result.context.seedVariantRow).toBeUndefined();
      }
    } finally {
      if (prevFlag === undefined) delete process.env.EVOLUTION_REUSE_SEED_RATING;
      else process.env.EVOLUTION_REUSE_SEED_RATING = prevFlag;
    }
  });
});
