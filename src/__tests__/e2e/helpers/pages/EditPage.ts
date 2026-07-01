// POM for the public /edit form (improvements_to_edit_page_evolution_20260630 Phase 4).
// Encapsulates the combobox picker + config modal + textarea + submit selectors.
//
// Rule 4: getters return Locators (not Promise<string>) so consumers can await
// Playwright web-first assertions. Rule 12: action methods await their
// post-condition before returning. Rule 18: openCombobox awaits the hydration
// gate (strategy-combobox-hydrated) before clicking the trigger.

import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class EditPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto(): Promise<void> {
    await this.navigate('/edit');
  }

  // ─── Locators ─────────────────────────────────────────────────

  formLocator(): Locator {
    return this.page.getByTestId('edit-form');
  }

  emptyStateLocator(): Locator {
    return this.page.getByTestId('edit-form-no-strategies');
  }

  strategyPickerLocator(): Locator {
    return this.page.getByTestId('strategy-picker');
  }

  comboboxTriggerLocator(): Locator {
    return this.page.getByTestId('strategy-combobox-trigger');
  }

  comboboxHydratedLocator(): Locator {
    return this.page.getByTestId('strategy-combobox-hydrated');
  }

  strategyOptionLocator(strategyId: string): Locator {
    return this.page.getByTestId(`strategy-combobox-opt-${strategyId}`);
  }

  strategyOptionShowConfigButtonLocator(strategyId: string): Locator {
    return this.page.getByTestId(`strategy-option-show-config-${strategyId}`);
  }

  strategyOptionBudgetWarningLocator(strategyId: string): Locator {
    return this.page.getByTestId(`strategy-option-budget-warning-${strategyId}`);
  }

  selectedStrategyBudgetWarningLocator(): Locator {
    return this.page.getByTestId('selected-strategy-budget-warning');
  }

  configModalLocator(): Locator {
    return this.page.getByTestId('strategy-config-modal');
  }

  configModalBudgetWarningLocator(): Locator {
    return this.page.getByTestId('strategy-config-modal-budget-warning');
  }

  editTextareaLocator(): Locator {
    return this.page.getByTestId('edit-textarea');
  }

  editSubmitLocator(): Locator {
    return this.page.getByTestId('edit-submit');
  }

  editFormErrorLocator(): Locator {
    return this.page.getByTestId('edit-form-error');
  }

  // ─── Actions ──────────────────────────────────────────────────

  /** Wait for the combobox client component to hydrate before clicking (Rule 18). */
  async openCombobox(): Promise<void> {
    await this.comboboxHydratedLocator().waitFor({ state: 'attached', timeout: 10_000 });
    await this.comboboxTriggerLocator().click();
    // Wait for the listbox to open — any option row is present when open.
    await this.page.locator('[role="listbox"]').waitFor({ state: 'visible', timeout: 5_000 });
  }

  /** Type into the combobox search input. Assumes openCombobox() was called. */
  async searchStrategies(query: string): Promise<void> {
    await this.comboboxTriggerLocator().fill(query);
  }

  async selectStrategy(strategyId: string): Promise<void> {
    await this.openCombobox();
    const opt = this.strategyOptionLocator(strategyId);
    await opt.click();
    // Selection collapses the listbox.
    await this.page.locator('[role="listbox"]').waitFor({ state: 'hidden', timeout: 5_000 });
  }

  async openStrategyConfig(strategyId: string): Promise<void> {
    await this.openCombobox();
    await this.strategyOptionShowConfigButtonLocator(strategyId).click();
    await this.configModalLocator().waitFor({ state: 'visible', timeout: 5_000 });
  }

  async closeStrategyConfig(): Promise<void> {
    // shadcn Dialog has an X close button + ESC — press ESC for reliability.
    await this.page.keyboard.press('Escape');
    await this.configModalLocator().waitFor({ state: 'hidden', timeout: 5_000 });
  }

  async typeArticle(text: string): Promise<void> {
    await this.editTextareaLocator().fill(text);
  }

  async submit(): Promise<void> {
    await this.editSubmitLocator().click();
  }
}
