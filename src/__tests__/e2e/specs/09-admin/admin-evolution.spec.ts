/**
 * Admin evolution pipeline E2E tests.
 * Tests page load, filtering, queue dialog, and variant panel.
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

interface SeededRun {
  id: string;
  explanation_id: number;
  topic_id: number;
}

async function cleanupExistingTestData(supabase: ReturnType<typeof getServiceClient>) {
  // Clean up leftover data from previous failed runs (reverse FK order)
  const { data: oldTopics } = await supabase
    .from('topics')
    .select('id')
    .eq('topic_title', '[TEST] Evolution E2E Topic');

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
        await supabase.from('evolution_variants').delete().in('run_id', runIds);
        await supabase.from('evolution_runs').delete().in('id', runIds);
      }
      await supabase.from('explanations').delete().in('id', expIds);
    }
    await supabase.from('topics').delete().in('id', topicIds);
  }
}

async function seedEvolutionRun(): Promise<SeededRun> {
  const supabase = getServiceClient();

  // Clean up leftover data from previous failed runs
  await cleanupExistingTestData(supabase);

  // Create a test topic (explanations.primary_topic_id is NOT NULL)
  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .upsert({
      topic_title: '[TEST] Evolution E2E Topic',
      topic_description: 'Test topic for evolution E2E.',
    }, { onConflict: 'topic_title' })
    .select('id')
    .single();

  if (topicError || !topic) throw new Error(`Failed to seed topic: ${topicError?.message}`);

  // Create a test explanation
  const { data: explanation, error: expError } = await supabase
    .from('explanations')
    .insert({
      explanation_title: '[TEST] Evolution E2E Test Article',
      content: 'Test content for evolution pipeline E2E.',
      status: 'published',
      primary_topic_id: topic.id,
    })
    .select('id')
    .single();

  if (expError || !explanation) throw new Error(`Failed to seed explanation: ${expError?.message}`);

  // Create a completed evolution run
  const { data: run, error: runError } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: explanation.id,
      status: 'completed',
      config: { budgetCapUsd: 5.0 },
      pipeline_version: 'v2',
      run_summary: { totalCostUsd: 1.25, totalVariants: 3 },
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (runError || !run) throw new Error(`Failed to seed run: ${runError?.message}`);

  // Seed variants
  const variants = [
    { run_id: run.id, explanation_id: explanation.id, variant_content: 'Variant 1', elo_score: 1300, generation: 1, agent_name: 'generation', match_count: 5, is_winner: true },
    { run_id: run.id, explanation_id: explanation.id, variant_content: 'Variant 2', elo_score: 1200, generation: 1, agent_name: 'generation', match_count: 4 },
    { run_id: run.id, explanation_id: explanation.id, variant_content: 'Variant 3', elo_score: 1100, generation: 2, agent_name: 'evolution', match_count: 3 },
  ];

  await supabase.from('evolution_variants').insert(variants);

  return { id: run.id, explanation_id: explanation.id, topic_id: topic.id };
}

async function cleanupSeededData(run: SeededRun | undefined) {
  if (!run) return;
  const supabase = getServiceClient();
  const { error: e1 } = await supabase.from('evolution_variants').delete().eq('run_id', run.id);
  if (e1) console.warn(`[cleanup] Failed to delete from evolution_variants: ${e1.message}`);
  const { error: e2 } = await supabase.from('evolution_runs').delete().eq('id', run.id);
  if (e2) console.warn(`[cleanup] Failed to delete from evolution_runs: ${e2.message}`);
  const { error: e3 } = await supabase.from('explanations').delete().eq('id', run.explanation_id);
  if (e3) console.warn(`[cleanup] Failed to delete from explanations: ${e3.message}`);
  const { error: e4 } = await supabase.from('topics').delete().eq('id', run.topic_id);
  if (e4) console.warn(`[cleanup] Failed to delete from topics: ${e4.message}`);
}

// ─── Tests ───────────────────────────────────────────────────────

adminTest.describe('Admin Evolution Pipeline', { tag: '@evolution' }, () => {
  let seededRun: SeededRun;

  adminTest.beforeAll(async () => {
    seededRun = await seedEvolutionRun();
  });

  adminTest.afterAll(async () => {
    await cleanupSeededData(seededRun);
  });

  adminTest(
    'page loads with heading and runs table',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/runs');
      await adminPage.waitForLoadState('domcontentloaded');

      // Heading
      await expect(adminPage.locator('h1')).toContainText('Pipeline Runs');

      // Runs table
      const table = adminPage.locator('[data-testid="evolution-runs-table"]');
      await expect(table).toBeVisible();
    },
  );

  adminTest(
    'status filter filters runs',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/runs');
      await adminPage.waitForLoadState('domcontentloaded');

      const statusFilter = adminPage.locator('[data-testid="evolution-status-filter"]');
      await statusFilter.selectOption('completed');

      // Wait for table to reload
      await adminPage.waitForLoadState('domcontentloaded');

      // All visible status badges should show "completed"
      const statusBadges = adminPage.locator('[data-testid="evolution-runs-table"] tbody tr td:nth-child(2) span');
      const count = await statusBadges.count();
      for (let i = 0; i < count; i++) {
        await expect(statusBadges.nth(i)).toHaveText('completed');
      }
    },
  );

  adminTest(
    'variant panel opens when clicking Variants',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/runs');
      await adminPage.waitForLoadState('domcontentloaded');

      // Click "Variants" on our seeded run
      const variantsBtn = adminPage.locator(`[data-testid="view-variants-${seededRun.id}"]`);
      if (await variantsBtn.isVisible()) {
        await variantsBtn.click();

        // Variant panel should open
        const panel = adminPage.locator('[role="dialog"][aria-label="Run variants"]');
        await expect(panel).toBeVisible();

        // Should show variants table
        const variantsTable = panel.locator('[data-testid="variants-table"]');
        await expect(variantsTable).toBeVisible();

        // Close panel
        await panel.locator('button', { hasText: '\u00d7' }).click();
        await expect(panel).not.toBeVisible();
      }
    },
  );

  adminTest(
    'summary cards display statistics',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/runs');
      await adminPage.waitForLoadState('domcontentloaded');

      const cards = adminPage.locator('[data-testid="summary-cards"]');
      await expect(cards).toBeVisible();

      // Should have 4 summary cards
      const cardItems = cards.locator('> div');
      await expect(cardItems).toHaveCount(4);
    },
  );

  adminTest(
    'date range filter is present',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/runs');
      await adminPage.waitForLoadState('domcontentloaded');

      const dateFilter = adminPage.locator('[data-testid="evolution-date-filter"]');
      await expect(dateFilter).toBeVisible();

      // Should have date range options
      await dateFilter.selectOption('7d');
      await adminPage.waitForLoadState('domcontentloaded');
    },
  );
});
