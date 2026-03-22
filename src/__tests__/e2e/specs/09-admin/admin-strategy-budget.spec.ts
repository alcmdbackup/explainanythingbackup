/**
 * Admin Strategy Budget Cap E2E tests.
 * Tests budget cap input on the strategy form and budget tier filter on the arena topic page.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ─── Seed helpers ───────────────────────────────────────────────

async function seedStrategyWithBudget(): Promise<{ id: string }> {
  const supabase = getServiceClient();
  const ts = Date.now();
  const { data, error } = await supabase
    .from('evolution_strategies')
    .insert({
      config_hash: `e2e-budget-${ts}`,
      name: `[TEST] Budget Strategy ${ts}`,
      label: 'Gen: test | Judge: test | Budget: $0.50',
      config: { generationModel: 'test', judgeModel: 'test', iterations: 50, budgetCapUsd: 0.50 },
      created_by: 'admin',
      is_predefined: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to seed: ${error?.message}`);
  return data;
}

async function cleanup(ids: string[]) {
  const supabase = getServiceClient();
  if (ids.length > 0) {
    await supabase.from('evolution_strategies').delete().in('id', ids);
  }
}

interface SeededArenaData {
  topicId: string;
  entryId: string;
}

async function seedArenaWithBudget(): Promise<SeededArenaData> {
  const supabase = getServiceClient();
  const ts = Date.now();

  // Create a topic
  const { data: topic, error: topicErr } = await supabase
    .from('evolution_prompts')
    .insert({
      prompt: `[TEST] Budget Arena Topic ${ts}`,
      title: `E2E Budget Topic ${ts}`,
    })
    .select('id')
    .single();
  if (topicErr || !topic) throw new Error(`Failed to seed topic: ${topicErr?.message}`);

  // Create a dummy explanation + evolution run with budget in config
  const { data: dummyTopic } = await supabase
    .from('topics')
    .insert({ topic_title: `[TEST] Budget Source ${ts}`, topic_description: 'temp' })
    .select('id')
    .single();

  const { data: dummyExplanation } = await supabase
    .from('explanations')
    .insert({
      explanation_title: `[TEST] Budget Article ${ts}`,
      content: 'placeholder',
      status: 'published',
      primary_topic_id: dummyTopic?.id,
    })
    .select('id')
    .single();

  const { data: run } = await supabase
    .from('evolution_runs')
    .insert({
      explanation_id: dummyExplanation?.id,
      status: 'completed',
      config: { budgetCapUsd: 0.25 },
      pipeline_version: 'v2',
      run_summary: { totalCostUsd: 0.10, totalVariants: 2 },
      created_at: new Date(Date.now() - 60000).toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  // Create an arena entry linked to the run (V2: inline elo fields on evolution_variants)
  const { data: entry, error: entryErr } = await supabase
    .from('evolution_variants')
    .insert({
      prompt_id: topic.id,
      synced_to_arena: true,
      variant_content: 'Budget-capped evolution entry for E2E testing.',
      generation_method: 'evolution_winner',
      model: 'deepseek-chat',
      cost_usd: 0.10,
      run_id: run?.id ?? null,
      elo_score: 1200,
      mu: 25,
      sigma: 8.333,
      arena_match_count: 1,
    })
    .select('id')
    .single();
  if (entryErr || !entry) throw new Error(`Failed to seed entry: ${entryErr?.message}`);

  return { topicId: topic.id, entryId: entry.id };
}

async function cleanupArena(data: SeededArenaData | undefined) {
  if (!data) return;
  const supabase = getServiceClient();

  // Get the entry to find its run_id (V2 column name)
  const { data: entry } = await supabase
    .from('evolution_variants')
    .select('run_id')
    .eq('id', data.entryId)
    .single();

  await supabase.from('evolution_arena_comparisons').delete().eq('prompt_id', data.topicId);
  await supabase.from('evolution_variants').delete().eq('prompt_id', data.topicId);
  await supabase.from('evolution_prompts').delete().eq('id', data.topicId);

  if (entry?.run_id) {
    await supabase.from('evolution_variants').delete().eq('run_id', entry.run_id);
    const { data: run } = await supabase
      .from('evolution_runs')
      .select('explanation_id')
      .eq('id', entry.run_id)
      .single();
    await supabase.from('evolution_runs').delete().eq('id', entry.run_id);
    if (run?.explanation_id) {
      const { data: exp } = await supabase
        .from('explanations')
        .select('primary_topic_id')
        .eq('id', run.explanation_id)
        .single();
      await supabase.from('explanations').delete().eq('id', run.explanation_id);
      if (exp?.primary_topic_id) {
        await supabase.from('topics').delete().eq('id', exp.primary_topic_id);
      }
    }
  }
}

// ─── Tests ───────────────────────────────────────────────────────

adminTest.describe('Admin Strategy Budget Cap', { tag: '@critical' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const seededStrategyIds: string[] = [];
  let arenaData: SeededArenaData | undefined;

  adminTest.beforeAll(async () => {
    const strategy = await seedStrategyWithBudget();
    seededStrategyIds.push(strategy.id);
    arenaData = await seedArenaWithBudget();
  });

  adminTest.afterAll(async () => {
    await cleanup(seededStrategyIds);
    await cleanupArena(arenaData);
  });

  adminTest(
    'strategy form shows budget cap input with correct constraints',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/strategies');
      await adminPage.waitForSelector('[data-testid="strategies-table"]', { timeout: 10000 });

      // Click "Create Strategy" to open the dialog
      await adminPage.locator('[data-testid="create-strategy-btn"]').click();

      // Verify the dialog opens
      const dialog = adminPage.locator('div[role="dialog"][aria-label="Create strategy"]');
      await expect(dialog).toBeVisible();

      // Verify budget cap input exists with correct attributes
      const budgetInput = adminPage.locator('[data-testid="strategy-budget-input"]');
      await expect(budgetInput).toBeVisible();
      await expect(budgetInput).toHaveAttribute('type', 'number');
      await expect(budgetInput).toHaveAttribute('min', '0.01');
      await expect(budgetInput).toHaveAttribute('max', '1');
      await expect(budgetInput).toHaveAttribute('step', '0.01');

      // Default value should be 0.50
      await expect(budgetInput).toHaveValue('0.5');
    },
  );

  adminTest(
    'arena page has budget tier filter with expected options',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/evolution/arena/${arenaData!.topicId}`);
      await adminPage.waitForLoadState('domcontentloaded');

      // Verify budget tier filter dropdown exists
      const budgetFilter = adminPage.locator('[data-testid="budget-tier-filter"]');
      await expect(budgetFilter).toBeVisible();

      // Verify expected options: All, <= $0.25, $0.25-$0.50, $0.50-$1.00
      const options = budgetFilter.locator('option');
      await expect(options).toHaveCount(4);

      const optionValues = await options.evaluateAll((els) =>
        els.map((el) => (el as HTMLOptionElement).value),
      );
      expect(optionValues).toEqual(['all', '0.25', '0.50', '1.00']);
    },
  );
});
