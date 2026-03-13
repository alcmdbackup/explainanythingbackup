/**
 * Admin Experiment Detail page E2E tests.
 * Tests experiment history links, detail page load, tab navigation, and overview card.
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

interface SeededExperiment {
  experimentId: string;
  topicId: number;
  explanationId: number;
  runId: string;
  arenaTopicId: string;
}

async function seedExperimentData(): Promise<SeededExperiment> {
  const supabase = getServiceClient();

  // Create topic + explanation for runs
  const { data: topic, error: topicErr } = await supabase
    .from('topics')
    .insert({ topic_title: '[TEST] Experiment Detail E2E', topic_description: 'E2E test.' })
    .select('id')
    .single();
  if (topicErr || !topic) throw new Error(`Failed to seed topic: ${topicErr?.message}`);

  const { data: explanation, error: expErr } = await supabase
    .from('explanations')
    .insert({
      explanation_title: '[TEST] Experiment Detail Article',
      content: 'Test content.',
      status: 'published',
      primary_topic_id: topic.id,
    })
    .select('id')
    .single();
  if (expErr || !explanation) throw new Error(`Failed to seed explanation: ${expErr?.message}`);

  // Create arena topic for prompt FK
  const { data: arenaTopic, error: arenaErr } = await supabase
    .from('evolution_arena_topics')
    .insert({ prompt: 'Explain photosynthesis', title: '[TEST] Photosynthesis' })
    .select('id')
    .single();
  if (arenaErr || !arenaTopic) throw new Error(`Failed to seed arena topic: ${arenaErr?.message}`);

  // Create experiment
  const { data: experiment, error: experimentErr } = await supabase
    .from('evolution_experiments')
    .insert({
      name: '[TEST] E2E Experiment Detail',
      status: 'completed',
      total_budget_usd: 50,
      spent_usd: 25,
      convergence_threshold: 10,
      design: 'manual',
      factor_definitions: {},
      prompt_id: arenaTopic.id,
      analysis_results: {
        mainEffects: { elo: { genModel: 120 } },
        factorRanking: [{ factor: 'genModel', importance: 80 }],
        recommendations: ['Use gpt-4o'],
      },
      results_summary: {
        bestElo: 1400,
        bestConfig: { model: 'gpt-4o' },
        terminationReason: 'completed',
        factorRanking: [{ factor: 'genModel', importance: 80 }],
        recommendations: ['Use gpt-4o'],
        report: {
          text: '## Executive Summary\nThe experiment completed successfully.\n\n## Key Findings\nModel selection is the dominant factor.',
          generatedAt: new Date().toISOString(),
          model: 'gpt-4.1-nano',
        },
      },
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (experimentErr || !experiment) throw new Error(`Failed to seed experiment: ${experimentErr?.message}`);

  // Create a completed run linked to experiment
  const { data: run, error: runErr } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: explanation.id,
      status: 'completed',
      experiment_id: experiment.id,
      budget_cap_usd: 5.0,
      total_cost_usd: 2.5,
      run_summary: { topVariants: [{ mu: 10 }] },
      config: { _experimentRow: 1, model: 'gpt-4o' },
    })
    .select('id')
    .single();
  if (runErr || !run) throw new Error(`Failed to seed run: ${runErr?.message}`);

  return {
    experimentId: experiment.id,
    topicId: topic.id,
    explanationId: explanation.id,
    runId: run.id,
    arenaTopicId: arenaTopic.id,
  };
}

async function cleanupSeededData(data: SeededExperiment | undefined) {
  if (!data) return;
  const supabase = getServiceClient();
  const { error: e1 } = await supabase.from('evolution_runs').delete().eq('id', data.runId);
  if (e1) console.warn(`[cleanup] Failed to delete from evolution_runs: ${e1.message}`);
  const { error: e2 } = await supabase.from('evolution_experiments').delete().eq('id', data.experimentId);
  if (e2) console.warn(`[cleanup] Failed to delete from evolution_experiments: ${e2.message}`);
  const { error: e3 } = await supabase.from('explanations').delete().eq('id', data.explanationId);
  if (e3) console.warn(`[cleanup] Failed to delete from explanations: ${e3.message}`);
  const { error: e4 } = await supabase.from('topics').delete().eq('id', data.topicId);
  if (e4) console.warn(`[cleanup] Failed to delete from topics: ${e4.message}`);
  const { error: e5 } = await supabase.from('evolution_arena_topics').delete().eq('id', data.arenaTopicId);
  if (e5) console.warn(`[cleanup] Failed to delete from evolution_arena_topics: ${e5.message}`);
}

// ─── Tests ───────────────────────────────────────────────────────

// Skip until evolution DB tables are migrated via GitHub Actions
adminTest.describe.skip('Admin Experiment Detail Page', { tag: '@evolution' }, () => {
  let seededData: SeededExperiment;

  adminTest.beforeAll(async () => {
    seededData = await seedExperimentData();
  });

  adminTest.afterAll(async () => {
    await cleanupSeededData(seededData);
  });

  adminTest(
    'experiment history shows ID and links to detail page @critical',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/analysis');
      // eslint-disable-next-line flakiness/no-networkidle -- experiment migration
      await adminPage.waitForLoadState('networkidle');

      // Experiment History section should be visible
      await expect(adminPage.locator('text=Experiment History')).toBeVisible();

      // Truncated experiment ID should be visible
      const truncatedId = seededData.experimentId.slice(0, 8);
      await expect(adminPage.locator(`text=${truncatedId}`)).toBeVisible();

      // Click experiment name link to navigate to detail
      const link = adminPage.locator(
        `a[href*="/admin/evolution/experiments/${seededData.experimentId}"]`,
      );
      await expect(link).toBeVisible();
      await link.click();
      await adminPage.waitForURL(`**/experiment/${seededData.experimentId}`);
    },
  );

  adminTest(
    'detail page loads with overview card @critical',
    async ({ adminPage }) => {
      await adminPage.goto(
        `/admin/evolution/experiments/${seededData.experimentId}`,
      );
      await adminPage.waitForLoadState('domcontentloaded');

      // Breadcrumb
      await expect(adminPage.locator('text=Analysis')).toBeVisible();

      // Experiment name in overview
      await expect(adminPage.locator('text=[TEST] E2E Experiment Detail')).toBeVisible();

      // Status badge (completed)
      await expect(adminPage.locator('text=Completed')).toBeVisible();

      // Budget info
      await expect(adminPage.locator('text=$25.00')).toBeVisible();
    },
  );

  adminTest(
    'tab switching renders Analysis, Runs, Report tabs @critical',
    async ({ adminPage }) => {
      await adminPage.goto(
        `/admin/evolution/experiments/${seededData.experimentId}`,
      );
      await adminPage.waitForLoadState('domcontentloaded');
      await expect(adminPage.locator('button', { hasText: 'Analysis' })).toBeVisible();

      // Analysis tab should be default
      const analysisTab = adminPage.locator('button', { hasText: 'Analysis' });
      const runsTab = adminPage.locator('button', { hasText: 'Runs' });
      const reportTab = adminPage.locator('button', { hasText: 'Report' });

      await expect(analysisTab).toBeVisible();
      await expect(runsTab).toBeVisible();
      await expect(reportTab).toBeVisible();

      // Switch to Runs tab
      await runsTab.click();
      await expect(adminPage.locator('th:has-text("Run ID")')).toBeVisible();

      // Switch to Report tab
      await reportTab.click();
      await expect(adminPage.locator('text=Executive Summary')).toBeVisible();
    },
  );

  adminTest(
    'report tab shows generated report with metadata',
    async ({ adminPage }) => {
      await adminPage.goto(
        `/admin/evolution/experiments/${seededData.experimentId}`,
      );
      await adminPage.waitForLoadState('domcontentloaded');
      await expect(adminPage.locator('text=Analysis')).toBeVisible();

      // Navigate to Report tab
      const reportTab = adminPage.locator('button', { hasText: 'Report' });
      await reportTab.click();

      // Report content
      await expect(adminPage.locator('text=Executive Summary')).toBeVisible();
      await expect(adminPage.locator('text=Key Findings')).toBeVisible();

      // Model metadata
      await expect(adminPage.locator('text=gpt-4.1-nano')).toBeVisible();

      // Regenerate button
      await expect(adminPage.locator('button', { hasText: 'Regenerate' })).toBeVisible();
    },
  );

  adminTest(
    'analysis tab shows metrics table with per-run data @critical',
    async ({ adminPage }) => {
      await adminPage.goto(
        `/admin/evolution/experiments/${seededData.experimentId}`,
      );
      await adminPage.waitForLoadState('domcontentloaded');

      // Analysis tab is default — should show metrics section
      const analysisTab = adminPage.locator('button', { hasText: 'Analysis' });
      await analysisTab.click();

      // Metrics table should render (or fallback to legacy view)
      // Look for either the new metrics table headers or the legacy analysis view
      const metricsOrLegacy = adminPage.locator(
        'th:has-text("Variants"), th:has-text("Median Elo"), text=Main Effects',
      );
      await expect(metricsOrLegacy.first()).toBeVisible({ timeout: 10000 });
    },
  );

  adminTest(
    'returns 404 for non-existent experiment',
    async ({ adminPage }) => {
      const response = await adminPage.goto(
        '/admin/evolution/experiments/00000000-0000-0000-0000-000000000000',
      );
      expect(response?.status()).toBe(404);
    },
  );
});
