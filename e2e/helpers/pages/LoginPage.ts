import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  private emailInput = '[data-testid="login-email"]';
  private passwordInput = '[data-testid="login-password"]';
  private submitButton = '[data-testid="login-submit"]';
  private errorMessage = '[data-testid="login-error"]';
  private signupToggle = '[data-testid="signup-toggle"]';

  constructor(page: Page) {
    super(page);
  }

  async navigate() {
    await super.navigate('/login');
  }

  async login(email: string, password: string) {
    await this.page.fill(this.emailInput, email);
    await this.page.fill(this.passwordInput, password);
    await this.page.click(this.submitButton);
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
    return cookies.some((c) => c.name.includes('supabase'));
  }

  async fillEmail(email: string) {
    await this.page.fill(this.emailInput, email);
  }

  async fillPassword(password: string) {
    await this.page.fill(this.passwordInput, password);
  }

  async clickSubmit() {
    await this.page.click(this.submitButton);
  }
}
