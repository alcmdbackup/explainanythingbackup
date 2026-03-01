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
  batchRunId: string;
  runId: string;
  roundId: string;
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

  // Create batch run
  const { data: batch, error: batchErr } = await supabase
    .from('evolution_batch_runs')
    .insert({ status: 'completed' })
    .select('id')
    .single();
  if (batchErr || !batch) throw new Error(`Failed to seed batch: ${batchErr?.message}`);

  // Create experiment
  const { data: experiment, error: experimentErr } = await supabase
    .from('evolution_experiments')
    .insert({
      name: '[TEST] E2E Experiment Detail',
      status: 'converged',
      optimization_target: 'elo',
      total_budget_usd: 50,
      spent_usd: 25,
      max_rounds: 3,
      current_round: 1,
      convergence_threshold: 10,
      factor_definitions: {
        genModel: { low: 'gpt-4.1-mini', high: 'gpt-4o' },
        iterations: { low: 3, high: 8 },
      },
      prompts: ['Explain photosynthesis'],
      results_summary: {
        bestElo: 1400,
        bestConfig: { model: 'gpt-4o' },
        terminationReason: 'converged',
        factorRanking: [{ factor: 'genModel', importance: 80 }],
        recommendations: ['Use gpt-4o'],
        report: {
          text: '## Executive Summary\nThe experiment converged successfully.\n\n## Key Findings\nModel selection is the dominant factor.',
          generatedAt: new Date().toISOString(),
          model: 'gpt-4.1-nano',
        },
      },
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (experimentErr || !experiment) throw new Error(`Failed to seed experiment: ${experimentErr?.message}`);

  // Create round
  const { data: round, error: roundErr } = await supabase
    .from('evolution_experiment_rounds')
    .insert({
      experiment_id: experiment.id,
      round_number: 1,
      type: 'screening',
      design: 'L8',
      status: 'completed',
      batch_run_id: batch.id,
      analysis_results: {
        mainEffects: { elo: { genModel: 120 } },
        factorRanking: [{ factor: 'genModel', importance: 80 }],
        recommendations: ['Use gpt-4o'],
      },
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (roundErr || !round) throw new Error(`Failed to seed round: ${roundErr?.message}`);

  // Create a completed run
  const { data: run, error: runErr } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: explanation.id,
      status: 'completed',
      batch_run_id: batch.id,
      budget_cap_usd: 5.0,
      total_cost_usd: 2.5,
      run_summary: { topVariants: [{ ordinal: 10 }] },
      config: { _experimentRow: 1, model: 'gpt-4o' },
    })
    .select('id')
    .single();
  if (runErr || !run) throw new Error(`Failed to seed run: ${runErr?.message}`);

  return {
    experimentId: experiment.id,
    topicId: topic.id,
    explanationId: explanation.id,
    batchRunId: batch.id,
    runId: run.id,
    roundId: round.id,
  };
}

async function cleanupSeededData(data: SeededExperiment | undefined) {
  if (!data) return;
  const supabase = getServiceClient();
  await supabase.from('evolution_runs').delete().eq('id', data.runId);
  await supabase.from('evolution_experiment_rounds').delete().eq('id', data.roundId);
  await supabase.from('evolution_experiments').delete().eq('id', data.experimentId);
  await supabase.from('evolution_batch_runs').delete().eq('id', data.batchRunId);
  await supabase.from('explanations').delete().eq('id', data.explanationId);
  await supabase.from('topics').delete().eq('id', data.topicId);
}

// ─── Tests ───────────────────────────────────────────────────────

// Skip until evolution DB tables are migrated via GitHub Actions
adminTest.describe.skip('Admin Experiment Detail Page', () => {
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
      await adminPage.goto('/admin/quality/optimization');
      // eslint-disable-next-line flakiness/no-networkidle -- batch migration
      await adminPage.waitForLoadState('networkidle');

      // Experiment History section should be visible
      await expect(adminPage.locator('text=Experiment History')).toBeVisible();

      // Truncated experiment ID should be visible
      const truncatedId = seededData.experimentId.slice(0, 8);
      await expect(adminPage.locator(`text=${truncatedId}`)).toBeVisible();

      // Click experiment name link to navigate to detail
      const link = adminPage.locator(
        `a[href*="/admin/quality/optimization/experiment/${seededData.experimentId}"]`,
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
        `/admin/quality/optimization/experiment/${seededData.experimentId}`,
      );
      // eslint-disable-next-line flakiness/no-networkidle -- batch migration
      await adminPage.waitForLoadState('networkidle');

      // Breadcrumb
      await expect(adminPage.locator('text=Rating Optimization')).toBeVisible();

      // Experiment name in overview
      await expect(adminPage.locator('text=[TEST] E2E Experiment Detail')).toBeVisible();

      // Status badge (converged)
      await expect(adminPage.locator('text=Converged')).toBeVisible();

      // Budget info
      await expect(adminPage.locator('text=$25.00')).toBeVisible();
    },
  );

  adminTest(
    'tab switching renders Rounds, Runs, Report tabs @critical',
    async ({ adminPage }) => {
      await adminPage.goto(
        `/admin/quality/optimization/experiment/${seededData.experimentId}`,
      );
      // eslint-disable-next-line flakiness/no-networkidle -- batch migration
      await adminPage.waitForLoadState('networkidle');

      // Rounds tab should be default
      const roundsTab = adminPage.locator('button', { hasText: 'Rounds' });
      const runsTab = adminPage.locator('button', { hasText: 'Runs' });
      const reportTab = adminPage.locator('button', { hasText: 'Report' });

      await expect(roundsTab).toBeVisible();
      await expect(runsTab).toBeVisible();
      await expect(reportTab).toBeVisible();

      // Rounds tab content should show round 1
      await expect(adminPage.locator('text=Round 1')).toBeVisible();

      // Switch to Runs tab
      await runsTab.click();
      // eslint-disable-next-line flakiness/no-networkidle -- batch migration
      await adminPage.waitForLoadState('networkidle');
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
        `/admin/quality/optimization/experiment/${seededData.experimentId}`,
      );
      // eslint-disable-next-line flakiness/no-networkidle -- batch migration
      await adminPage.waitForLoadState('networkidle');

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
    'returns 404 for non-existent experiment',
    async ({ adminPage }) => {
      const response = await adminPage.goto(
        '/admin/quality/optimization/experiment/00000000-0000-0000-0000-000000000000',
      );
      expect(response?.status()).toBe(404);
    },
  );
});
