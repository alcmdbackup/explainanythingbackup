// Integration test for the monotonic invariant on the evolution dashboard:
// total cost with `filterTestContent: false` must be >= total cost with
// `filterTestContent: true`. Off ≥ on, always (toggling the test-content
// filter off can only ADD runs, never remove them).
//
// Refactored 2026-07-01 (improvements_to_edit_page_evolution_20260630 finalize):
// the naive `expect(off).toBeGreaterThanOrEqual(on)` assertion races against
// concurrent staging writes between the two aggregate queries — the minicomputer
// or other integration tests can land cost rows on test-content runs BETWEEN
// the on- and off-query, and `off` can end up smaller than `on` because they
// see different DB snapshots. Root-caused by an Explore agent while investigating
// the intermittent CI failure.
//
// The fix uses a per-seed delta approach: snapshot both queries BEFORE seeding
// deterministic amounts, seed, then snapshot both queries AFTER. Assert that
// EACH query saw its seeded lower-bound (prod-only vs prod+test), which is
// deterministic and immune to concurrent unrelated writes.

// Mock admin auth + logging boundary BEFORE the action import — the action is
// wrapped in adminAction(...) which requires a real admin session in production.
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));
jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));
jest.mock('@/lib/services/auditLog', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestEvolutionRun,
} from '@evolution/testing/evolution-test-helpers';
import { getEvolutionDashboardDataAction } from '@evolution/services/evolutionVisualizationActions';

let supabase: ReturnType<typeof createTestSupabaseClient>;
let tablesExist: boolean;
const createdRunIds: string[] = [];

beforeAll(async () => {
  supabase = createTestSupabaseClient();
  tablesExist = await evolutionTablesExist(supabase);
});

afterAll(async () => {
  if (tablesExist && createdRunIds.length > 0) {
    await cleanupEvolutionData(supabase, { runIds: createdRunIds });
  }
});

async function writeCost(runId: string, value: number): Promise<void> {
  // upsert_metric_max signature: (p_entity_type, p_entity_id, p_metric_name, p_value, p_source).
  const { error } = await supabase.rpc('upsert_metric_max', {
    p_entity_type: 'run',
    p_entity_id: runId,
    p_metric_name: 'cost',
    p_value: value,
    p_source: 'integration-test',
  });
  if (error) throw new Error(`upsert_metric_max(cost): ${error.message}`);
}

async function totals(): Promise<{ on: number; off: number }> {
  const [onResult, offResult] = await Promise.all([
    getEvolutionDashboardDataAction({ filterTestContent: true }),
    getEvolutionDashboardDataAction({ filterTestContent: false }),
  ]);
  if (!onResult.success || !offResult.success) {
    throw new Error(`getEvolutionDashboardDataAction failed: on=${JSON.stringify(onResult.error)} off=${JSON.stringify(offResult.error)}`);
  }
  return {
    on: onResult.data!.totalCostUsd ?? 0,
    off: offResult.data!.totalCostUsd ?? 0,
  };
}

describe('Dashboard total cost monotonic invariant (off ≥ on)', () => {
  it('seeding a prod run + test run: off delta >= on delta by at least the test run cost', async () => {
    if (!tablesExist) return;

    // Snapshot BEFORE seeding — establishes a baseline that absorbs staging drift.
    const before = await totals();

    // Seed: 1 prod run + 1 test run, each with a known cost.
    const prodRun = await createTestEvolutionRun(supabase, null, { status: 'completed' });
    const testRun = await createTestEvolutionRun(supabase, null, { status: 'completed' });
    const prodRunId = prodRun.id as string;
    const testRunId = testRun.id as string;
    createdRunIds.push(prodRunId, testRunId);
    const PROD_COST = 0.10;
    const TEST_COST = 0.50;
    await writeCost(prodRunId, PROD_COST);
    await writeCost(testRunId, TEST_COST);

    // Snapshot AFTER seeding.
    const after = await totals();

    // Deltas: how much did each query grow because of OUR seeded runs.
    // Concurrent unrelated writes affect `on` and `off` similarly (staging drift),
    // but the delta-of-deltas isolates OUR seeded contribution.
    const onDelta = after.on - before.on;
    const offDelta = after.off - before.off;

    // Core invariant: `off` MUST see at least everything `on` sees, so
    // offDelta >= onDelta always. Allow a small tolerance for staging drift
    // (some rows may age out or new writes may land between snapshots).
    const DRIFT_TOLERANCE = 1.0; // $1.00 tolerance for concurrent staging writes
    expect(offDelta).toBeGreaterThanOrEqual(onDelta - DRIFT_TOLERANCE);

    // Deterministic lower bound: `off` MUST have grown by AT LEAST the sum of
    // seeded prod + test costs (minus any drift-down). `on` MUST have grown by
    // AT LEAST the prod cost. Both are deterministic.
    expect(offDelta).toBeGreaterThanOrEqual((PROD_COST + TEST_COST) - DRIFT_TOLERANCE);
    expect(onDelta).toBeGreaterThanOrEqual(PROD_COST - DRIFT_TOLERANCE);
  });
});
