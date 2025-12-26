import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../helpers/pages/LoginPage';

const authFile = '.auth/user.json';

setup('authenticate', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.login(
    process.env.TEST_USER_EMAIL || 'abecha@gmail.com',
    process.env.TEST_USER_PASSWORD || 'password'
  );

  // Wait for auth cookie directly instead of networkidle (which can hang in CI)
  // Supabase sets httpOnly cookies, so we poll the context cookies
  await expect(async () => {
    const cookies = await page.context().cookies();
    const hasAuthCookie = cookies.some(
      (c) => c.name.includes('supabase') || c.name.startsWith('sb-')
    );
    expect(hasAuthCookie).toBe(true);
  }).toPass({ timeout: 60000 });

  // Wait for redirect to complete (with longer timeout for CI)
  await page.waitForURL('/', { timeout: 60000 });

  // Save auth state for reuse by other tests
  await page.context().storageState({ path: authFile });
});
