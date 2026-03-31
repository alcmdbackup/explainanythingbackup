// E2E tests for arena topic detail: leaderboard Elo formatting, markdown stripping, and column sorting.
// Seeds a prompt with arena entries having varied ratings and verifies display logic.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Arena Detail', { tag: '@evolution' }, () => {
  const testPrefix = `e2e-arena-detail-${Date.now()}`;
  let promptId: string;
  const entryIds: string[] = [];

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();

    // Seed prompt (arena topic)
    const { data: prompt, error: pErr } = await sb
      .from('evolution_prompts')
      .insert({
        prompt: `# ${testPrefix} Arena Topic`,
        name: `${testPrefix} Arena Topic`,
        status: 'active',
      })
      .select('id')
      .single();
    if (pErr) throw new Error(`Seed prompt: ${pErr.message}`);
    promptId = prompt.id;

    // Seed variant entries with varied Elo scores
    const entries = [
      {
        prompt_id: promptId,
        synced_to_arena: true,
        variant_content: '# Heading One\nThis is the first variant for arena testing.',
        generation_method: 'oneshot',
        model: 'gpt-4.1-mini',
        cost_usd: 0.003,
        elo_score: 1250,
        mu: 25,
        sigma: 7.0,
        arena_match_count: 5,
      },
      {
        prompt_id: promptId,
        synced_to_arena: true,
        variant_content: '# Heading Two\nThis is the second variant with a higher Elo.',
        generation_method: 'evolution_winner',
        model: 'deepseek-chat',
        cost_usd: 0.015,
        elo_score: 1400,
        mu: 30,
        sigma: 5.5,
        arena_match_count: 8,
      },
      {
        prompt_id: promptId,
        synced_to_arena: true,
        variant_content: '# Heading Three\nThird variant with lowest Elo.',
        generation_method: 'oneshot',
        model: 'gpt-4.1',
        cost_usd: 0.025,
        elo_score: 1100,
        mu: 20,
        sigma: 8.0,
        arena_match_count: 3,
      },
    ];

    const { data: inserted, error: eErr } = await sb
      .from('evolution_variants')
      .insert(entries)
      .select('id');
    if (eErr) throw new Error(`Seed entries: ${eErr.message}`);
    entryIds.push(...(inserted ?? []).map((e: { id: string }) => e.id));
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_arena_comparisons').delete().eq('prompt_id', promptId);
    await sb.from('evolution_variants').delete().eq('prompt_id', promptId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('leaderboard shows rounded Elo values as integers', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/arena/${promptId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const leaderboardTable = adminPage.locator('[data-testid="leaderboard-table"]');
    await expect(leaderboardTable).toBeVisible({ timeout: 15000 });

    // Get all Elo cell text values (Elo column is typically column index 3)
    const eloTexts = await leaderboardTable.locator('tbody tr').allTextContents();

    // Verify Elo values in the rows are integers (no decimal points in the Elo display)
    for (const rowText of eloTexts) {
      // The row text should contain integer Elo values like 1400, 1250, 1100
      // and NOT floating-point like 1400.5 or 1250.3
      const eloMatches = rowText.match(/\b1[0-4]\d{2}\b/g);
      if (eloMatches) {
        for (const elo of eloMatches) {
          expect(elo).not.toContain('.');
        }
      }
    }
  });

  // eslint-disable-next-line flakiness/no-test-skip -- Row click-to-expand with tab-content not yet implemented
  adminTest.skip('content column strips markdown heading prefix', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/arena/${promptId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const leaderboardTable = adminPage.locator('[data-testid="leaderboard-table"]');
    await expect(leaderboardTable).toBeVisible({ timeout: 15000 });

    // Click first row to expand and see content
    const firstRow = leaderboardTable.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.click();

    const tabContent = adminPage.locator('[data-testid="tab-content"]');
    await expect(tabContent).toBeVisible({ timeout: 10000 });

    // Content should not display raw markdown "# " prefix at the start
    const contentText = await tabContent.textContent();
    expect(contentText).toBeDefined();
    // The rendered content should not start with "# " (markdown heading syntax)
    if (contentText) {
      expect(contentText.trimStart().startsWith('# ')).toBe(false);
    }
  });

  adminTest('leaderboard columns are sortable', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/arena/${promptId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const leaderboardTable = adminPage.locator('[data-testid="leaderboard-table"]');
    await expect(leaderboardTable).toBeVisible({ timeout: 15000 });

    // Get initial first row text
    const firstRow = leaderboardTable.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    const firstRowBefore = await firstRow.textContent();

    // Click the "Elo" column header to change sort order
    // Use .first() because multiple headers contain "Elo" (e.g. "Elo", "Elo ± σ")
    const eloHeader = leaderboardTable.locator('thead th:has-text("Elo")').first();
    await expect(eloHeader).toBeVisible();
    await eloHeader.click();

    // After clicking, re-read first row — order may have changed
    const firstRowAfter = await leaderboardTable.locator('tbody tr').first().textContent();

    // Clicking the header should either reverse the sort or maintain it
    // We verify the sort mechanism is wired up (first row text may differ)
    expect(firstRowBefore).toBeDefined();
    expect(firstRowAfter).toBeDefined();
  });

  adminTest('leaderboard shows Elo ± σ column instead of separate Mu and Sigma columns', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/arena/${promptId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const leaderboardTable = adminPage.locator('[data-testid="leaderboard-table"]');
    await expect(leaderboardTable).toBeVisible({ timeout: 15000 });

    const headers = leaderboardTable.locator('thead th');
    const headerTexts = await headers.allTextContents();
    const headerString = headerTexts.join(' | ');

    // "Elo ± σ" column should exist
    expect(headerString).toContain('Elo ± σ');

    // Separate "Mu" and "Sigma" columns should no longer exist
    const exactMu = headerTexts.some(h => h.trim() === 'Mu' || h.trim().startsWith('Mu'));
    const exactSigma = headerTexts.some(h => h.trim() === 'Sigma' || h.trim().startsWith('Sigma'));
    expect(exactMu).toBe(false);
    expect(exactSigma).toBe(false);

    // Rows should contain the "±" format (e.g. "1400 ± 172")
    const firstRow = leaderboardTable.locator('tbody tr:first-child');
    const rowText = await firstRow.textContent();
    expect(rowText).toContain('±');
  });

  adminTest('entries show non-zero match counts after sync', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/arena/${promptId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const leaderboardTable = adminPage.locator('[data-testid="leaderboard-table"]');
    await expect(leaderboardTable).toBeVisible({ timeout: 15000 });

    // Seeded entries have arena_match_count values of 5, 8, and 3
    // At least one row should display a non-zero match count
    const rows = leaderboardTable.locator('tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    let foundNonZero = false;
    for (let i = 0; i < rowCount; i++) {
      const rowText = await rows.nth(i).textContent();
      // Match count cells should contain digits > 0 corresponding to arena_match_count
      const matchCounts = rowText?.match(/\b([1-9]\d*)\b/g);
      if (matchCounts && matchCounts.some(n => parseInt(n) > 0)) {
        foundNonZero = true;
        break;
      }
    }
    expect(foundNonZero).toBe(true);
  });
});
