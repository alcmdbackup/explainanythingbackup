// Integration test (mocked DB): with EVOLUTION_REUSE_SEED_RATING=false, resolveContent
// returns no seedVariantRow (even when a persisted seed exists), the run uses the legacy
// fresh-baseline path, and finalize INSERTs a new variant row instead of updating the seed.

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildRunContext, type ClaimedRun } from '../setup/buildRunContext';

const SEED_ID = 'seed-uuid-fed';
const PROMPT_TEXT = 'Explain the Federal Reserve';
const SEED_CONTENT = '# Federal Reserve\n\n## Overview\n\nThe Fed is …';

function makeDb() {
  return {
    from: jest.fn((table: string) => {
      const chain: Record<string, jest.Mock> = {} as Record<string, jest.Mock>;
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn(() => chain);
      chain.insert = jest.fn(() => ({
        select: jest.fn(() => ({ single: jest.fn(async () => ({ data: { id: 'log-1' }, error: null })) })),
      }));
      chain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));
      chain.is = jest.fn(() => {
        const t: Record<string, unknown> = {};
        t.order = jest.fn(() => t);
        t.limit = jest.fn(() => t);
        t.single = jest.fn(async () => ({
          data: { id: SEED_ID, variant_content: SEED_CONTENT, mu: 18.75, sigma: 7.15, arena_match_count: 5, synced_to_arena: true },
          error: null,
        }));
        t.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve);
        return t;
      });
      chain.single = jest.fn(async () => {
        if (table === 'evolution_strategies') return { data: { config: { generationModel: 'gpt-4o', judgeModel: 'gpt-4o', iterations: 1 } }, error: null };
        if (table === 'evolution_prompts') return { data: { prompt: PROMPT_TEXT }, error: null };
        if (table === 'evolution_runs') return { data: { random_seed: '42' }, error: null };
        return { data: null, error: null };
      });
      return chain;
    }),
  } as unknown as SupabaseClient;
}

const claimedRun: ClaimedRun = {
  id: 'run-1', explanation_id: null, prompt_id: 'prompt-fed',
  experiment_id: null, strategy_id: 'strat-1', budget_cap_usd: 2.0,
};

const provider = { complete: jest.fn(async () => 'irrelevant') };

it('seed-flag-off: EVOLUTION_REUSE_SEED_RATING=false → no seedVariantRow even when seed exists', async () => {
  const prev = process.env.EVOLUTION_REUSE_SEED_RATING;
  process.env.EVOLUTION_REUSE_SEED_RATING = 'false';
  try {
    const result = await buildRunContext('run-1', claimedRun, makeDb(), provider);
    expect('context' in result).toBe(true);
    if ('context' in result) {
      // Text reuse is unaffected (cheap, deterministic).
      expect(result.context.originalText).toBe(SEED_CONTENT);
      // But seedVariantRow is omitted → runIterationLoop falls back to fresh baseline path,
      // and finalize INSERTs a new evolution_variants row instead of UPDATEing the seed.
      expect(result.context.seedVariantRow).toBeUndefined();
    }
  } finally {
    if (prev === undefined) delete process.env.EVOLUTION_REUSE_SEED_RATING;
    else process.env.EVOLUTION_REUSE_SEED_RATING = prev;
  }
});

it('seed-flag-off: flag=true (default) → seedVariantRow populated with mu/sigma/match_count + lossless string forms', async () => {
  const prev = process.env.EVOLUTION_REUSE_SEED_RATING;
  process.env.EVOLUTION_REUSE_SEED_RATING = 'true';
  try {
    const result = await buildRunContext('run-1', claimedRun, makeDb(), provider);
    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.seedVariantRow).toBeDefined();
      expect(result.context.seedVariantRow?.id).toBe(SEED_ID);
      expect(result.context.seedVariantRow?.muRaw).toBe('18.75');
      expect(result.context.seedVariantRow?.sigmaRaw).toBe('7.15');
      expect(result.context.seedVariantRow?.arena_match_count).toBe(5);
    }
  } finally {
    if (prev === undefined) delete process.env.EVOLUTION_REUSE_SEED_RATING;
    else process.env.EVOLUTION_REUSE_SEED_RATING = prev;
  }
});
