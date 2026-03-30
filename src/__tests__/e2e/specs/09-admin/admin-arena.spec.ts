/**
 * Admin arena E2E tests. Tests topic list page and topic detail leaderboard
 * against actual UI elements (EntityListPage table, leaderboard-table testid).
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

interface SeededArenaData {
  topicId: string;
  entryOneshotId: string;
  entryEvolutionId: string;
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

  // 2. Create two entries with inline Elo (V2: no separate elo table)
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
      elo_score: 1320,
      mu: 28,
      sigma: 6.5,
      arena_match_count: 3,
    })
    .select('id')
    .single();

  if (e2 || !entryEvolution) throw new Error(`Failed to seed evolution entry: ${e2?.message}`);

  return {
    topicId: topic.id,
    entryOneshotId: entryOneshot.id,
    entryEvolutionId: entryEvolution.id,
  };
}

async function cleanupArenaData(data: SeededArenaData | undefined) {
  if (!data) return;
  const supabase = getServiceClient();

  // Delete in reverse dependency order
  const { error: e1 } = await supabase.from('evolution_arena_comparisons').delete().eq('prompt_id', data.topicId);
  if (e1) console.warn(`[cleanup] Failed to delete from evolution_arena_comparisons: ${e1.message}`);
  const { error: e2 } = await supabase.from('evolution_variants').delete().eq('prompt_id', data.topicId);
  if (e2) console.warn(`[cleanup] Failed to delete arena variants from evolution_variants: ${e2.message}`);
  const { error: e3 } = await supabase.from('evolution_prompts').delete().eq('id', data.topicId);
  if (e3) console.warn(`[cleanup] Failed to delete from evolution_prompts: ${e3.message}`);
}

// ─── Tests ───────────────────────────────────────────────────────

adminTest.describe('Admin Arena', { tag: '@evolution' }, () => {
  let seededData: SeededArenaData;

  adminTest.beforeAll(async () => {
    seededData = await seedArenaData();
  });

  adminTest.afterAll(async () => {
    await cleanupArenaData(seededData);
  });

  // ── 1. Topic list page renders with table and seeded row ──

  adminTest(
    'topic list page renders with cross-topic summary cards',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/arena');
      await adminPage.waitForLoadState('domcontentloaded');

      // Page heading
      await expect(adminPage.locator('main h1').first()).toContainText('Arena');

      // Topics table renders (EntityListPage renders a plain <table>)
      const topicsTable = adminPage.locator('main table');
      await expect(topicsTable).toBeVisible();

      // Table should have header columns
      await expect(topicsTable.locator('th').first()).toBeVisible();

      // Our seeded topic row should appear (search by topic name in table cells)
      const seededRow = adminPage.locator('main table tbody tr', { hasText: 'E2E Test Topic' });
      await expect(seededRow.first()).toBeVisible();
    },
  );

  // ── 2. Topic detail page shows leaderboard with expected columns ──

  adminTest(
    'topic detail page shows leaderboard with expected columns',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/evolution/arena/${seededData.topicId}`);
      await adminPage.waitForLoadState('domcontentloaded');

      // Entity detail header exists
      const header = adminPage.locator('[data-testid="entity-detail-header"]');
      await expect(header).toBeVisible();

      // Leaderboard table is visible
      const leaderboardTable = adminPage.locator('[data-testid="leaderboard-table"]');
      await expect(leaderboardTable).toBeVisible();

      // Verify expected column headers match actual UI
      const headers = leaderboardTable.locator('thead th');
      const headerTexts = await headers.allTextContents();
      // Strip sort indicators (triangle arrows) from header text for clean comparison
      const cleanHeaders = headerTexts.map(h => h.replace(/\s*[\u25B2\u25BC]$/, ''));
      expect(cleanHeaders).toEqual(
        expect.arrayContaining(['Rank', 'Content', 'Elo', '95% CI', 'Matches', 'Method', 'Cost']),
      );

      // Exactly 2 rows — test seeds exactly 2 entries for this isolated topic
      const rows = leaderboardTable.locator('tbody tr');
      await expect(rows).toHaveCount(2);
    },
  );
});
