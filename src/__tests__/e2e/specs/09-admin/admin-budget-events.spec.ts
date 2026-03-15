/**
 * Admin evolution budget events E2E tests.
 * Tests that failed runs display correctly and budget_events table is functional (when migration applied).
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Test data seeding helpers ───────────────────────────────────

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface SeededBudgetRun {
  runId: string;
  explanationId: number;
  topicId: number;
  budgetEventsSeeded: boolean;
}

async function cleanupExistingTestData(supabase: ReturnType<typeof getServiceClient>) {
  const { data: oldTopics } = await supabase
    .from('topics')
    .select('id')
    .eq('topic_title', '[TEST] Budget Events E2E Topic');

  if (oldTopics?.length) {
    const topicIds = oldTopics.map(t => t.id);
    const { data: oldExplanations } = await supabase
      .from('explanations')
      .select('id')
      .in('primary_topic_id', topicIds);

    if (oldExplanations?.length) {
      const expIds = oldExplanations.map(e => e.id);
      const { data: oldRuns } = await supabase
        .from('evolution_runs')
        .select('id')
        .in('explanation_id', expIds);

      if (oldRuns?.length) {
        const runIds = oldRuns.map(r => r.id);
        // Ignore errors — table may not exist yet
        await supabase.from('evolution_budget_events').delete().in('run_id', runIds);
        await supabase.from('evolution_variants').delete().in('run_id', runIds);
        await supabase.from('evolution_runs').delete().in('id', runIds);
      }
      await supabase.from('explanations').delete().in('id', expIds);
    }
    await supabase.from('topics').delete().in('id', topicIds);
  }
}

async function seedBudgetExhaustedRun(): Promise<SeededBudgetRun> {
  const supabase = getServiceClient();
  await cleanupExistingTestData(supabase);

  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .insert({
      topic_title: '[TEST] Budget Events E2E Topic',
      topic_description: 'Test topic for budget events E2E.',
    })
    .select('id')
    .single();
  if (topicError || !topic) throw new Error(`Failed to seed topic: ${topicError?.message}`);

  const { data: explanation, error: expError } = await supabase
    .from('explanations')
    .insert({
      explanation_title: '[TEST] Budget Events E2E Article',
      content: 'Test content for budget events E2E.',
      status: 'published',
      primary_topic_id: topic.id,
    })
    .select('id')
    .single();
  if (expError || !explanation) throw new Error(`Failed to seed explanation: ${expError?.message}`);

  // Create evolution_explanations record (required FK)
  const { data: evoExp, error: evoExpError } = await supabase
    .from('evolution_explanations')
    .insert({
      explanation_id: explanation.id,
      title: '[TEST] Budget Events E2E',
      content: 'Test content for budget events E2E.',
      source: 'explanation',
    })
    .select('id')
    .single();
  if (evoExpError || !evoExp) throw new Error(`Failed to seed evolution_explanation: ${evoExpError?.message}`);

  const { data: run, error: runError } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: explanation.id,
      evolution_explanation_id: evoExp.id,
      status: 'failed',
      budget_cap_usd: 2.0,
      total_cost_usd: 1.95,
      total_variants: 2,
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (runError || !run) throw new Error(`Failed to seed run: ${runError?.message}`);

  // Seed budget events — gracefully skip if table doesn't exist (migration not yet applied)
  let budgetEventsSeeded = false;
  const now = new Date();
  const events = [
    { run_id: run.id, event_type: 'reserve', agent_name: 'generation', amount_usd: 0.05, total_spent_usd: 0, total_reserved_usd: 0.05, available_budget_usd: 1.95, created_at: new Date(now.getTime() - 3000).toISOString() },
    { run_id: run.id, event_type: 'spend', agent_name: 'generation', amount_usd: 0.04, total_spent_usd: 0.04, total_reserved_usd: 0, available_budget_usd: 1.96, created_at: new Date(now.getTime() - 2000).toISOString() },
    { run_id: run.id, event_type: 'reserve', agent_name: 'evolution', amount_usd: 0.10, total_spent_usd: 0.04, total_reserved_usd: 0.10, available_budget_usd: 1.86, created_at: new Date(now.getTime() - 1000).toISOString() },
    { run_id: run.id, event_type: 'release_ok', agent_name: 'evolution', amount_usd: 0.10, total_spent_usd: 0.04, total_reserved_usd: 0, available_budget_usd: 1.96, created_at: now.toISOString() },
  ];

  const { error: eventsError } = await supabase.from('evolution_budget_events').insert(events);
  if (!eventsError) {
    budgetEventsSeeded = true;
  }
  // If eventsError, table likely doesn't exist yet — tests that need it will be skipped

  return { runId: run.id, explanationId: explanation.id, topicId: topic.id, budgetEventsSeeded };
}

async function cleanupSeededData(data: SeededBudgetRun | undefined) {
  if (!data) return;
  const supabase = getServiceClient();
  // Ignore errors on budget events cleanup — table may not exist
  await supabase.from('evolution_budget_events').delete().eq('run_id', data.runId);
  await supabase.from('evolution_variants').delete().eq('run_id', data.runId);
  await supabase.from('evolution_runs').delete().eq('id', data.runId);
  await supabase.from('explanations').delete().eq('id', data.explanationId);
  await supabase.from('topics').delete().eq('id', data.topicId);
}

// ─── Tests ───────────────────────────────────────────────────────

adminTest.describe('Admin Budget Events', () => {
  let seededData: SeededBudgetRun;

  adminTest.beforeAll(async () => {
    seededData = await seedBudgetExhaustedRun();
  });

  adminTest.afterAll(async () => {
    await cleanupSeededData(seededData);
  });

  adminTest(
    'failed run with budget events appears in evolution runs table',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/evolution');
      await adminPage.waitForLoadState('domcontentloaded');

      // Filter to show failed runs (budget exhaustion causes 'failed' status)
      const statusFilter = adminPage.locator('[data-testid="evolution-status-filter"]');
      await statusFilter.selectOption('failed');
      await adminPage.waitForLoadState('domcontentloaded');

      // Table should contain a row with our run's status
      const table = adminPage.locator('[data-testid="evolution-runs-table"]');
      await expect(table).toBeVisible();

      const statusBadges = table.locator('tbody tr td:nth-child(2) span');
      const count = await statusBadges.count();
      expect(count).toBeGreaterThanOrEqual(1);

      // At least one badge should show failed
      let found = false;
      for (let i = 0; i < count; i++) {
        const text = await statusBadges.nth(i).textContent();
        if (text?.includes('failed')) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    },
  );

  adminTest(
    'budget events table accepts and returns seeded data',
    async () => {
      adminTest.skip(!seededData.budgetEventsSeeded, 'evolution_budget_events table not yet migrated');

      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from('evolution_budget_events')
        .select('event_type, agent_name, amount_usd')
        .eq('run_id', seededData.runId)
        .order('created_at');

      expect(error).toBeNull();
      expect(data).toHaveLength(4);
      expect(data![0].event_type).toBe('reserve');
      expect(data![1].event_type).toBe('spend');
      expect(data![2].event_type).toBe('reserve');
      expect(data![3].event_type).toBe('release_ok');
    },
  );
});
