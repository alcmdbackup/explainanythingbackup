// Tests for buildRunContext, loadArenaEntries, and isArenaEntry.

import { buildRunContext, loadArenaEntries, isArenaEntry, type ClaimedRun, type ArenaTextVariation } from './buildRunContext';
import type { Variant } from '../../types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getJudgeRubricForEvaluation } from '../../../services/judgeRubricActions';
import type { ResolvedJudgeRubric } from '../../shared/rubricJudge';

// structured_judging_evolution_20260610: stub the rubric resolver so the kill-switch
// tests control resolution without a live DB. Default mock returns undefined; only the
// resolution branch (judgeRubricId set + switch on) ever invokes it.
jest.mock('../../../services/judgeRubricActions', () => ({
  getJudgeRubricForEvaluation: jest.fn(),
}));
const mockGetRubric = getJudgeRubricForEvaluation as jest.MockedFunction<typeof getJudgeRubricForEvaluation>;

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
                  iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
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
      expect(result.context.config.iterationConfigs.length).toBe(2);
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

  // Task 2 (make_fixes_paragraph_recombine_20260528): the invalid-config error must
  // surface the SPECIFIC failing field (a Zod issue path), not just "invalid config".
  // Simulates the #1117 version-skew failure mode (an unknown agentType in the stored
  // config — what an older runner's enum produced for 'paragraph_recombine').
  it('surfaces the specific Zod issue (field path) in the invalid-config error', async () => {
    const { db } = makeMockDb({
      contentText: validText,
      strategyConfig: {
        generationModel: 'gpt-4.1-nano',
        judgeModel: 'gpt-4.1-nano',
        iterationConfigs: [
          { agentType: 'generate', budgetPercent: 60 },
          { agentType: 'some_unknown_agent', budgetPercent: 40 },
        ],
      },
    });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('invalid config');
      // The failing field path is named (was swallowed pre-fix).
      expect(result.error).toContain('iterationConfigs.1.agentType');
    }
  });

  it('passes generationGuidance from strategy config to EvolutionConfig', async () => {
    const guidance = [
      { tactic: 'engagement_amplify', percent: 60 },
      { tactic: 'tone_transform', percent: 40 },
    ];
    const { db } = makeMockDb({
      contentText: validText,
      strategyConfig: {
        generationModel: 'gpt-4.1-nano',
        judgeModel: 'gpt-4.1-nano',
        iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
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

  // ─── structured_judging_evolution_20260610: rubric kill switch ───
  describe('rubric judging kill switch', () => {
    const RUBRIC_ID = '11111111-1111-1111-1111-111111111111';
    const FAKE_RUBRIC: ResolvedJudgeRubric = {
      rubricId: RUBRIC_ID,
      dimensions: [{ criteriaId: 'c1', name: 'clarity', description: null, minRating: 1, maxRating: 5, evaluationGuidance: null, weight: 1 }],
    };
    const configWithRubric = {
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
      judgeRubricId: RUBRIC_ID,
    };

    beforeEach(() => { mockGetRubric.mockReset(); });

    it('resolves judgeRubric when enabled (default) and a judgeRubricId is set', async () => {
      mockGetRubric.mockResolvedValue(FAKE_RUBRIC);
      const { db } = makeMockDb({ contentText: validText, strategyConfig: configWithRubric });
      const result = await buildRunContext('run-1', makeClaimedRun(), db, makeProvider());

      expect('context' in result).toBe(true);
      if ('context' in result) {
        expect(mockGetRubric).toHaveBeenCalledWith(expect.anything(), RUBRIC_ID);
        expect(result.context.config.judgeRubric).toEqual(FAKE_RUBRIC);
        expect(result.context.config.judgeRubricId).toBe(RUBRIC_ID);
      }
    });

    it("kill switch EVOLUTION_RUBRIC_JUDGING_ENABLED='false' skips resolution → judgeRubric undefined (holistic)", async () => {
      const prev = process.env.EVOLUTION_RUBRIC_JUDGING_ENABLED;
      process.env.EVOLUTION_RUBRIC_JUDGING_ENABLED = 'false';
      try {
        mockGetRubric.mockResolvedValue(FAKE_RUBRIC);
        const { db } = makeMockDb({ contentText: validText, strategyConfig: configWithRubric });
        const result = await buildRunContext('run-1', makeClaimedRun(), db, makeProvider());

        expect('context' in result).toBe(true);
        if ('context' in result) {
          expect(mockGetRubric).not.toHaveBeenCalled();
          expect(result.context.config.judgeRubric).toBeUndefined();
          // The id pointer is still carried through; it's simply ignored while off.
          expect(result.context.config.judgeRubricId).toBe(RUBRIC_ID);
        }
      } finally {
        if (prev === undefined) delete process.env.EVOLUTION_RUBRIC_JUDGING_ENABLED;
        else process.env.EVOLUTION_RUBRIC_JUDGING_ENABLED = prev;
      }
    });

    it('a rubric that no longer resolves (null) → holistic fallback, judgeRubric undefined', async () => {
      mockGetRubric.mockResolvedValue(null);
      const { db } = makeMockDb({ contentText: validText, strategyConfig: configWithRubric });
      const result = await buildRunContext('run-1', makeClaimedRun(), db, makeProvider());

      expect('context' in result).toBe(true);
      if ('context' in result) {
        expect(mockGetRubric).toHaveBeenCalled();
        expect(result.context.config.judgeRubric).toBeUndefined();
      }
    });
  });

  describe('ensemble (escalation) kill switch — DEFAULT OFF', () => {
    const configWithEnsemble = {
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
      ensembleConfigId: 'cheap-escalation-v1',
    };

    async function runWith(envValue: string | undefined): Promise<{ ensemble: unknown; ensembleConfigId: unknown }> {
      const prev = process.env.EVOLUTION_JUDGE_ESCALATION_ENABLED;
      if (envValue === undefined) delete process.env.EVOLUTION_JUDGE_ESCALATION_ENABLED;
      else process.env.EVOLUTION_JUDGE_ESCALATION_ENABLED = envValue;
      try {
        const { db } = makeMockDb({ contentText: validText, strategyConfig: configWithEnsemble });
        const result = await buildRunContext('run-1', makeClaimedRun(), db, makeProvider());
        if (!('context' in result)) throw new Error('expected context');
        return { ensemble: result.context.config.ensemble, ensembleConfigId: result.context.config.ensembleConfigId };
      } finally {
        if (prev === undefined) delete process.env.EVOLUTION_JUDGE_ESCALATION_ENABLED;
        else process.env.EVOLUTION_JUDGE_ESCALATION_ENABLED = prev;
      }
    }

    it('unset env → ensemble undefined (single-judge ranking), id still carried', async () => {
      const { ensemble, ensembleConfigId } = await runWith(undefined);
      expect(ensemble).toBeUndefined();
      expect(ensembleConfigId).toBe('cheap-escalation-v1');
    });

    it("env='false' → ensemble undefined", async () => {
      expect((await runWith('false')).ensemble).toBeUndefined();
    });

    it("env='true' AND ensembleConfigId set → resolves the chain + rule", async () => {
      const { ensemble } = await runWith('true') as { ensemble: { chain: { id: string }; rule: { id: string } } | undefined };
      expect(ensemble).toBeDefined();
      expect(ensemble!.chain.id).toBe('cheap-escalation-v1');
      expect(ensemble!.rule.id).toBe('first_decisive');
    });
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
    tactic: 'structural_transform',
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
      tactic: 'arena_pipeline',
      fromArena: true,
    });
    expect(result.variants[1]!.tactic).toBe('arena_unknown');
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
            data: { config: { generationModel: 'gpt-4o', judgeModel: 'gpt-4o', iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }] } },
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

// ─── Phase 5 / 5a-1: seedSelection rotation tests ────────────────────────────

/** Mock DB supporting both seed-query paths:
 *  - 'highest_elo': .is().order().limit().single() → returns highest-elo seed
 *  - 'random':       .is().order() (no .limit) → returns all seeds (thenable)
 *  And the strategy config carries seedSelection so resolveContent picks the right branch. */
function makeMultiSeedDb(opts: {
  seeds: Array<{ id: string; variant_content: string; mu: number; sigma: number; arena_match_count: number; synced_to_arena: boolean }>;
  seedSelection: 'highest_elo' | 'random';
  promptText?: string;
}): SupabaseClient {
  return {
    from: jest.fn((table: string) => {
      const chain: Record<string, jest.Mock> = {} as Record<string, jest.Mock>;
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn(() => chain);
      chain.insert = jest.fn(() => ({
        select: jest.fn(() => ({ single: jest.fn(async () => ({ data: { id: 'log-1' }, error: null })) })),
      }));
      chain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null, data: null })) }));
      chain.is = jest.fn(() => {
        const t: Record<string, unknown> = {};
        t.order = jest.fn(() => t);
        t.limit = jest.fn(() => t);
        // highest_elo path terminator: .single()
        t.single = jest.fn(async () => ({
          data: opts.seeds.length > 0 ? opts.seeds[0]! : null,
          error: null,
        }));
        // random path terminator: awaiting the chain directly (thenable)
        t.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: opts.seeds, error: null }).then(resolve);
        return t;
      });
      chain.single = jest.fn(async () => {
        if (table === 'evolution_strategies') {
          return {
            data: {
              config: {
                generationModel: 'gpt-4o',
                judgeModel: 'gpt-4o',
                iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
                seedSelection: opts.seedSelection,
              },
            },
            error: null,
          };
        }
        if (table === 'evolution_prompts') return { data: { prompt: opts.promptText ?? 'test prompt' }, error: null };
        if (table === 'evolution_runs') return { data: { random_seed: null }, error: null };
        return { data: null, error: null };
      });
      return chain;
    }),
  } as unknown as SupabaseClient;
}

describe('buildRunContext — seedSelection (Phase 5 / 5a-1)', () => {
  const seedFixture = [
    { id: '11111111-1111-1111-1111-111111111111', variant_content: 'seed A', mu: 25, sigma: 7, arena_match_count: 3, synced_to_arena: true },
    { id: '22222222-2222-2222-2222-222222222222', variant_content: 'seed B', mu: 24, sigma: 7, arena_match_count: 3, synced_to_arena: true },
    { id: '33333333-3333-3333-3333-333333333333', variant_content: 'seed C', mu: 23, sigma: 7, arena_match_count: 3, synced_to_arena: true },
    { id: '44444444-4444-4444-4444-444444444444', variant_content: 'seed D', mu: 22, sigma: 7, arena_match_count: 3, synced_to_arena: true },
    { id: '55555555-5555-5555-5555-555555555555', variant_content: 'seed E', mu: 21, sigma: 7, arena_match_count: 3, synced_to_arena: true },
  ];

  it("seedSelection='random' picks a deterministic seed via SHA-256(run.id) — same run.id → same seed", async () => {
    const db = makeMultiSeedDb({ seeds: seedFixture, seedSelection: 'random' });
    const run1 = makeClaimedRun({ id: 'run-aaa', explanation_id: null, prompt_id: 'prompt-abc' });

    const r1 = await buildRunContext('run-aaa', run1, db, makeProvider());
    expect('context' in r1).toBe(true);
    if (!('context' in r1)) return;
    const first = r1.context.originalText;
    expect(first).not.toBeNull();

    // Re-run with same id → same seed (determinism contract).
    const r2 = await buildRunContext('run-aaa', run1, db, makeProvider());
    if ('context' in r2) expect(r2.context.originalText).toBe(first);
  });

  it("seedSelection='random' with a single-seed topic returns that seed (graceful degradation)", async () => {
    const db = makeMultiSeedDb({ seeds: [seedFixture[0]!], seedSelection: 'random' });
    const run = makeClaimedRun({ id: 'run-bbb', explanation_id: null, prompt_id: 'prompt-abc' });
    const r = await buildRunContext('run-bbb', run, db, makeProvider());
    expect('context' in r).toBe(true);
    if ('context' in r) expect(r.context.originalText).toBe('seed A');
  });

  it("seedSelection='random' with zero seeds falls through to CreateSeedArticleAgent", async () => {
    const db = makeMultiSeedDb({ seeds: [], seedSelection: 'random' });
    const run = makeClaimedRun({ id: 'run-ccc', explanation_id: null, prompt_id: 'prompt-abc' });
    const r = await buildRunContext('run-ccc', run, db, makeProvider());
    expect('context' in r).toBe(true);
    if ('context' in r) {
      expect(r.context.originalText).toBeNull();
      expect(r.context.seedPrompt).toBe('test prompt');
    }
  });

  it("absent seedSelection (default 'highest_elo') = pre-Phase-5 behavior byte-identical", async () => {
    // Mock without seedSelection at all — verifies default branch picks highest-elo via .single() path.
    const db = makeMultiSeedDb({ seeds: seedFixture, seedSelection: 'highest_elo' });
    const run = makeClaimedRun({ id: 'run-ddd', explanation_id: null, prompt_id: 'prompt-abc' });
    const r = await buildRunContext('run-ddd', run, db, makeProvider());
    expect('context' in r).toBe(true);
    if ('context' in r) {
      // highest_elo branch returns seedFixture[0] via the .single() mock at the chain terminator.
      expect(r.context.originalText).toBe('seed A');
    }
  });
});
