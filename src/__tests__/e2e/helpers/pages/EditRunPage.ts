// POM for /edit/runs/[runId] (improvements_to_edit_page_evolution_20260630 Phase 4).
// Encapsulates the pending/error/viewing branches + the new variant/diff tabs.
//
// Rule 4: getters return Locators (not Promise<string>) so consumers can use
// Playwright web-first assertions. Rule 12: switchTo* actions await panel visibility.
// Rule 18: hydration proof via strategy-combobox-hydrated is NOT applicable here
// (result page has its own edit-run-tabs-hydrated gate).

import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class EditRunPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async gotoRun(runId: string): Promise<void> {
    await this.navigate(`/edit/runs/${runId}`);
  }

  // ─── Locators ─────────────────────────────────────────────────

  runViewingLocator(): Locator {
    return this.page.getByTestId('edit-run-viewing');
  }

  runPendingLocator(): Locator {
    return this.page.getByTestId('edit-run-pending');
  }

  runErrorLocator(): Locator {
    return this.page.getByTestId('edit-run-error');
  }

  metaStripLocator(): Locator {
    return this.page.getByTestId('edit-run-meta-strip');
  }

  tabsHydratedLocator(): Locator {
    return this.page.getByTestId('edit-run-tabs-hydrated');
  }

  variantTabContentLocator(): Locator {
    return this.page.getByTestId('edit-run-tab-variant');
  }

  diffTabContentLocator(): Locator {
    return this.page.getByTestId('edit-run-tab-diff');
  }

  /** The SideBySideWordDiff renders itself with data-testid="sxs-diff". */
  sxsDiffLocator(): Locator {
    return this.page.getByTestId('sxs-diff');
  }

  // ─── Actions ──────────────────────────────────────────────────

  async switchToVariantTab(): Promise<void> {
    await this.tabsHydratedLocator().waitFor({ state: 'attached', timeout: 10_000 });
    await this.page.getByRole('tab', { name: 'Improved article' }).click();
    await this.variantTabContentLocator().waitFor({ state: 'visible', timeout: 5_000 });
  }

  async switchToDiffTab(): Promise<void> {
    await this.tabsHydratedLocator().waitFor({ state: 'attached', timeout: 10_000 });
    await this.page.getByRole('tab', { name: 'Diff' }).click();
    await this.diffTabContentLocator().waitFor({ state: 'visible', timeout: 5_000 });
  }
}
