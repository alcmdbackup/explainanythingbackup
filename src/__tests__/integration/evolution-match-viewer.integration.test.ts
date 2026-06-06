// Integration tests for the Match Viewer read actions against real Supabase. Validates the
// run-id filter, the two-level !inner test-content embed, and the variant-content join — the
// parts unit mocks can't verify. Filename is `evolution-` prefixed so it runs under
// test:integration:evolution. (match_viewer_with_experimentation_procedures_20260605)

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestStrategyConfig,
  createTestPrompt,
  createTestEvolutionRun,
  createTestVariant,
} from '@evolution/testing/evolution-test-helpers';

// Infra wrappers are mocked so the adminAction-wrapped actions are callable in node; the
// Supabase client they receive is the REAL integration test client (set in beforeAll).
jest.mock('@/lib/services/adminAuth', () => ({ requireAdmin: jest.fn().mockResolvedValue('test-admin') }));
jest.mock('@/lib/utils/supabase/server', () => ({ createSupabaseServiceClient: jest.fn() }));
jest.mock('@/lib/serverReadRequestId', () => ({ serverReadRequestId: jest.fn((fn: unknown) => fn) }));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({ withLogging: jest.fn((fn: unknown) => fn) }));
jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('next/headers', () => ({ headers: jest.fn().mockResolvedValue({ get: () => null }) }));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { getRecentMatchesAction, getComparisonDetailAction } from '@evolution/services/arenaActions';

describe('Match Viewer integration', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;

  let strategyId: string;
  let promptId: string;
  let runId: string;
  let variantAId: string;
  let variantBId: string;
  const comparisonIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) return;

    strategyId = await createTestStrategyConfig(supabase);
    promptId = await createTestPrompt(supabase);
    const run = await createTestEvolutionRun(supabase, null, { strategy_id: strategyId, prompt_id: promptId });
    runId = run.id as string;
    const a = await createTestVariant(supabase, runId, null, { prompt_id: promptId, variant_content: '[TEST] match-viewer text A' });
    const b = await createTestVariant(supabase, runId, null, { prompt_id: promptId, variant_content: '[TEST] match-viewer text B' });
    variantAId = a.id as string;
    variantBId = b.id as string;

    const { data: cmp, error } = await supabase
      .from('evolution_arena_comparisons')
      .insert({ prompt_id: promptId, entry_a: variantAId, entry_b: variantBId, winner: 'a', confidence: 0.9, run_id: runId })
      .select('id')
      .single();
    if (error) throw new Error(`seed comparison: ${error.message}`);
    comparisonIds.push(cmp.id as string);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    for (const id of comparisonIds) await supabase.from('evolution_arena_comparisons').delete().eq('id', id);
    await cleanupEvolutionData(supabase, {
      runIds: [runId], strategyIds: [strategyId], promptIds: [promptId],
    });
  });

  it('returns the seeded match and isolates by run id (test content shown)', async () => {
    if (!tablesExist) return;
    const res = await getRecentMatchesAction({ runId, filterTestContent: false });
    expect(res.success).toBe(true);
    const ids = res.data!.items.map(i => i.id);
    expect(ids).toContain(comparisonIds[0]);
    expect(res.data!.items.find(i => i.id === comparisonIds[0])!.entry_a_preview).toContain('match-viewer text A');

    // A different (random) run id must not return our comparison.
    const other = await getRecentMatchesAction({ runId: '00000000-0000-4000-8000-000000000000', filterTestContent: false });
    expect(other.success).toBe(true);
    expect(other.data!.items.map(i => i.id)).not.toContain(comparisonIds[0]);
  });

  it('excludes test-strategy matches when the !inner test-content filter is on', async () => {
    if (!tablesExist) return;
    // The seeded strategy is [TEST]-prefixed → is_test_content=true → excluded by the embed.
    const res = await getRecentMatchesAction({ runId, filterTestContent: true });
    expect(res.success).toBe(true);
    expect(res.data!.items.map(i => i.id)).not.toContain(comparisonIds[0]);
  });

  it('joins both variants’ content in the detail action', async () => {
    if (!tablesExist) return;
    const res = await getComparisonDetailAction({ comparisonId: comparisonIds[0]! });
    expect(res.success).toBe(true);
    expect(res.data!.entry_a_content).toContain('match-viewer text A');
    expect(res.data!.entry_b_content).toContain('match-viewer text B');
  });
});
