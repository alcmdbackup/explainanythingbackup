import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  // Use accessible selectors as primary (more robust than data-testid)
  private emailInput = '#email';
  private passwordInput = '#password';
  private submitButton = 'button[type="submit"]';
  private errorMessage = '[data-testid="login-error"]';
  private signupToggle = 'button:has-text("Sign up")';

  constructor(page: Page) {
    super(page);
  }

  async navigate() {
    await super.navigate('/login');
  }

  async login(email: string, password: string) {
    // Wait for form to be ready (React hydration complete)
    await this.page.locator(this.emailInput).waitFor({ state: 'visible' });

    // Use locator-based fill (waits for actionability)
    await this.page.locator(this.emailInput).fill(email);
    await this.page.locator(this.passwordInput).fill(password);
    await this.page.locator(this.submitButton).click();
  }

  async getErrorMessage() {
    const errorElement = this.page.locator(this.errorMessage);
    if (await errorElement.isVisible()) {
      return await errorElement.textContent();
    }
    return null;
  }

  async isErrorVisible() {
    return await this.page.locator(this.errorMessage).isVisible();
  }

  async toggleToSignup() {
    await this.page.click(this.signupToggle);
  }

  async isLoggedIn() {
    const cookies = await this.page.context().cookies();
    // Supabase cookies use 'sb-' prefix or 'supabase' in name
    return cookies.some((c) => c.name.includes('supabase') || c.name.startsWith('sb-'));
  }

  async fillEmail(email: string) {
    await this.page.locator(this.emailInput).fill(email);
  }

  async fillPassword(password: string) {
    await this.page.locator(this.passwordInput).fill(password);
  }

  async clickSubmit() {
    await this.page.locator(this.submitButton).click();
  }
}
