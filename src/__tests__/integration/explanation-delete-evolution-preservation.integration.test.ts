/**
 * Integration test: deleting an `explanations` row must NOT delete any
 * `evolution_runs` row that references it. The cross-boundary FK
 * `evolution_runs.explanation_id → explanations(id)` uses ON DELETE SET NULL,
 * and this test pins that invariant.
 *
 * This is the central safety property of the explainanything DB reset
 * (split_evolution_explainanythig_into_separate_websites_20260522).
 *
 * Auto-skips when evolution tables are not yet migrated.
 */

import {
  setupTestDatabase,
  teardownTestDatabase,
  createTestContext,
} from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  createTestEvolutionRun,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Explanation delete preserves evolution data', () => {
  let supabase: SupabaseClient;
  let skipAll = false;
  let testId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    skipAll = !(await evolutionTablesExist(supabase));
    if (skipAll) {
      console.warn('[explanation-delete-evolution-preservation] evolution tables not migrated; skipping');
    }
  });

  afterAll(async () => {
    await teardownTestDatabase(supabase);
  });

  beforeEach(async () => {
    if (skipAll) return;
    const ctx = await createTestContext();
    testId = ctx.testId;
    cleanup = ctx.cleanup;
    supabase = ctx.supabase;
  });

  afterEach(async () => {
    if (skipAll) return;
    await cleanup();
  });

  it('deletes the explanation but keeps the evolution_run with explanation_id NULL', async () => {
    if (skipAll) return;

    // Arrange: create a test explanation.
    const explTitle = `[TEST] preserve-evolution-${testId}`;
    const { data: explanation, error: explErr } = await supabase
      .from('explanations')
      .insert({
        explanation_title: explTitle,
        content: 'test content',
        status: 'published',
      })
      .select()
      .single();
    expect(explErr).toBeNull();
    const explanationId = (explanation as { id: number }).id;

    // Create an evolution_run that references it.
    const run = await createTestEvolutionRun(supabase, explanationId);
    const runId = run.id as string;
    const strategyId = run.strategy_id as string;
    const promptId = run.prompt_id as string;

    // Act: delete the explanation.
    const { error: delErr } = await supabase
      .from('explanations')
      .delete()
      .eq('id', explanationId);
    expect(delErr).toBeNull();

    // Assert: the evolution_run still exists, with explanation_id NULL.
    const { data: refreshed, error: readErr } = await supabase
      .from('evolution_runs')
      .select('id, explanation_id')
      .eq('id', runId)
      .single();
    expect(readErr).toBeNull();
    expect(refreshed).toMatchObject({ id: runId, explanation_id: null });

    // Cleanup the evolution row we created (strategy + prompt + run).
    await cleanupEvolutionData(supabase, { runIds: [runId], strategyIds: [strategyId], promptIds: [promptId] });
  });
});
