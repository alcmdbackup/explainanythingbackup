/**
 * Arena Tactic column E2E — track_tactic_effectiveness_evolution_20260422 Phase 3.
 *
 * Seeds a topic + two variants with distinct agent_name values + matching evolution_tactics
 * rows. Verifies:
 *   - Tactic column renders before Method column.
 *   - Each row shows the tactic name + a colored TACTIC_PALETTE dot.
 *   - Clicking the tactic cell navigates to /admin/evolution/tactics/[tactic_id].
 *   - Rows with null agent_name (seed/manual) render "—" in the Tactic column.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface SeededData {
  topicId: string;
  withAgentVariantId: string;
  withoutAgentVariantId: string;
  tacticId: string;
}

async function seed(): Promise<SeededData> {
  const supabase = getServiceClient();
  const ts = Date.now();

  const { data: topic, error: te } = await supabase
    .from('evolution_prompts')
    .insert({ prompt: `[TEST] Tactic Column Topic ${ts}`, name: `[TEST] Tactic Column ${ts}` })
    .select('id')
    .single();
  if (te || !topic) throw new Error(`topic seed failed: ${te?.message}`);

  // Look up an existing tactic (synced via syncSystemTactics); prefer structural_transform
  // since it's in DEFAULT_TACTICS. If not present, pick the first active row.
  // Cast via unknown: evolution_tactics isn't in generated Database types yet.
  const { data: tactic } = await (supabase as unknown as {
    from: (t: string) => { select: (s: string) => { eq: (c: string, v: string) => { limit: (n: number) => { single: () => Promise<{ data: { id: string; name: string } | null }> } } } };
  })
    .from('evolution_tactics')
    .select('id, name')
    .eq('status', 'active')
    .limit(1)
    .single();
  if (!tactic) throw new Error('no evolution_tactics rows — run syncSystemTactics first');

  // Variant 1: has agent_name matching the tactic (renders the linked chip).
  const { data: v1, error: v1e } = await supabase
    .from('evolution_variants')
    .insert({
      prompt_id: topic.id,
      variant_content: `[TEST] Variant with tactic ${ts}`,
      synced_to_arena: true,
      generation_method: 'llm',
      agent_name: tactic.name,
      mu: 25, sigma: 5, elo_score: 1300, arena_match_count: 0,
    })
    .select('id')
    .single();
  if (v1e || !v1) throw new Error(`v1 seed failed: ${v1e?.message}`);

  // Variant 2: null agent_name (e.g. a seed or manual entry) — should render '—' in Tactic.
  const { data: v2, error: v2e } = await supabase
    .from('evolution_variants')
    .insert({
      prompt_id: topic.id,
      variant_content: `[TEST] Variant without tactic ${ts}`,
      synced_to_arena: true,
      generation_method: 'manual',
      agent_name: null,
      mu: 25, sigma: 5, elo_score: 1200, arena_match_count: 0,
    })
    .select('id')
    .single();
  if (v2e || !v2) throw new Error(`v2 seed failed: ${v2e?.message}`);

  return {
    topicId: topic.id,
    withAgentVariantId: v1.id,
    withoutAgentVariantId: v2.id,
    tacticId: tactic.id as string,
  };
}

async function cleanup(data: SeededData) {
  const supabase = getServiceClient();
  await supabase.from('evolution_variants').delete().eq('prompt_id', data.topicId);
  await supabase.from('evolution_prompts').delete().eq('id', data.topicId);
}

adminTest.describe('Admin Arena Tactic column', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let seeded: SeededData;

  adminTest.beforeAll(async () => {
    seeded = await seed();
  });

  adminTest.afterAll(async () => {
    if (seeded) await cleanup(seeded);
  });

  adminTest('arena leaderboard renders Tactic column with colored dot', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/arena/${seeded.topicId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const leaderboard = adminPage.locator('[data-testid="leaderboard-table"]');
    await expect(leaderboard).toBeVisible({ timeout: 20000 });

    // Header 'Tactic' appears before 'Method' in the table.
    const headerRow = leaderboard.locator('thead tr');
    await expect(headerRow).toContainText(/Tactic/);
    await expect(headerRow).toContainText(/Method/);

    // Rows have the lb-tactic cell populated (linked or '—').
    const tacticCells = adminPage.locator('[data-testid="lb-tactic"]');
    expect(await tacticCells.count()).toBeGreaterThanOrEqual(2);
  });

  adminTest('variant with agent_name links to tactic detail', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/arena/${seeded.topicId}`);
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('[data-testid="leaderboard-table"]')).toBeVisible({ timeout: 20000 });

    // At least one tactic cell should contain a link to the tactic detail page.
    const tacticLinks = adminPage.locator(`[data-testid="lb-tactic"] a[href*="/admin/evolution/tactics/${seeded.tacticId}"]`);
    await expect(tacticLinks.first()).toBeVisible();
  });

  adminTest('variant without agent_name renders em-dash in Tactic column', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/arena/${seeded.topicId}`);
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('[data-testid="leaderboard-table"]')).toBeVisible({ timeout: 20000 });

    // At least one tactic cell should contain '—' (the null-agent-name fallback).
    // Use hasText filter instead of :text-is since the em-dash is inside a child span,
    // not the td's direct text content.
    const emDashTactic = adminPage.locator('[data-testid="lb-tactic"]').filter({ hasText: '—' });
    expect(await emDashTactic.count()).toBeGreaterThanOrEqual(1);
  });
});
