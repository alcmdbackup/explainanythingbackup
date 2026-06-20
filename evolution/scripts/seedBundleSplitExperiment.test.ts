// Tests for the Phase 6 bundle-split A/B seed script. Exercises the strategy
// reuse-guard collision logic against a stubbed Supabase client.

import { seedStrategy } from './seedBundleSplitExperiment';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StrategyConfig } from '../src/lib/pipeline/infra/types';

// Mock the helper module so seedStrategy's upsertStrategy call is observable.
jest.mock('../src/lib/pipeline/setup/findOrCreateStrategy', () => {
  const actual = jest.requireActual('../src/lib/pipeline/setup/findOrCreateStrategy');
  return {
    ...actual,
    upsertStrategy: jest.fn(async () => 'NEWLY-CREATED-STRATEGY-ID'),
  };
});
import { upsertStrategy } from '../src/lib/pipeline/setup/findOrCreateStrategy';

const SAMPLE_CONFIG: StrategyConfig = {
  generationModel: 'google/gemini-2.5-flash-lite',
  judgeModel: 'google/gemini-2.5-flash-lite',
  iterationConfigs: [
    { agentType: 'generate', sourceMode: 'seed', budgetPercent: 34 },
    { agentType: 'iterative_editing_rewrite', budgetPercent: 66, editingProposerSoftCap: 8 },
  ],
} as unknown as StrategyConfig;

function mockDb(opts: { existingRow?: { id: string; name: string; created_at: string } | null }): SupabaseClient {
  return {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(async () => ({
            data: opts.existingRow ?? null,
            error: null,
          })),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

describe('seedStrategy (Phase 6 collision guard)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('upserts a new strategy when no config_hash collision exists', async () => {
    const db = mockDb({ existingRow: null });
    const id = await seedStrategy('AF-Ctrl', SAMPLE_CONFIG, db, /*reuseExisting*/ false);
    expect(id).toBe('NEWLY-CREATED-STRATEGY-ID');
    expect(upsertStrategy).toHaveBeenCalledTimes(1);
    expect(upsertStrategy).toHaveBeenCalledWith(db, SAMPLE_CONFIG);
  });

  it('throws when an existing strategy matches the config_hash AND --reuse-existing is NOT set', async () => {
    const db = mockDb({
      existingRow: { id: 'PRIOR-STRATEGY-ID', name: 'Strategy abc123 (lite, 3it)', created_at: '2026-06-10T00:00:00Z' },
    });
    await expect(
      seedStrategy('AF-Ctrl', SAMPLE_CONFIG, db, /*reuseExisting*/ false),
    ).rejects.toThrow(/config_hash collision/i);
    // Critical: upsertStrategy must NOT be called when the guard throws —
    // calling it would have ON CONFLICT'd into the existing row anyway, but
    // the explicit throw is what surfaces the contamination risk to the operator.
    expect(upsertStrategy).not.toHaveBeenCalled();
  });

  it('throws with the prior strategy id, name, and created_at in the error for forensic legibility', async () => {
    const db = mockDb({
      existingRow: { id: 'PRIOR-STRATEGY-ID-XYZ', name: 'Strategy abc123 (lite, 3it)', created_at: '2026-06-10T00:00:00Z' },
    });
    let caught: unknown;
    try {
      await seedStrategy('AF-Off', SAMPLE_CONFIG, db, /*reuseExisting*/ false);
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/AF-Off/);
    expect(msg).toMatch(/PRIOR-STRATEGY-ID-XYZ/);
    expect(msg).toMatch(/Strategy abc123/);
    expect(msg).toMatch(/2026-06-10/);
  });

  it('returns the existing strategy id when --reuse-existing is set', async () => {
    const db = mockDb({
      existingRow: { id: 'PRIOR-STRATEGY-ID', name: 'Strategy abc123', created_at: '2026-06-10T00:00:00Z' },
    });
    const id = await seedStrategy('AF-Ctrl', SAMPLE_CONFIG, db, /*reuseExisting*/ true);
    expect(id).toBe('PRIOR-STRATEGY-ID');
    expect(upsertStrategy).not.toHaveBeenCalled();
  });
});
