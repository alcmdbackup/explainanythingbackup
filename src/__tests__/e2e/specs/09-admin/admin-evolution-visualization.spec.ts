/**
 * Admin evolution visualization E2E tests.
 * Tests dashboard, run detail tabs, and compare page navigation.
 * Tests dashboard, run detail tabs, and compare page navigation.
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

interface SeededVizData {
  runId: string;
  explanationId: number;
  topicId: number;
}

async function seedVisualizationData(): Promise<SeededVizData> {
  const supabase = getServiceClient();

  // Create test topic
  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .insert({
      topic_title: '[TEST] Evolution Viz E2E Topic',
      topic_description: 'Test topic for evolution visualization E2E.',
    })
    .select('id')
    .single();

  if (topicError || !topic) throw new Error(`Failed to seed topic: ${topicError?.message}`);

  // Create test explanation
  const { data: explanation, error: expError } = await supabase
    .from('explanations')
    .insert({
      explanation_title: '[TEST] Evolution Viz E2E Article',
      content: 'Original content for evolution visualization testing.',
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
      phase: 'COMPETITION',
      current_iteration: 3,
      budget_cap_usd: 5.0,
      total_cost_usd: 2.50,
      total_variants: 4,
      started_at: new Date(Date.now() - 300000).toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (runError || !run) throw new Error(`Failed to seed run: ${runError?.message}`);

  // Seed variants
  await supabase.from('evolution_variants').insert([
    { run_id: run.id, explanation_id: explanation.id, variant_content: 'Winner variant text', elo_score: 1350, generation: 2, agent_name: 'structural_transform', match_count: 8, is_winner: true },
    { run_id: run.id, explanation_id: explanation.id, variant_content: 'Runner-up text', elo_score: 1250, generation: 1, agent_name: 'lexical_simplify', match_count: 6 },
    { run_id: run.id, explanation_id: explanation.id, variant_content: 'Third variant', elo_score: 1150, generation: 1, agent_name: 'grounding_enhance', match_count: 5 },
  ]);

  // Seed checkpoint with state_snapshot (raw JSON, not via TypeScript types)
  await supabase.from('evolution_checkpoints').insert({
    run_id: run.id,
    iteration: 3,
    last_agent: 'evaluation_agent',
    state_snapshot: {
      iteration: 3,
      originalText: 'Original content for evolution visualization testing.',
      pool: [
        { id: 'v1', text: 'Winner variant text', version: 2, parentIds: [], strategy: 'structural_transform', createdAt: Date.now(), iterationBorn: 1 },
        { id: 'v2', text: 'Runner-up text', version: 1, parentIds: ['v1'], strategy: 'lexical_simplify', createdAt: Date.now(), iterationBorn: 2 },
        { id: 'v3', text: 'Third variant', version: 1, parentIds: [], strategy: 'grounding_enhance', createdAt: Date.now(), iterationBorn: 1 },
      ],
      eloRatings: { v1: 1350, v2: 1250, v3: 1150 },
      matchCounts: { v1: 8, v2: 6, v3: 5 },
      matchHistory: [],
      newEntrantsThisIteration: [],
      dimensionScores: null,
      allCritiques: null,
      similarityMatrix: null,
      diversityScore: null,
      metaFeedback: null,
      debateTranscripts: [],
    },
  });

  return { runId: run.id, explanationId: explanation.id, topicId: topic.id };
}

async function cleanupVisualizationData(data: SeededVizData | undefined) {
  if (!data) return;
  const supabase = getServiceClient();
  const { error: e1 } = await supabase.from('evolution_checkpoints').delete().eq('run_id', data.runId);
  if (e1) console.warn(`[cleanup] Failed to delete from evolution_checkpoints: ${e1.message}`);
  const { error: e2 } = await supabase.from('evolution_variants').delete().eq('run_id', data.runId);
  if (e2) console.warn(`[cleanup] Failed to delete from evolution_variants: ${e2.message}`);
  const { error: e3 } = await supabase.from('evolution_runs').delete().eq('id', data.runId);
  if (e3) console.warn(`[cleanup] Failed to delete from evolution_runs: ${e3.message}`);
  const { error: e4 } = await supabase.from('explanations').delete().eq('id', data.explanationId);
  if (e4) console.warn(`[cleanup] Failed to delete from explanations: ${e4.message}`);
  const { error: e5 } = await supabase.from('topics').delete().eq('id', data.topicId);
  if (e5) console.warn(`[cleanup] Failed to delete from topics: ${e5.message}`);
}

// ─── Tests ───────────────────────────────────────────────────────

adminTest.describe('Admin Evolution Visualization', { tag: '@evolution' }, () => {
  let seededData: SeededVizData;

  adminTest.beforeAll(async () => {
    seededData = await seedVisualizationData();
  });

  adminTest.afterAll(async () => {
    await cleanupVisualizationData(seededData);
  });

  adminTest(
    'dashboard page loads with stat cards',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/evolution/dashboard');
      await adminPage.waitForLoadState('domcontentloaded');

      // Heading
      await expect(adminPage.locator('h1')).toContainText('Evolution Dashboard');

      // Stat cards
      const statCards = adminPage.locator('[data-testid^="stat-card-"]');
      await expect(statCards.first()).toBeVisible();
    },
  );

  adminTest(
    'run detail page loads with tab bar',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/run/${seededData.runId}`);
      await adminPage.waitForLoadState('domcontentloaded');

      // Tab bar buttons (5 tabs after Budget→Timeline and Tree→Lineage merge)
      await expect(adminPage.locator('button:has-text("Timeline")')).toBeVisible();
      await expect(adminPage.locator('button:has-text("Elo")')).toBeVisible();
      await expect(adminPage.locator('button:has-text("Lineage")')).toBeVisible();
      await expect(adminPage.locator('button:has-text("Variants")')).toBeVisible();
      await expect(adminPage.locator('button:has-text("Logs")')).toBeVisible();
      // Budget content is now within Timeline tab
      await expect(adminPage.locator('[data-testid="budget-tab"]')).toBeVisible();
    },
  );

  adminTest(
    'switching tabs loads tab content',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/run/${seededData.runId}`);
      await adminPage.waitForLoadState('domcontentloaded');

      // Click Elo tab
      await adminPage.locator('button:has-text("Elo")').click();
      await expect(adminPage.locator('[data-testid="elo-tab"]')).toBeVisible();

      // Click Variants tab
      await adminPage.locator('button:has-text("Variants")').click();
      await expect(adminPage.locator('[data-testid="variants-tab"]')).toBeVisible();
    },
  );

  adminTest(
    'compare page renders diff section',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/run/${seededData.runId}/compare`);
      await adminPage.waitForLoadState('domcontentloaded');

      // Heading
      await expect(adminPage.locator('h1')).toContainText('Before / After Comparison');

      // Diff section
      await expect(adminPage.locator('[data-testid="diff-section"]')).toBeVisible();

      // Stats section
      await expect(adminPage.locator('[data-testid="stats-section"]')).toBeVisible();
    },
  );

  adminTest(
    'lineage tab renders D3 SVG nodes',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/run/${seededData.runId}`);
      await adminPage.waitForLoadState('domcontentloaded');

      // Click Lineage tab
      await adminPage.locator('button:has-text("Lineage")').click();

      // Wait for SVG container
      const graph = adminPage.locator('[data-testid="lineage-graph"]');
      await expect(graph).toBeVisible();

      // D3 renders nodes with data-testid attributes
      const nodes = adminPage.locator('[data-testid^="lineage-node-"]');
      // Should have at least one node rendered by D3
      await expect(nodes.first()).toBeVisible({ timeout: 10000 });
    },
  );

  adminTest(
    'timeline tab displays agents per iteration',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/run/${seededData.runId}`);
      await adminPage.waitForLoadState('domcontentloaded');

      // Timeline tab is default, verify agent rows are visible
      const iteration = adminPage.locator('[data-testid^="iteration-"]').first();
      await expect(iteration).toBeVisible();

      // Should show agent rows within iteration
      const agentRows = adminPage.locator('[data-testid^="agent-row-"]');
      await expect(agentRows.first()).toBeVisible();
    },
  );

  adminTest(
    'timeline tab expands agent detail panel on click',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/run/${seededData.runId}`);
      await adminPage.waitForLoadState('domcontentloaded');

      // Click first agent row
      const agentRow = adminPage.locator('[data-testid^="agent-row-"]').first();
      await agentRow.click();

      // Verify detail panel expands with metrics
      await expect(adminPage.locator('text=Variants Added')).toBeVisible();
      await expect(adminPage.locator('text=Matches Played')).toBeVisible();
      await expect(adminPage.locator('text=Cost')).toBeVisible();
    },
  );
});
