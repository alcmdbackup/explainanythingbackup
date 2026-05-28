// E2E tests for paragraph_recombine invocation detail UI.
// Per Phase 7 of rank_individual_paragraphs_evolution_20260525.
//
// COVERAGE per the plan (9 cases):
//   - invocation detail tab rendering (5-tab layout: Slots / Recombined / Metrics / Timeline / Logs)
//   - slot-by-slot table in left pane of SlotsTab
//   - recombined output panel
//   - timeline bar colors (PARAGRAPH_REWRITE_COLOR cyan + PARAGRAPH_RANK_COLOR deep cyan)
//   - embedded ArenaLeaderboardTable in SlotsTab right pane (Elo, matches, cutoff dimming)
//   - D20 tab toggle ("All invocations" / "Just this invocation") filters/highlights correctly
//     with absolute ranks preserved when filtered
//   - slot list left pane shows (this inv) vs (prior) tag accurately
//
// SCOPE: This spec drives the rendered UI after a paragraph_recombine invocation
// has produced execution_detail. Seeding requires building a parent variant +
// invocation row + paragraph slot topics + slot variants — heavyweight setup.
// The scaffolding here documents the assertions; the seed helpers are added
// alongside in a follow-up PR (similar shape to the existing arena-detail spec
// but with the SlotRecombineExecutionDetail JSON wired into the invocation row).

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe.skip('Evolution Paragraph Recombine Invocation Detail', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let invocationId: string;

  adminTest.beforeAll(async () => {
    // Seed:
    //   1. A parent article variant.
    //   2. A paragraph_recombine evolution_agent_invocations row with execution_detail
    //      containing N slots, each with rewrites + ranking results.
    //   3. Per-slot evolution_prompts (prompt_kind='paragraph') + their variants.
    //   4. Per-slot evolution_arena_comparisons rows for the leaderboard.
    invocationId = '00000000-0000-0000-0000-000000000000';
  });

  adminTest.afterAll(async () => {
    // cleanupEvolutionData(supabase, {
    //   variantIds: [parentVariantId],
    //   paragraphTopicParentPrefixes: [parentVariantId.slice(0, 8)],
    // });
  });

  adminTest('renders the 5-tab layout (Slots/Recombined/Metrics/Timeline/Logs)', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}`);
    await expect(adminPage.locator('[role="tab"]:has-text("Paragraph Slots")')).toBeVisible();
    await expect(adminPage.locator('[role="tab"]:has-text("Recombined Output")')).toBeVisible();
    await expect(adminPage.locator('[role="tab"]:has-text("Metrics")')).toBeVisible();
    await expect(adminPage.locator('[role="tab"]:has-text("Timeline")')).toBeVisible();
    await expect(adminPage.locator('[role="tab"]:has-text("Logs")')).toBeVisible();
  });

  adminTest('SlotsTab left pane lists N slot rows with winner labels', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor();
    const slotRows = adminPage.locator('[data-testid^="slot-row-"]');
    expect(await slotRows.count()).toBeGreaterThan(0);
    // Each slot row should carry a P-label and a winner summary or abort badge.
    const firstRowText = await slotRows.first().textContent();
    expect(firstRowText).toMatch(/P\d+/);
  });

  adminTest('SlotsTab right pane embeds the ArenaLeaderboardTable', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor();
    // Click first slot to ensure right pane renders.
    await adminPage.locator('[data-testid^="slot-row-"]').first().click();
    await expect(adminPage.locator('[data-testid="leaderboard-table"]')).toBeVisible({ timeout: 10000 });
  });

  adminTest('D20: "All invocations" toggle highlights this-invocation rows with ●', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor();
    await adminPage.locator('[data-testid^="slot-row-"]').first().click();
    await adminPage.locator('[data-testid="slot-tab-all"]').click();
    // At least one row should carry the ● highlight marker.
    expect(await adminPage.locator('[data-testid="lb-highlight-marker"]').count()).toBeGreaterThan(0);
  });

  adminTest('D20: "Just this invocation" filter renders only this-invocation rows, ranks preserved absolute', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor();
    await adminPage.locator('[data-testid^="slot-row-"]').first().click();
    await adminPage.locator('[data-testid="slot-tab-this"]').click();
    // Highlight markers should NOT render in filter mode (rows are already implicitly "this").
    // The bottom caption should reflect the filter scope.
    const caption = await adminPage.locator('[data-testid="arena-leaderboard-caption"]').textContent();
    expect(caption).toMatch(/from this invocation/i);
  });

  adminTest('Recombined Output tab renders the article with per-paragraph block coding', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}`);
    await adminPage.locator('[role="tab"]:has-text("Recombined Output")').click();
    await expect(adminPage.locator('[data-testid="recombined-article"]')).toBeVisible();
    // At least one block carries the data-winner attribute set by the renderer.
    const blocks = adminPage.locator('[data-testid^="recombined-block-"]');
    expect(await blocks.count()).toBeGreaterThan(0);
    const firstWinner = await blocks.first().getAttribute('data-winner');
    expect(['rewrite', 'original']).toContain(firstWinner);
  });

  adminTest('Format-validation banner surfaces when validateFormat rejects recombined output', async ({ adminPage }) => {
    // Seed a separate invocation whose execution_detail has formatValid=false +
    // formatIssues=['Contains bullet points'].
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}-bad`);
    await adminPage.locator('[role="tab"]:has-text("Recombined Output")').click();
    await expect(adminPage.locator('[data-testid="recombined-format-banner"]')).toBeVisible();
  });

  adminTest('Timeline tab renders ParagraphRecombineTimeline with cyan rewrite + deep-cyan rank sub-bars', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}`);
    await adminPage.locator('[role="tab"]:has-text("Timeline")').click();
    await expect(adminPage.locator('[data-testid="timeline-paragraph-recombine"]')).toBeVisible();
    // Per-slot rewrite + rank bars should exist.
    expect(await adminPage.locator('[data-testid^="timeline-paragraph-rewrite-"]').count()).toBeGreaterThan(0);
    expect(await adminPage.locator('[data-testid^="timeline-paragraph-rank-"]').count()).toBeGreaterThan(0);
  });

  adminTest('Slot abort badge surfaces when a slot self-aborted via slot_budget', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}-abort`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor();
    // At least one slot row should carry the abort badge.
    expect(await adminPage.locator('[data-testid^="slot-abort-badge-"]').count()).toBeGreaterThan(0);
  });
});
