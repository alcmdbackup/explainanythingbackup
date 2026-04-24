// Integration test for the monotonic invariant on the evolution dashboard:
// total cost with `filterTestContent: false` must be >= total cost with
// `filterTestContent: true`. Off ≥ on, always (toggling the test-content
// filter off can only ADD runs, never remove them).

// Mock admin auth + logging boundary BEFORE the action import — the action is
// wrapped in adminAction(...) which requires a real admin session in production.
// Same pattern as other integration tests that call admin actions directly.
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

describe('Dashboard total cost monotonic invariant (off ≥ on)', () => {
  it('total cost with filterTestContent=false is >= total cost with filterTestContent=true', async () => {
    if (!tablesExist) return;

    // Seed: 1 prod run + 1 test run, each with a known cost.
    const prodRun = await createTestEvolutionRun(supabase, null, { status: 'completed' });
    const testRun = await createTestEvolutionRun(supabase, null, { status: 'completed' });
    const prodRunId = prodRun.id as string;
    const testRunId = testRun.id as string;
    createdRunIds.push(prodRunId, testRunId);
    await writeCost(prodRunId, 0.10);
    await writeCost(testRunId, 0.50);

    const onResult = await getEvolutionDashboardDataAction({ filterTestContent: true });
    const offResult = await getEvolutionDashboardDataAction({ filterTestContent: false });
    expect(onResult.success).toBe(true);
    expect(offResult.success).toBe(true);
    const on = onResult.data!.totalCostUsd ?? 0;
    const off = offResult.data!.totalCostUsd ?? 0;
    expect(off).toBeGreaterThanOrEqual(on);
  });
});
