// Integration test for Phase 4 production-ensemble persistence + read-back against real Supabase:
// buildArenaSubmatchPersistence -> insertArenaSubmatches writes evolution_arena_submatches (+ the
// per-dimension evolution_submatch_dimension_verdicts), getComparisonDetailAction reads them back,
// and deleting the comparison CASCADEs the children. Auto-skips until the Phase-4 migration
// (20260614000004) is applied (CI deploy-migrations runs it before these tests).
// Filename is `evolution-` prefixed so it runs under test:integration:evolution.

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

jest.mock('@/lib/services/adminAuth', () => ({ requireAdmin: jest.fn().mockResolvedValue('test-admin') }));
jest.mock('@/lib/utils/supabase/server', () => ({ createSupabaseServiceClient: jest.fn() }));
jest.mock('@/lib/serverReadRequestId', () => ({ serverReadRequestId: jest.fn((fn: unknown) => fn) }));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({ withLogging: jest.fn((fn: unknown) => fn) }));
jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('next/headers', () => ({ headers: jest.fn().mockResolvedValue({ get: () => null }) }));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { getComparisonDetailAction } from '@evolution/services/arenaActions';
import { buildArenaSubmatchPersistence, insertArenaSubmatches } from '@evolution/lib/shared/arenaSubmatchPersist';
import type { EnsembleSubmatches } from '@evolution/lib/shared/computeRatings';

const ENSEMBLE: EnsembleSubmatches = {
  chainConfigId: 'cheap-escalation-v1',
  ruleId: 'first_decisive',
  ruleVersion: 1,
  matchWinner: 'A',
  members: [
    { model: 'm1', escalationStep: 0, triggeredEscalation: true, winner: 'TIE', confidence: 0.5 },
    {
      model: 'm2',
      escalationStep: 1,
      triggeredEscalation: false,
      winner: 'A',
      confidence: 1.0,
      rubricBreakdown: {
        // judge_rubric_id + criteria_id are UUID columns — use valid UUIDs (prod values are real ids).
        rubricId: '99999999-9999-4999-8999-999999999999',
        dimensions: [
          { criteriaId: '33333333-3333-4333-8333-333333333333', name: 'clarity', weight: 0.5, forwardVerdict: 'A', reverseVerdict: 'A' },
          { criteriaId: '44444444-4444-4444-8444-444444444444', name: 'depth', weight: 0.5, forwardVerdict: 'A', reverseVerdict: 'B' },
        ],
        forwardPass: { scoreA: 1, scoreB: 0, winner: 'A' },
        reversePass: { scoreA: 0.5, scoreB: 0.5, winner: 'TIE' },
        overall: { winner: 'A', confidence: 1.0 },
      },
    },
  ],
};

describe('Phase 4 arena submatch persistence (integration)', () => {
  let supabase: SupabaseClient;
  let enabled = false;
  let strategyId = '';
  let comparisonId = '';

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);
    if (!(await evolutionTablesExist(supabase))) return;
    // Probe the Phase-4 table; skip until the migration is deployed.
    const probe = await supabase.from('evolution_arena_submatches').select('id').limit(1);
    enabled = !probe.error;
    if (!enabled) return;

    strategyId = await createTestStrategyConfig(supabase);
    const promptId = await createTestPrompt(supabase);
    const run = await createTestEvolutionRun(supabase, null, { strategy_id: strategyId, prompt_id: promptId });
    const a = await createTestVariant(supabase, run.id as string, null, { prompt_id: promptId, variant_content: '[TEST] sub A' });
    const b = await createTestVariant(supabase, run.id as string, null, { prompt_id: promptId, variant_content: '[TEST] sub B' });

    const persisted = buildArenaSubmatchPersistence('00000000-0000-0000-0000-000000000000', ENSEMBLE);
    // Re-key onto a real (client-generated) comparison row so FKs resolve.
    const { data: cmp, error } = await supabase
      .from('evolution_arena_comparisons')
      .insert({
        prompt_id: promptId,
        entry_a: a.id as string,
        entry_b: b.id as string,
        winner: 'a',
        confidence: 1.0,
        run_id: run.id as string,
        chain_depth: persisted.parent.chain_depth,
        agreement: persisted.parent.agreement,
        aggregation_rule: persisted.parent.aggregation_rule,
        aggregation_rule_version: persisted.parent.aggregation_rule_version,
      })
      .select('id')
      .single();
    if (error) throw new Error(`seed comparison: ${error.message}`);
    comparisonId = cmp!.id as string;

    const rekeyed = buildArenaSubmatchPersistence(comparisonId, ENSEMBLE);
    await insertArenaSubmatches(supabase, rekeyed.submatchRows, rekeyed.dimensionRows);
  });

  afterAll(async () => {
    if (strategyId) await cleanupEvolutionData(supabase, { strategyIds: [strategyId] });
  });

  it('reads submatches + per-dimension verdicts back through getComparisonDetailAction', async () => {
    if (!enabled) {
      console.warn('evolution_arena_submatches absent — skipping (deploy migration 20260614000004)');
      return;
    }
    const res = await getComparisonDetailAction({ comparisonId });
    expect(res.success).toBe(true);
    const detail = res.data!;
    expect(detail.submatches).toHaveLength(2);
    expect(detail.submatches.map((s) => s.judge_model)).toEqual(['m1', 'm2']);
    expect(detail.submatches[0]?.triggered_escalation).toBe(true);
    expect(detail.submatches[1]?.triggered_escalation).toBe(false);
    // only the rubric submatch (m2) has dimension rows
    expect(detail.submatches[0]?.dimensions).toHaveLength(0);
    expect(detail.submatches[1]?.dimensions).toHaveLength(2);
    expect(detail.submatches[1]?.dimensions.map((d) => d.criteria_name)).toEqual(['clarity', 'depth']);
    expect(detail.submatches[1]?.dimensions[0]?.favored_match_winner).toBe(true); // clarity A == match A
    expect(detail.submatches[1]?.dimensions[1]?.favored_match_winner).toBeNull(); // depth TIE
    expect(detail.aggregation_rule).toBe('first_decisive');
  });

  it('CASCADEs submatch + dimension rows when the comparison is deleted', async () => {
    if (!enabled) return;
    await supabase.from('evolution_arena_comparisons').delete().eq('id', comparisonId);
    const subs = await supabase.from('evolution_arena_submatches').select('id').eq('arena_comparison_id', comparisonId);
    expect(subs.data ?? []).toHaveLength(0);
  });
});
