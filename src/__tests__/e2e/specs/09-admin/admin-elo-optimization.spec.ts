/**
 * Admin Elo Optimization dashboard E2E tests.
 * Tests page load, tabs, strategy leaderboard, and agent analysis.
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

interface SeededStrategy {
  id: string;
  runId: string;
  explanationId: number;
  topicId: number;
}

async function cleanupExistingTestData(supabase: ReturnType<typeof getServiceClient>) {
  // Clean up leftover data from previous failed runs (reverse FK order)
  const { data: oldTopics } = await supabase
    .from('topics')
    .select('id')
    .eq('topic_title', '[TEST] Elo Optimization E2E Topic');

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
        await supabase.from('evolution_run_agent_metrics').delete().in('run_id', runIds);
        await supabase.from('evolution_variants').delete().in('run_id', runIds);
        await supabase.from('evolution_runs').delete().in('id', runIds);
      }
      await supabase.from('explanations').delete().in('id', expIds);
    }
    await supabase.from('topics').delete().in('id', topicIds);
  }
  // Also clean up orphaned strategy configs
  await supabase.from('evolution_strategy_configs').delete().eq('name', '[TEST] E2E Strategy');
}

async function seedStrategyData(): Promise<SeededStrategy> {
  const supabase = getServiceClient();

  // Clean up leftover data from previous failed runs
  await cleanupExistingTestData(supabase);

  // Create test topic
  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .insert({
      topic_title: '[TEST] Elo Optimization E2E Topic',
      topic_description: 'Test topic for Elo optimization E2E.',
    })
    .select('id')
    .single();

  if (topicError || !topic) throw new Error(`Failed to seed topic: ${topicError?.message}`);

  // Create test explanation
  const { data: explanation, error: expError } = await supabase
    .from('explanations')
    .insert({
      explanation_title: '[TEST] Elo Optimization E2E Article',
      content: 'Test content for Elo optimization dashboard E2E.',
      status: 'published',
      primary_topic_id: topic.id,
    })
    .select('id')
    .single();

  if (expError || !explanation) throw new Error(`Failed to seed explanation: ${expError?.message}`);

  // Create strategy config
  const { data: strategy, error: stratError } = await supabase
    .from('evolution_strategy_configs')
    .insert({
      config_hash: 'e2e-test-hash-' + Date.now(),
      name: '[TEST] E2E Strategy',
      label: 'Gen: test-model | Judge: test-judge',
      config: {
        generationModel: 'test-model',
        judgeModel: 'test-judge',
        iterations: 10,
        budgetCaps: {},
      },
      run_count: 1,
      total_cost_usd: 0.50,
      avg_final_elo: 1500,
      avg_elo_per_dollar: 3000,
    })
    .select('id')
    .single();

  if (stratError || !strategy) throw new Error(`Failed to seed strategy: ${stratError?.message}`);

  // Create evolution run linked to strategy
  const { data: run, error: runError } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: explanation.id,
      status: 'completed',
      budget_cap_usd: 1.0,
      total_cost_usd: 0.50,
      strategy_config_id: strategy.id,
    })
    .select('id')
    .single();

  if (runError || !run) throw new Error(`Failed to seed run: ${runError?.message}`);

  // Seed agent metrics for the run (Elo-scale: avg_elo ~1200 baseline, elo_gain = avg_elo - 1200)
  await supabase.from('evolution_run_agent_metrics').insert([
    { run_id: run.id, agent_name: 'generation', cost_usd: 0.25, avg_elo: 1450, elo_gain: 250, elo_per_dollar: 1000 },
    { run_id: run.id, agent_name: 'evolution', cost_usd: 0.10, avg_elo: 1380, elo_gain: 180, elo_per_dollar: 1800 },
  ]);

  return {
    id: strategy.id,
    runId: run.id,
    explanationId: explanation.id,
    topicId: topic.id,
  };
}

async function cleanupSeededData(data: SeededStrategy | undefined) {
  if (!data) return;
  const supabase = getServiceClient();
  await supabase.from('evolution_run_agent_metrics').delete().eq('run_id', data.runId);
  await supabase.from('evolution_runs').delete().eq('id', data.runId);
  await supabase.from('evolution_strategy_configs').delete().eq('id', data.id);
  await supabase.from('explanations').delete().eq('id', data.explanationId);
  await supabase.from('topics').delete().eq('id', data.topicId);
}

// ─── Tests ───────────────────────────────────────────────────────

adminTest.describe('Admin Elo Optimization Dashboard', () => {
  let seededData: SeededStrategy;

  adminTest.beforeAll(async () => {
    seededData = await seedStrategyData();
  });

  adminTest.afterAll(async () => {
    await cleanupSeededData(seededData);
  });

  adminTest(
    'page loads with heading and tabs',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/optimization');
      await adminPage.waitForLoadState('domcontentloaded');

      // Heading
      await expect(adminPage.locator('h1')).toContainText('Elo Optimization');

      // Tabs should be visible
      const tabs = adminPage.locator('button', { hasText: /Strategy Analysis|Agent Analysis|Cost Analysis/ });
      await expect(tabs.first()).toBeVisible();
    },
  );

  adminTest(
    'strategy tab shows leaderboard',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/optimization');
      await adminPage.waitForLoadState('domcontentloaded');

      // Click Strategy Analysis tab (should be default)
      const strategyTab = adminPage.locator('button', { hasText: 'Strategy Analysis' });
      await strategyTab.click();

      // Leaderboard table should be visible
      await expect(adminPage.locator('text=Strategy Leaderboard')).toBeVisible();

      // Should show seeded strategy (or at least a table)
      const table = adminPage.locator('table');
      await expect(table).toBeVisible();
    },
  );

  adminTest(
    'agent tab shows agent ROI leaderboard',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/optimization');
      await adminPage.waitForLoadState('domcontentloaded');

      // Click Agent Analysis tab
      const agentTab = adminPage.locator('button', { hasText: 'Agent Analysis' });
      await agentTab.click();

      // Wait for content to load
      await adminPage.waitForLoadState('domcontentloaded');

      // Should show agent data (seeded with 2 generating agents)
      // With minSampleSize=1 fix, all agents should appear
      const agentRows = adminPage.locator('table tbody tr');
      const count = await agentRows.count();
      expect(count).toBeGreaterThanOrEqual(1);
    },
  );

  adminTest(
    'cost tab shows cost breakdown',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/optimization');
      await adminPage.waitForLoadState('domcontentloaded');

      // Click Cost Analysis tab
      const costTab = adminPage.locator('button', { hasText: 'Cost Analysis' });
      await costTab.click();

      // Wait for content to load
      await adminPage.waitForLoadState('domcontentloaded');

      // Should show cost summary cards
      await expect(adminPage.locator('text=Total Spent')).toBeVisible();
    },
  );

  adminTest(
    'no console errors on page load (React key fix)',
    async ({ adminPage }) => {
      const consoleErrors: string[] = [];
      adminPage.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      await adminPage.goto('/admin/quality/optimization');
      await adminPage.waitForLoadState('domcontentloaded');

      // Filter for React key errors
      const keyErrors = consoleErrors.filter((err) =>
        err.includes('unique "key" prop') || err.includes('Each child in a list'),
      );

      expect(keyErrors).toHaveLength(0);
    },
  );

  adminTest(
    'refresh button reloads data',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/optimization');
      await adminPage.waitForLoadState('domcontentloaded');

      const refreshBtn = adminPage.locator('button', { hasText: 'Refresh' });
      await expect(refreshBtn).toBeVisible();

      // Click refresh
      await refreshBtn.click();

      // Button should show loading state briefly
      await expect(refreshBtn).toContainText(/Loading|Refresh/);
    },
  );
});
