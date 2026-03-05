// Integration tests for manual experiment lifecycle: create → add runs → start → verify.
// Uses mocked auth but real Supabase to test the full server action chain.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  createTestPrompt,
  evolutionTablesExist,
} from '@evolution/testing/evolution-test-helpers';
import {
  setupTestDatabase,
  teardownTestDatabase,
  seedTestData,
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
import {
  createManualExperimentAction,
  addRunToExperimentAction,
  startManualExperimentAction,
  deleteExperimentAction,
  getExperimentStatusAction,
} from '@evolution/services/experimentActions';

describe('Manual Experiment Lifecycle Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  let testPromptId: string;
  const createdExperimentIds: string[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping manual experiment tests: tables not yet migrated');
      return;
    }
    await seedTestData(supabase);
    testPromptId = await createTestPrompt(supabase);
  }, 30_000);

  afterAll(async () => {
    if (tablesReady) {
      // Clean up created experiments
      for (const expId of createdExperimentIds) {
        await supabase.from('evolution_runs').delete().eq('experiment_id', expId);
        await supabase.from('evolution_experiments').delete().eq('id', expId);
      }
      await cleanupEvolutionData(supabase, []);
    }
    await teardownTestDatabase(supabase);
  }, 15_000);

  it('creates a manual experiment', async () => {
    if (!tablesReady) return;

    const result = await createManualExperimentAction({
      name: `IntTestManual Experiment`,
      promptId: testPromptId,
      target: 'elo',
    });

    expect(result.success).toBe(true);
    expect(result.data?.experimentId).toBeTruthy();
    createdExperimentIds.push(result.data!.experimentId);

    // Verify it was created with correct design
    const status = await getExperimentStatusAction({ experimentId: result.data!.experimentId });
    expect(status.success).toBe(true);
    expect(status.data?.design).toBe('manual');
    expect(status.data?.status).toBe('pending');
  });

  it('adds a run to the experiment', async () => {
    if (!tablesReady || createdExperimentIds.length === 0) return;

    const experimentId = createdExperimentIds[0];
    const result = await addRunToExperimentAction({
      experimentId,
      config: {
        generationModel: 'gpt-4.1-mini',
        judgeModel: 'gpt-4.1-nano',
        budgetCapUsd: 0.50,
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.runCount).toBe(1);
  });

  it('starts the manual experiment', async () => {
    if (!tablesReady || createdExperimentIds.length === 0) return;

    const experimentId = createdExperimentIds[0];
    const result = await startManualExperimentAction({ experimentId });

    expect(result.success).toBe(true);
    expect(result.data?.started).toBe(true);

    // Verify status changed to running
    const status = await getExperimentStatusAction({ experimentId });
    expect(status.data?.status).toBe('running');
  });

  it('rejects budget above $1.00 cap', async () => {
    if (!tablesReady || createdExperimentIds.length === 0) return;

    const experimentId = createdExperimentIds[0];
    const result = await addRunToExperimentAction({
      experimentId,
      config: {
        generationModel: 'gpt-4o',
        judgeModel: 'gpt-4.1-nano',
        budgetCapUsd: 5.00,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('$1.00');
  });

  it('cannot delete a non-pending experiment', async () => {
    if (!tablesReady || createdExperimentIds.length === 0) return;

    // The experiment is now 'running' from the start test
    const experimentId = createdExperimentIds[0];
    const result = await deleteExperimentAction({ experimentId });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('pending');
  });

  it('can delete a pending experiment', async () => {
    if (!tablesReady) return;

    // Create a new experiment just to delete it
    const createResult = await createManualExperimentAction({
      name: `IntTestDeletable Experiment`,
      promptId: testPromptId,
    });
    expect(createResult.success).toBe(true);
    const expId = createResult.data!.experimentId;

    const deleteResult = await deleteExperimentAction({ experimentId: expId });
    expect(deleteResult.success).toBe(true);
    expect(deleteResult.data?.deleted).toBe(true);
  });
});
