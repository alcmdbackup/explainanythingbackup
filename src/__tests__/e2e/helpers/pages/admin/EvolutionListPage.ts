/**
 * POM for evolution admin list pages (runs, experiments, strategies, variants).
 * Encapsulates the "Hide test content" filter which is default-on across all
 * evolution list pages — seeded test rows are invisible until reset.
 */

import { Page, Locator } from '@playwright/test';
import { AdminBasePage } from './AdminBasePage';

export class EvolutionListPage extends AdminBasePage {
  readonly hideTestCheckbox: Locator;

  constructor(page: Page) {
    super(page);
    this.hideTestCheckbox = page.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
  }

  /**
   * Uncheck the "Hide test content" filter so seeded [TEST]/[E2E]/[TEST_EVO] rows
   * are visible. Idempotent: setChecked(false) on an already-unchecked box is a no-op.
   * Mirrors AdminContentPage.resetFilters() single-call pattern; Playwright's
   * setChecked auto-waits so no post-click expect is needed.
   */
  async resetFilters(): Promise<void> {
    await this.hideTestCheckbox.setChecked(false);
  }

  /**
   * Re-check the "Hide test content" filter so test rows are hidden. Used by
   * filter-consistency specs that toggle visibility mid-test.
   */
  async enableHideTestFilter(): Promise<void> {
    await this.hideTestCheckbox.setChecked(true);
  }
}
