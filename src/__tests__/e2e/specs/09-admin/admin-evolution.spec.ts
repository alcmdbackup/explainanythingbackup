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

async function seedEvolutionRun(): Promise<SeededRun> {
  const supabase = getServiceClient();

  // Create a test topic (explanations.primary_topic_id is NOT NULL)
  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .insert({
      topic_title: '[TEST] Evolution E2E Topic',
      topic_description: 'Test topic for evolution E2E.',
    })
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
    .from('content_evolution_runs')
    .insert({
      explanation_id: explanation.id,
      status: 'completed',
      budget_cap_usd: 5.0,
      total_cost_usd: 1.25,
      total_variants: 3,
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

  await supabase.from('content_evolution_variants').insert(variants);

  return { id: run.id, explanation_id: explanation.id, topic_id: topic.id };
}

async function cleanupSeededData(run: SeededRun | undefined) {
  if (!run) return;
  const supabase = getServiceClient();
  await supabase.from('content_evolution_variants').delete().eq('run_id', run.id);
  await supabase.from('content_evolution_runs').delete().eq('id', run.id);
  await supabase.from('explanations').delete().eq('id', run.explanation_id);
  await supabase.from('topics').delete().eq('id', run.topic_id);
}

// ─── Tests ───────────────────────────────────────────────────────

// Skip until evolution DB tables are migrated via GitHub Actions
adminTest.describe.skip('Admin Evolution Pipeline', () => {
  let seededRun: SeededRun;

  adminTest.beforeAll(async () => {
    seededRun = await seedEvolutionRun();
  });

  adminTest.afterAll(async () => {
    await cleanupSeededData(seededRun);
  });

  adminTest(
    'page loads with heading and runs table @critical',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/evolution');
      await adminPage.waitForLoadState('networkidle');

      // Heading
      await expect(adminPage.locator('h1')).toContainText('Content Evolution');

      // Runs table
      const table = adminPage.locator('[data-testid="evolution-runs-table"]');
      await expect(table).toBeVisible();
    },
  );

  adminTest(
    'status filter filters runs',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/evolution');
      await adminPage.waitForLoadState('networkidle');

      const statusFilter = adminPage.locator('[data-testid="evolution-status-filter"]');
      await statusFilter.selectOption('completed');

      // Wait for table to reload
      await adminPage.waitForLoadState('networkidle');

      // All visible status badges should show "completed"
      const statusBadges = adminPage.locator('[data-testid="evolution-runs-table"] tbody tr td:nth-child(2) span');
      const count = await statusBadges.count();
      for (let i = 0; i < count; i++) {
        await expect(statusBadges.nth(i)).toHaveText('completed');
      }
    },
  );

  adminTest(
    'queue dialog opens and closes',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/evolution');
      await adminPage.waitForLoadState('networkidle');

      // Open dialog
      const queueBtn = adminPage.locator('[data-testid="queue-evolution-btn"]');
      await queueBtn.click();

      // Dialog visible
      const dialog = adminPage.locator('[role="dialog"][aria-label="Queue evolution run"]');
      await expect(dialog).toBeVisible();

      // Close via Cancel
      await dialog.locator('button', { hasText: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
    },
  );

  adminTest(
    'variant panel opens when clicking Variants',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/evolution');
      await adminPage.waitForLoadState('networkidle');

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
      await adminPage.goto('/admin/quality/evolution');
      await adminPage.waitForLoadState('networkidle');

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
      await adminPage.goto('/admin/quality/evolution');
      await adminPage.waitForLoadState('networkidle');

      const dateFilter = adminPage.locator('[data-testid="evolution-date-filter"]');
      await expect(dateFilter).toBeVisible();

      // Should have date range options
      await dateFilter.selectOption('7d');
      await adminPage.waitForLoadState('networkidle');
    },
  );
});
