/**
 * Admin arena E2E tests (post arena-consolidation: data now on evolution_variants).
 * Tests topic list page render with seeded data.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Test data seeding helpers ───────────────────────────────────

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface SeededArenaData {
  topicId: string;
  entryOneshotId: string;
  entryEvolutionId: string;
  /** UX 3 (20260421): seed variant surfaced in the ArenaSeedPanel at top of page. */
  entrySeedId: string;
  eloOneshotId: string;
  eloEvolutionId: string;
  /** Optional: set when a companion evolution run is created for source link tests */
  evolutionRunId?: string;
}

async function seedArenaData(): Promise<SeededArenaData> {
  const supabase = getServiceClient();
  const ts = Date.now();

  // 1. Create topic (use timestamp to avoid unique constraint collision on retries)
  const { data: topic, error: topicError } = await supabase
    .from('evolution_prompts')
    .insert({
      prompt: `[TEST] Arena E2E Topic ${ts}`,
      name: `E2E Test Topic ${ts}`,
    })
    .select('id')
    .single();

  if (topicError || !topic) throw new Error(`Failed to seed topic: ${topicError?.message}`);

  // 2. Create a companion evolution run so the evolution entry has a valid source link
  const { data: dummyTopic, error: topicErr } = await supabase
    .from('topics')
    .insert({ topic_title: `[TEST] Arena Source Link Topic ${ts}`, topic_description: 'temp' })
    .select('id')
    .single();
  if (topicErr || !dummyTopic) throw new Error(`Failed to seed dummy topic: ${topicErr?.message}`);

  const { data: dummyExplanation, error: explErr } = await supabase
    .from('explanations')
    .insert({
      explanation_title: `[TEST] Arena Source Link Article ${ts}`,
      content: 'placeholder',
      status: 'published',
      primary_topic_id: dummyTopic.id,
    })
    .select('id')
    .single();
  if (explErr || !dummyExplanation) throw new Error(`Failed to seed dummy explanation: ${explErr?.message}`);

  let evolutionRunId: string | undefined;

  if (dummyExplanation) {
    // Create a strategy for the evolution run (strategy_id is a required UUID FK)
    const { data: strategy, error: stratErr } = await supabase
      .from('evolution_strategies')
      .insert({
        name: `[TEST] Arena Strategy ${Date.now()}`,
        label: 'test',
        config: { generationModel: 'test', judgeModel: 'test', iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }] },
        config_hash: `test-arena-${Date.now()}`,
        created_by: 'e2e-test',
      })
      .select('id')
      .single();
    if (stratErr || !strategy) throw new Error(`Failed to seed strategy: ${stratErr?.message}`);

    const { data: run } = await supabase
      .from('evolution_runs')
      .insert({
        explanation_id: dummyExplanation.id,
        status: 'completed',
        strategy_id: strategy.id,
        pipeline_version: 'v2',
        budget_cap_usd: 3.0,
        run_summary: { totalCostUsd: 1.20, totalVariants: 3 },
        created_at: new Date(Date.now() - 120000).toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    evolutionRunId = run?.id;
  }

  // 3. Create two entries with inline Elo (V2: no separate elo table)
  const { data: entryOneshot, error: e1 } = await supabase
    .from('evolution_variants')
    .insert({
      prompt_id: topic.id,
      synced_to_arena: true,
      variant_content: 'This is a one-shot generated article for E2E testing. It covers basic concepts in quantum computing.',
      generation_method: 'oneshot',
      model: 'gpt-4.1-mini',
      cost_usd: 0.0042,
      elo_score: 1180,
      mu: 23,
      sigma: 7.5,
      arena_match_count: 3,
    })
    .select('id')
    .single();

  if (e1 || !entryOneshot) throw new Error(`Failed to seed oneshot entry: ${e1?.message}`);

  const { data: entryEvolution, error: e2 } = await supabase
    .from('evolution_variants')
    .insert({
      prompt_id: topic.id,
      synced_to_arena: true,
      variant_content: 'This is an evolution-winner article for E2E testing. It explains quantum entanglement clearly.',
      generation_method: 'evolution_winner',
      model: 'structural_transform',
      cost_usd: 0.0185,
      run_id: evolutionRunId ?? null,
      elo_score: 1320,
      mu: 28,
      sigma: 6.5,
      arena_match_count: 3,
    })
    .select('id')
    .single();

  if (e2 || !entryEvolution) throw new Error(`Failed to seed evolution entry: ${e2?.message}`);

  // UX 3 (20260421): Seed a generation_method='seed' variant so the ArenaSeedPanel
  // at the top of the topic page has something to render. Explicit numeric values
  // for elo_score/mu/sigma/arena_match_count ensure deterministic panel rendering.
  const { data: entrySeed, error: e3 } = await supabase
    .from('evolution_variants')
    .insert({
      prompt_id: topic.id,
      synced_to_arena: true,
      variant_content: '# Seed article\n\nThis is the seed variant for the E2E topic.',
      generation_method: 'seed',
      model: null,
      cost_usd: null,
      elo_score: 1200,
      mu: 25,
      sigma: 8.333,
      arena_match_count: 0,
    })
    .select('id')
    .single();
  if (e3 || !entrySeed) throw new Error(`Failed to seed seed entry: ${e3?.message}`);

  return {
    topicId: topic.id,
    entryOneshotId: entryOneshot.id,
    entryEvolutionId: entryEvolution.id,
    entrySeedId: entrySeed.id,
    eloOneshotId: entryOneshot.id,
    eloEvolutionId: entryEvolution.id,
    evolutionRunId,
  };
}

async function cleanupArenaData(data: SeededArenaData | undefined) {
  if (!data) return;
  const supabase = getServiceClient();

  // Delete in reverse dependency order (V2: no separate elo table)
  const { error: e1 } = await supabase.from('evolution_arena_comparisons').delete().eq('prompt_id', data.topicId);
  if (e1) console.warn(`[cleanup] Failed to delete from evolution_arena_comparisons: ${e1.message}`);
  const { error: e3 } = await supabase.from('evolution_variants').delete().eq('prompt_id', data.topicId);
  if (e3) console.warn(`[cleanup] Failed to delete arena variants from evolution_variants: ${e3.message}`);
  const { error: e4 } = await supabase.from('evolution_prompts').delete().eq('id', data.topicId);
  if (e4) console.warn(`[cleanup] Failed to delete from evolution_prompts: ${e4.message}`);

  // Clean up companion evolution data if created
  if (data.evolutionRunId) {
    const { error: e5 } = await supabase.from('evolution_variants').delete().eq('run_id', data.evolutionRunId);
    if (e5) console.warn(`[cleanup] Failed to delete from evolution_variants: ${e5.message}`);
    const { data: run } = await supabase
      .from('evolution_runs')
      .select('explanation_id')
      .eq('id', data.evolutionRunId)
      .single();

    const { error: e6 } = await supabase.from('evolution_runs').delete().eq('id', data.evolutionRunId);
    if (e6) console.warn(`[cleanup] Failed to delete from evolution_runs: ${e6.message}`);

    if (run?.explanation_id) {
      const { data: exp } = await supabase
        .from('explanations')
        .select('primary_topic_id')
        .eq('id', run.explanation_id)
        .single();

      const { error: e7 } = await supabase.from('explanations').delete().eq('id', run.explanation_id);
      if (e7) console.warn(`[cleanup] Failed to delete from explanations: ${e7.message}`);
      if (exp?.primary_topic_id) {
        const { error: e8 } = await supabase.from('topics').delete().eq('id', exp.primary_topic_id);
        if (e8) console.warn(`[cleanup] Failed to delete from topics: ${e8.message}`);
      }
    }
  }
}

// ─── Tests ───────────────────────────────────────────────────────

adminTest.describe('Admin Arena', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let seededData: SeededArenaData;

  adminTest.beforeAll(async () => {
    seededData = await seedArenaData();
  });

  adminTest.afterAll(async () => {
    await cleanupArenaData(seededData);
  });

  adminTest(
    'topic list page renders with cross-topic summary cards',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/arena');
      await adminPage.waitForLoadState('domcontentloaded');

      // Page heading
      await expect(adminPage.locator('h1')).toContainText('Arena', { timeout: 15000 });

      // Phase 1 of use_playwright_find_bugs_ux_issues_20260422 added an
      // is_test_content column + trigger to evolution_prompts. The trigger marks
      // the seeded "[TEST] Arena" topic as is_test_content=true and the arena
      // topics list "Hide test content" filter is default-on. Uncheck it.
      const filter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
      // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
      if (await filter.isChecked()) await filter.uncheck();

      // Topics table renders (EntityListPage uses entity-list-table testid)
      const topicsTable = adminPage.locator('[data-testid="entity-list-table"]');
      await expect(topicsTable).toBeVisible({ timeout: 20000 });

      // Our seeded topic row should appear (identified by link to topic detail page)
      await expect(adminPage.locator(`a[href*="/admin/evolution/arena/${seededData.topicId}"]`).first()).toBeVisible({ timeout: 10000 });
    },
  );

  adminTest(
    'topic detail page renders ArenaSeedPanel (UX 3) + variant ID column (UX 4)',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/evolution/arena/${seededData.topicId}`);
      await adminPage.waitForLoadState('domcontentloaded');

      // UX 3: seed panel at the top with correct link target to the seed variant.
      const seedPanel = adminPage.locator('[data-testid="arena-seed-panel"]');
      await expect(seedPanel).toBeVisible({ timeout: 20000 });
      const seedLink = adminPage.locator('[data-testid="arena-seed-panel-link"]');
      await expect(seedLink).toHaveAttribute('href', `/admin/evolution/variants/${seededData.entrySeedId}`);

      // UX 3 inline indicator: seed row still present in leaderboard body with a
      // strengthened star+pill indicator.
      const leaderboard = adminPage.locator('[data-testid="leaderboard-table"]');
      await expect(leaderboard).toBeVisible();
      const seedRowIndicator = adminPage.locator('[data-testid="lb-seed-row-indicator"]');
      await expect(seedRowIndicator).toBeVisible();
      await expect(seedRowIndicator).toContainText(/seed/i);

      // UX 4: every row has an ID cell with the full UUID in its title attribute.
      const idCells = adminPage.locator('[data-testid="lb-variant-id"]');
      await expect(idCells.first()).toBeVisible();
      const firstId = await idCells.first().getAttribute('title');
      expect(firstId).toBeTruthy();
      expect(firstId).toMatch(/[0-9a-f-]{36}/);
    },
  );
});
