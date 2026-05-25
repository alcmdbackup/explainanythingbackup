// POM for /reset-password. Form is gated on PASSWORD_RECOVERY auth event
// firing client-side; submit() helper waits for the submit button to appear
// (proves both the event fired and the user isn't the guest).

import { Page, expect, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ResetPasswordPage extends BasePage {
  readonly newPasswordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly submitButton: Locator;
  readonly invalidMessage: Locator;
  readonly requestNewLink: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.newPasswordInput = page.getByTestId('reset-password-new');
    this.confirmPasswordInput = page.getByTestId('reset-password-confirm');
    this.submitButton = page.getByTestId('reset-password-submit');
    this.invalidMessage = page.getByTestId('reset-password-invalid');
    this.requestNewLink = page.getByTestId('reset-password-request-new');
    this.errorMessage = page.getByTestId('reset-password-error');
  }

  /**
   * Navigate via an arbitrary URL (typically a recovery action_link from
   * admin.generateLink that includes the token_hash in the query string).
   * Returns the response so callers can assert on status (e.g. 404 for the
   * guest-protection gate).
   */
  async gotoUrl(url: string) {
    return this.page.goto(url);
  }

  /**
   * Wait for the form to be enabled — proves the PASSWORD_RECOVERY event
   * fired and the user isn't the guest (both client-side gates passed).
   */
  async waitForFormEnabled() {
    await this.submitButton.waitFor({ state: 'visible', timeout: 30000 });
  }

  async submitNewPassword(password: string) {
    await this.newPasswordInput.fill(password);
    await this.confirmPasswordInput.fill(password);
    await this.submitButton.click();
    // updateUser returns either by redirecting away from /reset-password (success)
    // or by surfacing the error message. Wait for one of them so the caller
    // doesn't have to.
    await expect(this.page).not.toHaveURL(/\/reset-password/, { timeout: 15000 });
  }
}
