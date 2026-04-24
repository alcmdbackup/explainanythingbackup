// Tests for getTacticPromptPerformanceAction — in particular the hitCap signal
// (Gap 9 of track_tactic_effectiveness_evolution_20260422).

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));

import { getTacticPromptPerformanceAction } from './tacticPromptActions';

// Build a chainable mock that returns the given variant rows via .limit().
function makeSupabase(variantRows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = jest.fn(() => chain);
  chain.not = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.limit = jest.fn(() => Promise.resolve({ data: variantRows, error: null }));
  return { from: jest.fn().mockReturnValue(chain) };
}

function variantRow(tactic: string, promptId: string) {
  return {
    agent_name: tactic,
    mu: 25,
    sigma: 5,
    elo_score: 1250,
    cost_usd: 0.01,
    is_winner: false,
    run_id: 'run-1',
    evolution_runs: {
      id: 'run-1',
      status: 'completed',
      prompt_id: promptId,
      evolution_prompts: { id: promptId, name: 'Test prompt' },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getTacticPromptPerformanceAction', () => {
  it('returns { items: [], hitCap: false } for empty result', async () => {
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase([]));
    const result = await getTacticPromptPerformanceAction({ tacticName: 'structural_transform' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ items: [], hitCap: false });
  });

  it('returns hitCap: false when result is below the 5000-row cap', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => variantRow('structural_transform', `prompt-${i}`));
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase(rows));
    const result = await getTacticPromptPerformanceAction({ tacticName: 'structural_transform' });
    expect(result.success).toBe(true);
    expect(result.data!.hitCap).toBe(false);
    expect(result.data!.items.length).toBeGreaterThan(0);
  });

  it('returns hitCap: true when result length equals the 5000-row cap', async () => {
    // Gap 9 signal: exactly 5000 rows → truncation suspected → banner shown.
    const rows = Array.from({ length: 5000 }, (_, i) => variantRow('structural_transform', `prompt-${i}`));
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase(rows));
    const result = await getTacticPromptPerformanceAction({ tacticName: 'structural_transform' });
    expect(result.success).toBe(true);
    expect(result.data!.hitCap).toBe(true);
  });

  it('logs a console.warn when hitCap is true', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => variantRow('structural_transform', `prompt-${i}`));
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase(rows));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await getTacticPromptPerformanceAction({ tacticName: 'structural_transform' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('hit 5000-row hard cap'),
      expect.objectContaining({ tacticName: 'structural_transform' }),
    );
    warnSpy.mockRestore();
  });

  it('does NOT log a console.warn when hitCap is false', async () => {
    const rows = [variantRow('structural_transform', 'prompt-1')];
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase(rows));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await getTacticPromptPerformanceAction({ tacticName: 'structural_transform' });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('groups by (tactic, prompt) and preserves sort-by-avgElo-desc', async () => {
    const rows = [
      // tactic A, prompt 1 — avgElo 1250
      variantRow('tacticA', 'prompt-1'),
      // tactic B, prompt 1 — avgElo 1300 (winner, higher elo)
      { ...variantRow('tacticB', 'prompt-1'), elo_score: 1300, is_winner: true },
    ];
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(makeSupabase(rows));
    const result = await getTacticPromptPerformanceAction({ promptId: 'prompt-1' });
    expect(result.success).toBe(true);
    expect(result.data!.items).toHaveLength(2);
    expect(result.data!.items[0]!.tacticName).toBe('tacticB');
    expect(result.data!.items[1]!.tacticName).toBe('tacticA');
  });
});
