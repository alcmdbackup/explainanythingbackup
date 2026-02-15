// Integration tests for evolution infrastructure: concurrency, heartbeat, split-brain, feature flags.
// Uses real Supabase for all DB operations — no server action mocking needed.
// Auto-skips when evolution DB tables are not yet migrated.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestEvolutionRun,
  evolutionTablesExist,
} from '@/testing/utils/evolution-test-helpers';
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestData,
} from '@/testing/utils/integration-helpers';

// Only mock instrumentation (these tests hit the DB directly, no server actions)
jest.mock('../../../instrumentation', () => ({
  createAppSpan: jest.fn(() => NOOP_SPAN),
  createLLMSpan: jest.fn(() => NOOP_SPAN),
  createDBSpan: jest.fn(() => NOOP_SPAN),
  createVectorSpan: jest.fn(() => NOOP_SPAN),
}));

import { SupabaseClient } from '@supabase/supabase-js';
import {
  getFeatureFlags,
  DEFAULT_EVOLUTION_FLAGS,
} from '@/lib/evolution/core/featureFlags';

describe('Evolution Infrastructure Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testExplanationId: number;
  const trackedExplanationIds: number[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping evolution infrastructure tests: tables not yet migrated');
    }
  });

  afterAll(async () => {
    if (tablesReady) {
      await cleanupEvolutionData(supabase, trackedExplanationIds);
    }
    await teardownTestDatabase(supabase);
  });

  beforeEach(async () => {
    if (!tablesReady) return;
    const seed = await seedTestData(supabase);
    testExplanationId = seed.explanationId;
    trackedExplanationIds.push(testExplanationId);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (!tablesReady) return;
    await cleanupEvolutionData(supabase, [testExplanationId]);
  });

  // ─── Concurrent claims ────────────────────────────────────────

  describe('Concurrent claims', () => {
    it('two runners claim different runs', async () => {
      if (!tablesReady) return;

      const run1 = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'pending',
      });
      const run2 = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'pending',
      });

      const { data: claim1 } = await supabase
        .from('content_evolution_runs')
        .update({ status: 'claimed', runner_id: 'runner-A' })
        .eq('id', run1.id)
        .eq('status', 'pending')
        .select('id, status')
        .single();

      const { data: claim2 } = await supabase
        .from('content_evolution_runs')
        .update({ status: 'claimed', runner_id: 'runner-B' })
        .eq('id', run2.id)
        .eq('status', 'pending')
        .select('id, status')
        .single();

      expect(claim1).toBeTruthy();
      expect(claim1!.status).toBe('claimed');
      expect(claim2).toBeTruthy();
      expect(claim2!.status).toBe('claimed');
    });

    it('prevents double-claim', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'pending',
      });

      const { data: claim1 } = await supabase
        .from('content_evolution_runs')
        .update({ status: 'claimed', runner_id: 'runner-A' })
        .eq('id', run.id)
        .eq('status', 'pending')
        .select('id, status')
        .single();

      expect(claim1).toBeTruthy();

      // Runner B tries to claim — status is now 'claimed', not 'pending'
      const { data: claim2 } = await supabase
        .from('content_evolution_runs')
        .update({ status: 'claimed', runner_id: 'runner-B' })
        .eq('id', run.id)
        .eq('status', 'pending')
        .select('id, status')
        .single();

      expect(claim2).toBeNull();

      const { data: actual } = await supabase
        .from('content_evolution_runs')
        .select('runner_id')
        .eq('id', run.id)
        .single();

      expect(actual!.runner_id).toBe('runner-A');
    });
  });

  // ─── Heartbeat timeout ────────────────────────────────────────

  describe('Heartbeat timeout', () => {
    it('marks stale running run as failed', async () => {
      if (!tablesReady) return;

      const staleTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'running',
        last_heartbeat: staleTime,
        started_at: staleTime,
      });

      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: staleRuns } = await supabase
        .from('content_evolution_runs')
        .select('id')
        .in('status', ['running', 'claimed'])
        .lt('last_heartbeat', cutoff);

      expect(staleRuns).toBeTruthy();
      const staleIds = staleRuns!.map((r) => r.id);
      expect(staleIds).toContain(run.id);

      if (staleIds.length > 0) {
        await supabase
          .from('content_evolution_runs')
          .update({ status: 'failed', error_message: 'Heartbeat timeout' })
          .in('id', staleIds);
      }

      const { data: updated } = await supabase
        .from('content_evolution_runs')
        .select('status, error_message')
        .eq('id', run.id)
        .single();

      expect(updated!.status).toBe('failed');
      expect(updated!.error_message).toBe('Heartbeat timeout');
    });

    it('does not mark fresh run', async () => {
      if (!tablesReady) return;

      const freshTime = new Date().toISOString();
      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'running',
        last_heartbeat: freshTime,
        started_at: freshTime,
      });

      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: staleRuns } = await supabase
        .from('content_evolution_runs')
        .select('id')
        .in('status', ['running', 'claimed'])
        .lt('last_heartbeat', cutoff);

      const staleIds = (staleRuns ?? []).map((r) => r.id);
      expect(staleIds).not.toContain(run.id);

      const { data: actual } = await supabase
        .from('content_evolution_runs')
        .select('status')
        .eq('id', run.id)
        .single();

      expect(actual!.status).toBe('running');
    });

    it('marks stale claimed run', async () => {
      if (!tablesReady) return;

      const staleTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'claimed',
        last_heartbeat: staleTime,
        runner_id: 'stale-runner',
      });

      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: staleRuns } = await supabase
        .from('content_evolution_runs')
        .select('id')
        .in('status', ['running', 'claimed'])
        .lt('last_heartbeat', cutoff);

      const staleIds = (staleRuns ?? []).map((r) => r.id);
      expect(staleIds).toContain(run.id);

      await supabase
        .from('content_evolution_runs')
        .update({ status: 'failed', error_message: 'Heartbeat timeout (claimed)' })
        .in('id', staleIds);

      const { data: updated } = await supabase
        .from('content_evolution_runs')
        .select('status')
        .eq('id', run.id)
        .single();

      expect(updated!.status).toBe('failed');
    });
  });

  // ─── Split-brain ──────────────────────────────────────────────

  describe('Split-brain', () => {
    it('detects externally failed run', async () => {
      if (!tablesReady) return;

      const run = await createTestEvolutionRun(supabase, testExplanationId, {
        status: 'running',
        started_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
      });

      // External process marks run as failed
      await supabase
        .from('content_evolution_runs')
        .update({ status: 'failed', error_message: 'External failure' })
        .eq('id', run.id);

      const { data: current } = await supabase
        .from('content_evolution_runs')
        .select('status, error_message')
        .eq('id', run.id)
        .single();

      expect(current!.status).toBe('failed');
      expect(current!.error_message).toBe('External failure');
    });
  });

  // ─── Feature flags (env var based) ─────────────────────────────

  describe('Feature flags', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it('returns sync flags with core agents always-on', () => {
      const flags = getFeatureFlags();

      expect(flags).toBeTruthy();
      expect(flags.tournamentEnabled).toBe(true);
      expect(flags.evolvePoolEnabled).toBe(true);
      expect(flags.debateEnabled).toBe(true);
      expect(flags.sectionDecompositionEnabled).toBe(true);
    });

    it('matches DEFAULT_EVOLUTION_FLAGS when no env vars set', () => {
      process.env = { ...originalEnv };
      delete process.env.EVOLUTION_TREE_SEARCH;
      delete process.env.EVOLUTION_OUTLINE_GENERATION;
      delete process.env.EVOLUTION_FLOW_CRITIQUE;

      const flags = getFeatureFlags();

      expect(flags.tournamentEnabled).toBe(DEFAULT_EVOLUTION_FLAGS.tournamentEnabled);
      expect(flags.evolvePoolEnabled).toBe(DEFAULT_EVOLUTION_FLAGS.evolvePoolEnabled);
    });
  });
});
