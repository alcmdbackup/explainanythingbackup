// E2E tests for paragraph_recombine invocation detail UI.
// Per Phase 7 of rank_individual_paragraphs_evolution_20260525.
//
// COVERAGE (9 cases):
//   - 5-tab layout (Slots / Recombined / Metrics / Timeline / Logs)
//   - SlotsTab left pane: N slot rows with P-label + winner summary
//   - SlotsTab right pane: embedded ArenaLeaderboardTable with rows
//   - D20 "All invocations" tab: highlight markers (●) on this-invocation rows
//   - D20 "Just this invocation" tab: caption text reflects scope
//   - Recombined Output tab: per-paragraph color coding via data-winner attribute
//   - Format-validation banner surfaces when validateFormat rejects
//   - Timeline tab: bespoke ParagraphRecombineTimeline with cyan rewrite + deep-cyan rank
//   - Slot abort badge (red) for slot_budget self-aborts
//
// Uses createParagraphRecombineFixture to seed all DB rows directly (no pipeline
// orchestrator + LLM provider needed). Tag @evolution so it runs only in the
// production-only E2E job, not the pre-merge gate.

import { adminTest, expect } from '../../fixtures/admin-auth';
import {
  createParagraphRecombineFixture,
  type ParagraphRecombineFixture,
} from '../../helpers/evolution-test-data-factory';

adminTest.describe('Evolution Paragraph Recombine Invocation Detail', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let standardFixture: ParagraphRecombineFixture;
  let abortFixture: ParagraphRecombineFixture;
  let badFormatFixture: ParagraphRecombineFixture;

  adminTest.beforeAll(async () => {
    standardFixture = await createParagraphRecombineFixture({ slotCount: 3, rewritesPerSlot: 3 });
    abortFixture = await createParagraphRecombineFixture({ slotCount: 3, rewritesPerSlot: 3, forceSlotAbort: true });
    badFormatFixture = await createParagraphRecombineFixture({ slotCount: 2, rewritesPerSlot: 2, forceFormatRejection: true });
  });

  adminTest.afterAll(async () => {
    await standardFixture.cleanup();
    await abortFixture.cleanup();
    await badFormatFixture.cleanup();
  });

  adminTest('renders the 5-tab layout (Slots/Recombined/Metrics/Timeline/Logs)', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${standardFixture.invocationId}`);
    await expect(adminPage.locator('[role="tab"]:has-text("Paragraph Slots")')).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[role="tab"]:has-text("Recombined Output")')).toBeVisible();
    await expect(adminPage.locator('[role="tab"]:has-text("Metrics")')).toBeVisible();
    await expect(adminPage.locator('[role="tab"]:has-text("Timeline")')).toBeVisible();
    await expect(adminPage.locator('[role="tab"]:has-text("Logs")')).toBeVisible();
  });

  adminTest('SlotsTab left pane lists N slot rows with winner labels', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${standardFixture.invocationId}`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor({ timeout: 15000 });
    const slotRows = adminPage.locator('[data-testid^="slot-row-"]');
    expect(await slotRows.count()).toBe(3);
    const firstRowText = await slotRows.first().textContent();
    expect(firstRowText).toMatch(/P1/);
    expect(firstRowText).toMatch(/winner/);
  });

  adminTest('SlotsTab right pane embeds the ArenaLeaderboardTable', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${standardFixture.invocationId}`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor({ timeout: 15000 });
    // The first slot's leaderboard renders by default.
    await expect(adminPage.locator('[data-testid="leaderboard-table"]')).toBeVisible({ timeout: 10000 });
  });

  adminTest('D20: "All invocations" tab highlights this-invocation rows with ●', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${standardFixture.invocationId}`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor({ timeout: 15000 });
    await adminPage.locator('[data-testid="slot-tab-all"]').click();
    await expect(adminPage.locator('[data-testid="leaderboard-table"]')).toBeVisible({ timeout: 10000 });
    expect(await adminPage.locator('[data-testid="lb-highlight-marker"]').count()).toBeGreaterThan(0);
  });

  adminTest('D20: "Just this invocation" tab caption mentions filter scope', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${standardFixture.invocationId}`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor({ timeout: 15000 });
    await adminPage.locator('[data-testid="slot-tab-this"]').click();
    await expect(adminPage.locator('[data-testid="leaderboard-table"]')).toBeVisible({ timeout: 10000 });
    const caption = await adminPage.locator('[data-testid="arena-leaderboard-caption"]').textContent();
    expect(caption).toMatch(/from this invocation/i);
  });

  adminTest('Recombined Output tab renders the article with per-paragraph block coding', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${standardFixture.invocationId}`);
    await adminPage.locator('[role="tab"]:has-text("Recombined Output")').click();
    await expect(adminPage.locator('[data-testid="recombined-article"]')).toBeVisible();
    const blocks = adminPage.locator('[data-testid^="recombined-block-"]');
    expect(await blocks.count()).toBeGreaterThan(0);
    const firstWinner = await blocks.first().getAttribute('data-winner');
    expect(['rewrite', 'original']).toContain(firstWinner);
  });

  adminTest('Format-validation banner surfaces when validateFormat rejects recombined output', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${badFormatFixture.invocationId}`);
    await adminPage.locator('[role="tab"]:has-text("Recombined Output")').click();
    await expect(adminPage.locator('[data-testid="recombined-format-banner"]')).toBeVisible({ timeout: 10000 });
  });

  adminTest('Timeline tab renders ParagraphRecombineTimeline with rewrite + rank sub-bars', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${standardFixture.invocationId}`);
    await adminPage.locator('[role="tab"]:has-text("Timeline")').click();
    await expect(adminPage.locator('[data-testid="timeline-paragraph-recombine"]')).toBeVisible({ timeout: 10000 });
    expect(await adminPage.locator('[data-testid^="timeline-paragraph-rewrite-"]').count()).toBeGreaterThan(0);
    expect(await adminPage.locator('[data-testid^="timeline-paragraph-rank-"]').count()).toBeGreaterThan(0);
  });

  adminTest('Slot abort badge surfaces when a slot self-aborted via slot_budget', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${abortFixture.invocationId}`);
    await adminPage.locator('[data-testid="paragraph-slots-tab"]').waitFor({ timeout: 15000 });
    expect(await adminPage.locator('[data-testid^="slot-abort-badge-"]').count()).toBeGreaterThan(0);
  });
});
