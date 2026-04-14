// Integration test (mocked DB): verifies that the second of two sequential runs against
// the same prompt reuses the seed row's UUID and writes its post-run rating updates back
// to that same row via the optimistic-concurrency UPDATE in syncToArena.

import type { SupabaseClient } from '@supabase/supabase-js';
import { syncToArena } from './persistRunResults';
import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';

const SEED_ID = 'seed-uuid-fed';
const PROMPT_ID = 'prompt-fed';
const RUN_ID = 'run-2';

function makeSupabase() {
  let eqDepth = 0;
  const updateChain: { eq: jest.Mock } = { eq: jest.fn() };
  updateChain.eq.mockImplementation(() => {
    eqDepth++;
    if (eqDepth === 4) {
      return Promise.resolve({ count: 1, error: null });
    }
    return updateChain;
  });
  const update = jest.fn().mockReturnValue(updateChain);
  return {
    rpc: jest.fn().mockResolvedValue({ error: null }),
    from: jest.fn().mockReturnValue({ update }),
    __update: update,
    __updateChain: updateChain,
  };
}

it('seed-arena-update: second run UPDATEs same seed row with new mu/sigma + accumulated arena_match_count', async () => {
  const supabase = makeSupabase();
  // Pool from the second run: includes the reused seed (with persisted arena state) +
  // two new variants generated this run.
  const pool: Variant[] = [
    {
      id: SEED_ID, text: '# Seed', version: 0, parentIds: [], strategy: 'seed_variant',
      createdAt: 0, iterationBorn: 0, reusedFromSeed: true, arenaMatchCount: 5,
    },
    { id: 'gen-1', text: '# Gen 1', version: 0, parentIds: [], strategy: 'structural_transform', createdAt: 0, iterationBorn: 1 },
    { id: 'gen-2', text: '# Gen 2', version: 0, parentIds: [], strategy: 'lexical_simplify', createdAt: 0, iterationBorn: 1 },
  ];
  const ratings = new Map<string, Rating>([
    [SEED_ID, { elo: 1305, uncertainty: 92 }],   // climbed from 1100 over this run
    ['gen-1', { elo: 1184, uncertainty: 128 }],
    ['gen-2', { elo: 1150, uncertainty: 130 }],
  ]);
  // 3 matches, all involving the seed
  const matches = [
    { winnerId: SEED_ID, loserId: 'gen-1', confidence: 0.8, result: 'win' as const, judgeModel: 'm', reversed: false },
    { winnerId: SEED_ID, loserId: 'gen-2', confidence: 0.9, result: 'win' as const, judgeModel: 'm', reversed: false },
    { winnerId: 'gen-1', loserId: SEED_ID, confidence: 0.6, result: 'win' as const, judgeModel: 'm', reversed: false },
  ];

  await syncToArena(
    RUN_ID, PROMPT_ID, pool, ratings, matches, supabase as unknown as SupabaseClient, false, undefined,
    { id: SEED_ID, muRaw: '18.75', sigmaRaw: '7.15', arena_match_count: 5 },
  );

  // RPC excludes reusedFromSeed from p_entries — no duplicate INSERT
  const rpcCall = (supabase.rpc as jest.Mock).mock.calls[0];
  const entries = rpcCall[1].p_entries as Array<{ id: string }>;
  expect(entries.some((e) => e.id === SEED_ID)).toBe(false);

  // Optimistic UPDATE landed: 4 .eq() calls (id, mu, sigma, arena_match_count)
  expect(supabase.__updateChain.eq).toHaveBeenCalledTimes(4);
  // arena_match_count accumulates: 5 (loaded) + 3 (this run) = 8
  expect(supabase.__update).toHaveBeenCalledWith(
    expect.objectContaining({ arena_match_count: 8 }),
    expect.objectContaining({ count: 'exact' }),
  );
});
