/**
 * Admin article detail + variant detail E2E tests.
 * Tests explanation detail page, variant detail page, and bidirectional navigation.
 * Tests explanation detail page, variant detail page, and bidirectional navigation.
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

interface SeededData {
  runId1: string;
  runId2: string;
  explanationId: number;
  topicId: number;
  winnerId1: string;
  parentId: string;
  childId: string;
}

async function cleanupExistingTestData(supabase: ReturnType<typeof getServiceClient>) {
  // Clean up leftover data from previous failed runs (reverse FK order)
  const { data: oldTopics } = await supabase
    .from('topics')
    .select('id')
    .eq('topic_title', '[TEST] Article Detail E2E Topic');

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

async function seedArticleDetailData(): Promise<SeededData> {
  const supabase = getServiceClient();

  // Clean up leftover data from previous failed runs
  await cleanupExistingTestData(supabase);

  const { data: topic } = await supabase
    .from('topics')
    .insert({ topic_title: '[TEST] Article Detail E2E Topic', topic_description: 'Test.' })
    .select('id')
    .single();
  if (!topic) throw new Error('Failed to seed topic');

  const { data: explanation } = await supabase
    .from('explanations')
    .insert({
      explanation_title: '[TEST] Article Detail E2E',
      content: 'Original text for article detail testing.',
      status: 'published',
      primary_topic_id: topic.id,
    })
    .select('id')
    .single();
  if (!explanation) throw new Error('Failed to seed explanation');

  // Run 1 (completed)
  const { data: run1 } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: explanation.id,
      status: 'completed',
      phase: 'COMPETITION',
      current_iteration: 3,
      budget_cap_usd: 5.0,
      total_cost_usd: 2.0,
      total_variants: 3,
      started_at: new Date(Date.now() - 600000).toISOString(),
      completed_at: new Date(Date.now() - 300000).toISOString(),
    })
    .select('id')
    .single();
  if (!run1) throw new Error('Failed to seed run1');

  // Run 2 (completed)
  const { data: run2 } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: explanation.id,
      status: 'completed',
      phase: 'COMPETITION',
      current_iteration: 2,
      budget_cap_usd: 3.0,
      total_cost_usd: 1.5,
      total_variants: 2,
      started_at: new Date(Date.now() - 200000).toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (!run2) throw new Error('Failed to seed run2');

  // Seed variants with parent chain
  const parentId = crypto.randomUUID();
  const winnerId1 = crypto.randomUUID();
  const childId = crypto.randomUUID();

  await supabase.from('evolution_variants').insert([
    {
      id: parentId,
      run_id: run1.id,
      explanation_id: explanation.id,
      variant_content: 'Parent variant original text for testing.',
      elo_score: 1200,
      generation: 0,
      agent_name: 'original_baseline',
      match_count: 4,
      is_winner: false,
      elo_attribution: { gain: 0, ci: 0, zScore: 0, deltaMu: 0, sigmaDelta: 0 },
    },
    {
      id: winnerId1,
      run_id: run1.id,
      explanation_id: explanation.id,
      variant_content: 'Winner variant improved text.',
      elo_score: 1400,
      generation: 1,
      agent_name: 'structural_transform',
      match_count: 8,
      is_winner: true,
      parent_variant_id: parentId,
      elo_attribution: { gain: 80, ci: 50, zScore: 2.5, deltaMu: 5, sigmaDelta: 2 },
    },
    {
      id: childId,
      run_id: run1.id,
      explanation_id: explanation.id,
      variant_content: 'Child variant refined text.',
      elo_score: 1300,
      generation: 2,
      agent_name: 'critique_edit_clarity',
      match_count: 6,
      is_winner: false,
      parent_variant_id: winnerId1,
      elo_attribution: { gain: -40, ci: 45, zScore: -0.8, deltaMu: -2.5, sigmaDelta: 3 },
    },
  ]);

  // Run 2 variants
  await supabase.from('evolution_variants').insert([
    {
      run_id: run2.id,
      explanation_id: explanation.id,
      variant_content: 'Run 2 variant text.',
      elo_score: 1350,
      generation: 1,
      agent_name: 'lexical_simplify',
      match_count: 5,
      is_winner: true,
    },
  ]);

  return {
    runId1: run1.id,
    runId2: run2.id,
    explanationId: explanation.id,
    topicId: topic.id,
    winnerId1,
    parentId,
    childId,
  };
}

async function cleanupData(data: SeededData | undefined) {
  if (!data) return;
  const supabase = getServiceClient();
  // Reverse FK order
  await supabase.from('evolution_variants').delete().eq('run_id', data.runId1);
  await supabase.from('evolution_variants').delete().eq('run_id', data.runId2);
  await supabase.from('evolution_runs').delete().eq('id', data.runId1);
  await supabase.from('evolution_runs').delete().eq('id', data.runId2);
  await supabase.from('explanations').delete().eq('id', data.explanationId);
  await supabase.from('topics').delete().eq('id', data.topicId);
}

// ─── Tests ───────────────────────────────────────────────────────

adminTest.describe('Admin Article & Variant Detail', () => {
  let seeded: SeededData;

  adminTest.beforeAll(async () => {
    seeded = await seedArticleDetailData();
  });

  adminTest.afterAll(async () => {
    await cleanupData(seeded);
  });

  adminTest(
    'article detail page loads with overview card',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/article/${seeded.explanationId}`);
      await expect(adminPage.getByTestId('article-overview-card')).toBeVisible();
      await expect(adminPage.getByText('[TEST] Article Detail E2E')).toBeVisible();
    },
  );

  adminTest(
    'article detail shows runs tab with both runs',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/article/${seeded.explanationId}`);
      await expect(adminPage.getByTestId('article-runs-timeline')).toBeVisible();
      const runCards = adminPage.getByTestId('article-run-card');
      await expect(runCards).toHaveCount(2);
    },
  );

  adminTest(
    'article detail variants tab shows all variants',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/article/${seeded.explanationId}`);
      await adminPage.getByText('Variants').click();
      await expect(adminPage.getByTestId('article-variants-list')).toBeVisible();
    },
  );

  adminTest(
    'variant detail page loads with overview card',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/variant/${seeded.winnerId1}`);
      await expect(adminPage.getByTestId('variant-overview-card')).toBeVisible();
      await expect(adminPage.getByTestId('variant-stats')).toBeVisible();
    },
  );

  adminTest(
    'variant detail shows attribution badge for winner',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/variant/${seeded.winnerId1}`);
      await expect(adminPage.getByText('+80')).toBeVisible();
    },
  );

  adminTest(
    'variant detail shows content section',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/variant/${seeded.winnerId1}`);
      await expect(adminPage.getByTestId('variant-content-section')).toBeVisible();
      await expect(adminPage.getByText('Winner variant improved text.')).toBeVisible();
    },
  );

  adminTest(
    'variant detail shows lineage with parent and children',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/variant/${seeded.winnerId1}`);
      await expect(adminPage.getByTestId('variant-lineage-section')).toBeVisible();
      // Should show parent
      await expect(adminPage.getByText('Parent')).toBeVisible();
      // Should show children
      await expect(adminPage.getByText(/Children/)).toBeVisible();
    },
  );

  adminTest(
    'breadcrumb navigates from variant to article to evolution',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/variant/${seeded.winnerId1}`);
      const breadcrumb = adminPage.getByTestId('evolution-breadcrumb');
      await expect(breadcrumb).toBeVisible();
      // Should contain article link
      await expect(breadcrumb.getByText('[TEST] Article Detail E2E')).toBeVisible();
      // Should contain Evolution link
      await expect(breadcrumb.getByText('Evolution')).toBeVisible();
    },
  );

  adminTest(
    'variant detail "Article History" link navigates to article page',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/evolution/variant/${seeded.winnerId1}`);
      await adminPage.getByText('Article History').click();
      await expect(adminPage).toHaveURL(new RegExp(`/article/${seeded.explanationId}`));
      await expect(adminPage.getByTestId('article-overview-card')).toBeVisible();
    },
  );
});
