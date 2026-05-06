// Phase 5 E2E: run detail page's Metrics tab shows the strategy-effectiveness
// bar chart + per-agent histogram, populated by eloAttrDelta:* / eloAttrDeltaHist:*
// metric rows. Seeds a multi-hop run, then triggers metric computation by opening
// the page (lazy recompute fires via getEntityMetricsAction on read).

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createMultiHopFixture, getEvolutionServiceClient, type MultiHopFixture } from '../../helpers/evolution-test-data-factory';

adminTest.describe('Strategy Effectiveness Chart', { tag: ['@evolution', '@critical'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let fixture: MultiHopFixture;

  adminTest.beforeAll(async () => {
    fixture = await createMultiHopFixture({ seedAttributionMetrics: true });
    // Mark the run complete for realism; the chart renders from seeded metric rows
    // regardless of run status.
    const supabase = getEvolutionServiceClient();
    await supabase
      .from('evolution_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', fixture.runId);
  });

  adminTest.afterAll(async () => {
    if (fixture) await fixture.cleanup();
  });

  adminTest('Metrics tab renders StrategyEffectivenessChart + EloDeltaHistogram', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${fixture.runId}?tab=metrics`);
    await adminPage.waitForLoadState('domcontentloaded');

    // The AttributionCharts wrapper returns null when no data — wait up to 30s
    // for the metric recompute + render.
    const charts = adminPage.locator('[data-testid="attribution-charts"]');
    await expect(charts).toBeVisible({ timeout: 30000 });

    // Bar chart (strategy-breakdown) present with at least one bar row.
    await expect(adminPage.locator('[data-testid="strategy-effectiveness-chart"]')).toBeVisible();
    expect(await adminPage.locator('[data-testid="strategy-bar-row"]').count()).toBeGreaterThanOrEqual(1);

    // Histogram present.
    await expect(adminPage.locator('[data-testid="elo-delta-histogram"]')).toBeVisible();
    expect(await adminPage.locator('[data-testid="histogram-bucket"]').count()).toBeGreaterThanOrEqual(1);
  });

  // track_tactic_effectiveness_evolution_20260422 Phase 5: bar labels now render as
  // `<agent> / <dim>` (previously just `<dim>`). This disambiguates the case where
  // multiple variant-producing agents share a dimension value.
  adminTest('bar labels use "<agent> / <dim>" format (Phase 5 disambiguation)', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/runs/${fixture.runId}?tab=metrics`);
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('[data-testid="attribution-charts"]')).toBeVisible({ timeout: 30000 });

    // At least one bar row exists (asserted above); assert at least one bar's label
    // contains the ' / ' separator. Labels are rendered inside the bar row content.
    const firstBar = adminPage.locator('[data-testid="strategy-bar-row"]').first();
    await expect(firstBar).toBeVisible();
    // The bar row's text should include ' / ' now that agent is prepended to dim.
    await expect(firstBar).toContainText(' / ');
  });
});
