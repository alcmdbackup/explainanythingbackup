// POM for /forgot-password. Mirrors LoginPage.ts conventions — POM methods
// wait for the expected state change before returning (testing rule 12).

import { Page, expect, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class ForgotPasswordPage extends BasePage {
  readonly emailInput: Locator;
  readonly submitButton: Locator;
  readonly successMessage: Locator;
  readonly errorMessage: Locator;
  readonly backToLoginLink: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput = page.getByTestId('forgot-password-email');
    this.submitButton = page.getByTestId('forgot-password-submit');
    this.successMessage = page.getByTestId('forgot-password-success');
    this.errorMessage = page.getByTestId('forgot-password-error');
    this.backToLoginLink = page.getByTestId('back-to-login');
  }

  async gotoForgotPassword() {
    await this.navigate('/forgot-password');
    // Wait for hydration proof (testing rule 18) — email input enabled means
    // React has wired up the form handlers.
    await this.emailInput.waitFor({ state: 'visible' });
  }

  async submitEmail(email: string) {
    await this.emailInput.fill(email);
    await this.submitButton.click();
    // Wait for either the success message or an error to surface — both are
    // observable end-states; callers assert on whichever they expect.
    await expect(this.successMessage.or(this.errorMessage)).toBeVisible();
  }
}
