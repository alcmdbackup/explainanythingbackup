// Integration tests for experiment metrics: compute_run_variant_stats RPC and agent cost aggregation.
// Uses real Supabase with mocked auth to test DB-level computation.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestPrompt,
  evolutionTablesExist,
} from '@evolution/testing/evolution-test-helpers';
import {
  setupTestDatabase,
  teardownTestDatabase,
} from '@/testing/utils/integration-helpers';

// ─── Mocks (must be before imports) ─────────────────────────────

const MOCK_ADMIN_UUID = '00000000-0000-4000-8000-000000000001';

jest.mock('../../../instrumentation', () => ({
  createAppSpan: jest.fn(() => NOOP_SPAN),
  createLLMSpan: jest.fn(() => NOOP_SPAN),
  createDBSpan: jest.fn(() => NOOP_SPAN),
  createVectorSpan: jest.fn(() => NOOP_SPAN),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(MOCK_ADMIN_UUID),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

jest.mock('@/lib/services/auditLog', () => ({ logAdminAction: jest.fn() }));

import { SupabaseClient } from '@supabase/supabase-js';

describe('Experiment Metrics Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('Skipping experiment metrics tests: tables not yet migrated');
    }
  });

  afterAll(async () => {
    await teardownTestDatabase(supabase);
  });

  // V1 RPC dropped in V2 migration (20260315000001_evolution_v2.sql). Pending V2 rewrite.
  describe.skip('compute_run_variant_stats RPC', () => {
    it('returns correct percentile stats for known data', async () => {
      if (!tablesReady) return;

      // Create a temporary run with known elo_scores
      const runId = crypto.randomUUID();
      const explanationId = 99999; // Use a high ID unlikely to conflict

      // Insert test variants with known Elo scores
      const variants = [1200, 1300, 1350, 1400, 1500].map((elo, i) => ({
        run_id: runId,
        explanation_id: explanationId,
        variant_content: `test-variant-${i}`,
        elo_score: elo,
        generation: 0,
        agent_name: 'test',
        match_count: 5,
        is_winner: i === 4,
      }));

      const { error: insertError } = await supabase
        .from('evolution_variants')
        .insert(variants);

      if (insertError) {
        console.warn('Skipping RPC test: could not insert test variants', insertError.message);
        return;
      }

      try {
        const { data, error } = await supabase.rpc('compute_run_variant_stats', { p_run_id: runId });
        expect(error).toBeNull();

        const stats = Array.isArray(data) ? data[0] : data;
        expect(stats.total_variants).toBe(5);
        expect(stats.max_elo).toBe(1500);
        // Median of [1200, 1300, 1350, 1400, 1500] = 1350
        expect(stats.median_elo).toBe(1350);
        // p90 should be between 1400 and 1500
        expect(stats.p90_elo).toBeGreaterThanOrEqual(1400);
        expect(stats.p90_elo).toBeLessThanOrEqual(1500);
      } finally {
        // Cleanup
        await supabase.from('evolution_variants').delete().eq('run_id', runId);
      }
    });

    it('returns 0 variants for non-existent run', async () => {
      if (!tablesReady) return;

      const { data, error } = await supabase.rpc('compute_run_variant_stats', {
        p_run_id: crypto.randomUUID(),
      });
      expect(error).toBeNull();
      const stats = Array.isArray(data) ? data[0] : data;
      expect(Number(stats.total_variants)).toBe(0);
    });
  });

  describe('agent cost aggregation', () => {
    it('groups invocations by agent_name', async () => {
      if (!tablesReady) return;

      const runId = crypto.randomUUID();

      const { error: insertError } = await supabase
        .from('evolution_agent_invocations')
        .insert([
          { run_id: runId, agent_name: 'generation', cost_usd: 0.1, iteration: 1, execution_order: 0 },
          { run_id: runId, agent_name: 'generation', cost_usd: 0.2, iteration: 2, execution_order: 0 },
          { run_id: runId, agent_name: 'tournament', cost_usd: 0.5, iteration: 1, execution_order: 0 },
        ]);

      if (insertError) {
        console.warn('Skipping agent cost test: could not insert invocations', insertError.message);
        return;
      }

      try {
        const { data: invocations } = await supabase
          .from('evolution_agent_invocations')
          .select('agent_name, cost_usd')
          .eq('run_id', runId);

        const agentCosts = new Map<string, number>();
        for (const inv of invocations ?? []) {
          const cost = Number(inv.cost_usd) || 0;
          agentCosts.set(inv.agent_name, (agentCosts.get(inv.agent_name) ?? 0) + cost);
        }

        expect(agentCosts.get('generation')).toBeCloseTo(0.3);
        expect(agentCosts.get('tournament')).toBeCloseTo(0.5);
      } finally {
        await supabase.from('evolution_agent_invocations').delete().eq('run_id', runId);
      }
    });
  });

  describe('metrics_v2 JSONB storage', () => {
    // V1 test — skipped: V2 experiments have no design, factor_definitions, or analysis_results columns.
    it.skip('preserves existing analysis_results when writing metrics_v2', async () => {
      if (!tablesReady) return;

      // Check if evolution_experiments table exists
      const { data: expCheck } = await supabase
        .from('evolution_experiments')
        .select('id')
        .limit(0);
      if (expCheck === null) {
        console.warn('Skipping metrics_v2 test: evolution_experiments table not available');
        return;
      }

      const expId = crypto.randomUUID();
      const existingResults = { mainEffects: { factor1: 0.5 }, legacy_key: 'preserved' };

      const { error: insertError } = await supabase
        .from('evolution_experiments')
        .insert({
          id: expId,
          name: 'test-metrics-v2',
          status: 'completed',
          config: existingResults,
        });

      if (insertError) {
        console.warn('Skipping metrics_v2 test: could not insert experiment', insertError.message);
        return;
      }

      try {
        // Simulate read-merge-write pattern used by backfill
        const { data: existing } = await supabase
          .from('evolution_experiments')
          .select('config')
          .eq('id', expId)
          .single();

        const currentResults = (existing?.config as Record<string, unknown>) ?? {};
        const merged = { ...currentResults, metrics_v2: { runs: {}, computedAt: new Date().toISOString() } };

        const { error: updateError } = await supabase
          .from('evolution_experiments')
          .update({ config: merged })
          .eq('id', expId);

        expect(updateError).toBeNull();

        // Verify both old and new keys exist
        const { data: result } = await supabase
          .from('evolution_experiments')
          .select('config')
          .eq('id', expId)
          .single();

        const ar = result?.config as Record<string, unknown>;
        expect(ar.mainEffects).toEqual({ factor1: 0.5 });
        expect(ar.metrics_v2).toBeDefined();
      } finally {
        await supabase.from('evolution_experiments').delete().eq('id', expId);
      }
    });
  });
});
