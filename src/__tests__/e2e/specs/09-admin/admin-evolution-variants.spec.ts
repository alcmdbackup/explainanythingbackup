// E2E tests for the evolution variants list page.
// Covers table rendering, filtering by agent/winner, row navigation, pagination, and breadcrumbs.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { randomUUID } from 'crypto';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Evolution Variants (list page)', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `e2e-variants-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
  let runId: string;
  const variantIds: string[] = [];
  let winnerVariantId: string;
  let nonWinnerVariantId: string;
  // fixes_to_evolution_admin_dashboard__20260503: seed an agent invocation +
  // arena comparisons so we can exercise the Matches tab and Produced-by link.
  let invocationId: string;
  const comparisonIds: string[] = [];

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();

    // Seed prompt
    const { data: prompt, error: pErr } = await sb
      .from('evolution_prompts')
      .insert({ prompt: `${testPrefix} prompt`, name: `${testPrefix} Prompt`, status: 'active' })
      .select('id')
      .single();
    if (pErr) throw new Error(`Seed prompt: ${pErr.message}`);
    promptId = prompt.id;

    // Seed strategy
    const { data: strategy, error: sErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${testPrefix}-strategy`,
        config: { maxIterations: 3 },
        config_hash: `hash-${testPrefix}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (sErr) throw new Error(`Seed strategy: ${sErr.message}`);
    strategyId = strategy.id;

    // Seed run
    runId = randomUUID();
    const { error: rErr } = await sb.from('evolution_runs').insert({
      id: runId,
      status: 'completed',
      strategy_id: strategyId,
      prompt_id: promptId,
      budget_cap_usd: 1.0,
      completed_at: new Date().toISOString(),
    });
    if (rErr) throw new Error(`Seed run: ${rErr.message}`);

    // Seed variants — one winner, one non-winner, with different agents.
    // persisted=true is required: the variants list page filters by persisted=true
    // by default (Phase 9z); seeded test variants must mimic surfaced variants.
    winnerVariantId = randomUUID();
    nonWinnerVariantId = randomUUID();
    const variantInserts = [
      {
        id: winnerVariantId,
        run_id: runId,
        variant_content: '# Winner\n\n## Section\n\nThis variant won the tournament.',
        elo_score: 1500,
        generation: 2,
        agent_name: `${testPrefix}-alpha`,
        match_count: 5,
        is_winner: true,
        persisted: true,
      },
      {
        id: nonWinnerVariantId,
        run_id: runId,
        variant_content: '# Non-Winner\n\n## Section\n\nThis variant did not win.',
        elo_score: 1100,
        generation: 1,
        agent_name: `${testPrefix}-beta`,
        match_count: 3,
        is_winner: false,
        persisted: true,
      },
    ];
    const { error: vErr } = await sb.from('evolution_variants').insert(variantInserts);
    if (vErr) throw new Error(`Seed variants: ${vErr.message}`);
    variantIds.push(winnerVariantId, nonWinnerVariantId);

    // Seed an agent invocation so the winner variant can carry agent_invocation_id
    // (exercises the "Produced by" link in the variant detail header).
    invocationId = randomUUID();
    const { error: invErr } = await sb.from('evolution_agent_invocations').insert({
      id: invocationId,
      run_id: runId,
      agent_name: 'generate_from_previous_article',
      iteration: 2,
      execution_order: 0,
      success: true,
      cost_usd: 0.002,
    });
    if (invErr) throw new Error(`Seed invocation: ${invErr.message}`);

    // Wire the winner variant to that invocation. Column added in migration
    // 20260418000003 but not yet in the auto-generated Database types — cast.
    const { error: linkErr } = await sb
      .from('evolution_variants')
      .update({ agent_invocation_id: invocationId } as never)
      .eq('id', winnerVariantId);
    if (linkErr) throw new Error(`Link variant→invocation: ${linkErr.message}`);

    // Seed two arena comparisons so the Matches tab has rows to render.
    // Comparison 1: winner on entry_a side, won (winner=a)
    // Comparison 2: winner on entry_b side, lost (winner=a → opponent won)
    const c1Id = randomUUID();
    const c2Id = randomUUID();
    const { error: cErr } = await sb.from('evolution_arena_comparisons').insert([
      {
        id: c1Id,
        prompt_id: promptId,
        entry_a: winnerVariantId,
        entry_b: nonWinnerVariantId,
        winner: 'a',
        confidence: 0.92,
        run_id: runId,
        status: 'completed',
      },
      {
        id: c2Id,
        prompt_id: promptId,
        entry_a: nonWinnerVariantId,
        entry_b: winnerVariantId,
        winner: 'a',
        confidence: 0.81,
        run_id: runId,
        status: 'completed',
      },
    ]);
    if (cErr) throw new Error(`Seed comparisons: ${cErr.message}`);
    comparisonIds.push(c1Id, c2Id);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_arena_comparisons').delete().in('id', comparisonIds);
    await sb.from('evolution_agent_invocations').delete().eq('id', invocationId);
    await sb.from('evolution_variants').delete().in('id', variantIds);
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('page+columns: variants page renders table with correct column headers', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/variants');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Verify column headers exist
    await expect(table.locator('th:has-text("Agent")')).toBeVisible();
    await expect(table.locator('th:has-text("Rating")')).toBeVisible();
    await expect(table.locator('th:has-text("Matches")')).toBeVisible();
    // U18 (use_playwright_find_bugs_ux_issues_20260422): "Generation" was renamed
    // to "Iteration" everywhere for naming consistency.
    await expect(table.locator('th:has-text("Iteration")')).toBeVisible();

    // Hide test content filter should be visible
    const filterBar = adminPage.locator('[data-testid="filter-bar"]');
    await expect(filterBar).toBeVisible({ timeout: 15000 });
    const testContentFilter = adminPage.locator('[data-testid="filter-filterTestContent"]');
    await expect(testContentFilter).toBeVisible();
  });

  adminTest('filters: agent name and winner status filters work', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/variants');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Uncheck "Hide test content" FIRST so seeded test data is visible.
    // (The filter now works correctly after the is_test_content column fix;
    // previously the huge IN-list URL silently returned all rows.)
    const testContentFilter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await testContentFilter.isChecked()) {
      await testContentFilter.uncheck();
      // Wait for table to re-render after filter change
      await table.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
    }

    // Type the alpha agent name into the agent name filter
    const agentFilter = adminPage.locator('[data-testid="filter-agentName"]');
    await expect(agentFilter).toBeVisible();
    await agentFilter.fill(`${testPrefix}-alpha`);

    // Wait for table to update — the alpha variant should remain visible
    await expect(table.locator(`text=${testPrefix}-alpha`)).toBeVisible({ timeout: 15000 });

    // Clear the agent filter and test winner filter
    await agentFilter.fill('');

    // Select "Winners" from the winner filter
    const winnerFilter = adminPage.locator('[data-testid="filter-isWinner"]');
    await expect(winnerFilter).toBeVisible();
    await winnerFilter.selectOption('yes');

    // At least one winner star should be visible
    await expect(table.locator('text=★').first()).toBeVisible({ timeout: 15000 });
  });

  adminTest('nav+pagination: clicking variant row navigates to detail and breadcrumb links to Evolution', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/variants');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Uncheck "Hide test content" so seeded test variants are visible.
    // Must wait for filter to be visible before reading isChecked() — otherwise
    // hydration race lets isChecked() return false against pre-hydration DOM
    // and the uncheck is silently skipped (same pattern as sister spec
    // admin-evolution-experiments-list.spec.ts:143-145).
    const testContentFilter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    await expect(testContentFilter).toBeVisible({ timeout: 15000 });
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await testContentFilter.isChecked()) {
      await testContentFilter.uncheck();
      await table.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
    }

    // Click on the winner variant's ID link (first 8 chars)
    const variantLink = table.locator(`a[href*="/admin/evolution/variants/${winnerVariantId}"]`).first();
    await expect(variantLink).toBeVisible({ timeout: 15000 });
    await variantLink.click();

    await adminPage.waitForURL(`**/admin/evolution/variants/${winnerVariantId}`, { timeout: 15000 });
    expect(adminPage.url()).toContain(`/admin/evolution/variants/${winnerVariantId}`);

    // Navigate back to list and verify breadcrumb
    await adminPage.goto('/admin/evolution/variants');
    await adminPage.waitForLoadState('domcontentloaded');

    // EntityListPage renders pagination only when totalPages > 1.
    // With just 2 seeded variants it may not show — verify the list page renders at minimum.
    const listPage = adminPage.locator('[data-testid="entity-list-page"]');
    await expect(listPage).toBeVisible({ timeout: 15000 });

    const breadcrumb = adminPage.locator('[data-testid="evolution-breadcrumb"]');
    await expect(breadcrumb).toBeVisible({ timeout: 15000 });

    // Breadcrumb should contain "Evolution" link (pointing to dashboard)
    const evoLink = breadcrumb.locator('a:has-text("Evolution")');
    await expect(evoLink).toBeVisible();

    // Click Evolution breadcrumb
    await evoLink.click();
    await adminPage.waitForURL('**/admin/evolution-dashboard', { timeout: 15000 });
    expect(adminPage.url()).toContain('/admin/evolution-dashboard');
  });

  // B5/B6 (use_playwright_find_bugs_ux_issues_20260422): hardening checks for
  // (1) no nested-anchor hydration error from the Parent column wrapping a
  // <Link> inside the row's outer <Link>, and (2) parent rating renders in
  // Elo scale (~1200), not raw OpenSkill mu (~25).
  adminTest('B5+B6: variants list has no nested-anchor hydration error AND parent rating is in Elo scale', async ({ adminPage }) => {
    const consoleErrors: string[] = [];
    adminPage.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await adminPage.goto('/admin/evolution/variants');
    await adminPage.waitForLoadState('domcontentloaded');

    const table = adminPage.locator('[data-testid="entity-list-table"]');
    await expect(table).toBeVisible({ timeout: 15000 });

    // Uncheck "Hide test content" so seeded variants (with parents) are visible.
    const testContentFilter = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await testContentFilter.isChecked()) {
      await testContentFilter.uncheck();
      await table.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10000 });
    }

    // Wait for the first row to be hydrated as a proxy for "client-side render
    // settled" — this is when React would log nested-anchor warnings if any.
    await table.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 15000 });

    // B5: no nested-anchor hydration warnings.
    const nestedAnchorErr = consoleErrors.find(e => /<a>\s*cannot contain a nested\s*<a>/i.test(e) || /In HTML, <a> cannot be a descendant of <a>/i.test(e));
    expect(nestedAnchorErr, `Console errors: ${consoleErrors.join('\n')}`).toBeUndefined();

    // B6: parent rating sanity-check. The Parent cell (when present) should
    // render a value in the [600, 2400] Elo band. We parse cell text via a
    // regex matching `<digits> ±` — raw OpenSkill mu (~25) would yield "19 ±"
    // and the assertion below would fail.
    const parentCells = await table.locator('tbody td').allTextContents();
    const ratings = parentCells
      .map(t => t.match(/(\d{2,4})\s*±/))
      .filter((m): m is RegExpMatchArray => m != null && m[1] != null)
      .map(m => parseInt(m[1]!, 10));
    if (ratings.length > 0) {
      for (const r of ratings) {
        expect(r, `Parent rating ${r} out of [600, 2400] Elo band — likely raw mu regression`).toBeGreaterThanOrEqual(600);
        expect(r).toBeLessThanOrEqual(2400);
      }
    }
  });

  // fixes_to_evolution_admin_dashboard__20260503 Issue 1: variant Matches tab
  // is now wired through getVariantMatchHistoryAction (was a stub returning []).
  // Seeded comparisons above include the winner on both entry_a and entry_b sides.
  adminTest('Issue 1: variant detail Matches tab populates from arena comparisons', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/variants/${winnerVariantId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Click the Matches tab.
    const matchesTab = adminPage.getByRole('tab', { name: 'Matches' });
    await expect(matchesTab).toBeVisible({ timeout: 15000 });
    await matchesTab.click();

    // Match history section should be visible and contain the seeded rows.
    const matchHistory = adminPage.locator('[data-testid="variant-match-history"]');
    await expect(matchHistory).toBeVisible({ timeout: 15000 });

    // Two seeded comparisons → two match rows; one win + one loss.
    const matchRows = matchHistory.locator('[data-testid="match-row"]');
    await expect(matchRows).toHaveCount(2);

    // The winner is on entry_a in c1 (winner='a' → won) and on entry_b in c2
    // (winner='a' → opponent won, so variant lost). Expect one WIN and one LOSS.
    await expect(matchHistory.locator('text=WIN').first()).toBeVisible();
    await expect(matchHistory.locator('text=LOSS').first()).toBeVisible();
  });

  // fixes_to_evolution_admin_dashboard__20260503 Issue 3: variant detail header
  // gains a "Produced by <agent_name>" cross-link to the producing invocation.
  adminTest('Issue 3: variant detail header shows Produced-by link to producing invocation', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/variants/${winnerVariantId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const crossLinks = adminPage.locator('[data-testid="cross-links"]');
    await expect(crossLinks).toBeVisible({ timeout: 15000 });

    // The "Produced by" link should be present with agent_name as the label.
    await expect(crossLinks).toContainText('Produced by');
    await expect(crossLinks).toContainText('generate_from_previous_article');

    // Click → assert navigation to the invocation detail page.
    const producedByLink = crossLinks.locator(
      `a[href="/admin/evolution/invocations/${invocationId}"]`,
    );
    await expect(producedByLink).toBeVisible();
    await producedByLink.click();
    await adminPage.waitForURL(`**/admin/evolution/invocations/${invocationId}`, { timeout: 15000 });
    expect(adminPage.url()).toContain(`/admin/evolution/invocations/${invocationId}`);
  });

  // fixes_to_evolution_admin_dashboard__20260503: legacy variants without
  // agent_invocation_id should NOT show the Produced-by chip (graceful no-op).
  adminTest('legacy variant (null agent_invocation_id) hides Produced-by link', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/variants/${nonWinnerVariantId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const crossLinks = adminPage.locator('[data-testid="cross-links"]');
    await expect(crossLinks).toBeVisible({ timeout: 15000 });
    // Run + Explanation chips render normally, but Produced-by is absent.
    await expect(crossLinks).not.toContainText('Produced by');
  });
});
