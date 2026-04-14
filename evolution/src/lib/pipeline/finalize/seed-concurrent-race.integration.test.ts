// Integration test (mocked DB): simulates two concurrent runners finalizing against the
// same seed row. Runner B loaded the seed's mu/sigma but Runner A wrote first, so B's
// optimistic-concurrency UPDATE matches 0 rows and we log evolution.seed_rating.collision
// instead of silently overwriting A's update.

import type { SupabaseClient } from '@supabase/supabase-js';
import { syncToArena } from './persistRunResults';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';

const SEED_ID = 'seed-uuid-fed';
const PROMPT_ID = 'prompt-fed';

/** Build a Supabase mock whose UPDATE returns 0 rows (simulating a concurrent-runner race). */
function makeCollisionSupabase() {
  let eqDepth = 0;
  const updateChain: { eq: jest.Mock } = { eq: jest.fn() };
  updateChain.eq.mockImplementation(() => {
    eqDepth++;
    if (eqDepth === 4) {
      return Promise.resolve({ count: 0, error: null });   // 0-row update — collision
    }
    return updateChain;
  });
  return {
    rpc: jest.fn().mockResolvedValue({ error: null }),
    from: jest.fn().mockReturnValue({ update: jest.fn().mockReturnValue(updateChain) }),
  };
}

it('seed-concurrent-race: 0-row UPDATE → WARN with evolution.seed_rating.collision; no throw', async () => {
  const supabase = makeCollisionSupabase();
  const pool: Variant[] = [
    {
      id: SEED_ID, text: '# Seed', version: 0, parentIds: [], strategy: 'seed_variant',
      createdAt: 0, iterationBorn: 0, reusedFromSeed: true, arenaMatchCount: 5,
    },
    { id: 'gen-1', text: '# Gen', version: 0, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 1 },
  ];
  const ratings = new Map<string, Rating>([
    [SEED_ID, { elo: 1280, uncertainty: 100 }],
    ['gen-1', { elo: 1184, uncertainty: 128 }],
  ]);
  const matches = [
    { winnerId: SEED_ID, loserId: 'gen-1', confidence: 0.8, result: 'win' as const, judgeModel: 'm', reversed: false },
  ];

  const warns: Array<{ msg: string; ctx: Record<string, unknown> }> = [];
  const logger = {
    info: jest.fn(), debug: jest.fn(), error: jest.fn(),
    warn: jest.fn((msg: string, ctx: Record<string, unknown>) => { warns.push({ msg, ctx }); }),
  };

  await expect(syncToArena(
    'run-B', PROMPT_ID, pool, ratings, matches, supabase as unknown as SupabaseClient,
    false, logger,
    { id: SEED_ID, muRaw: '18.75', sigmaRaw: '7.15', arena_match_count: 5 },
  )).resolves.toBeUndefined();

  // Collision metric / log signal emitted; loaded snapshot included for forensics.
  const collision = warns.find((w) => w.msg.includes('evolution.seed_rating.collision'));
  expect(collision).toBeDefined();
  expect(collision?.ctx.seedId).toBe(SEED_ID);
  expect(collision?.ctx.loadedMu).toBe('18.75');
  expect(collision?.ctx.loadedSigma).toBe('7.15');
});
