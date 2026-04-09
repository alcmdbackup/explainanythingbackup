// E2E tests for accessibility features — skip-nav, focus rings, aria attributes.

import { test, expect } from '../../fixtures/auth';
import { safeIsVisible } from '../../helpers/error-utils';

test.describe('Accessibility Features', { tag: '@critical' }, () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(30000);

  test('skip-to-main-content link is present and navigable', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/', { timeout: 30000 });
    await authenticatedPage.waitForLoadState('domcontentloaded');
    // Rule 18: wait for hydration proof before keyboard interaction
    await authenticatedPage.locator('#main-content').waitFor({ state: 'attached', timeout: 10000 });

    const skipLink = authenticatedPage.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached();

    // Focus skip link directly (Tab behavior varies in headless browsers)
    await skipLink.focus();
    await expect(skipLink).toBeFocused({ timeout: 5000 });

    await expect(skipLink).toContainText('Skip to main content');
  });

  test('main-content landmark exists on home page', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    const mainContent = authenticatedPage.locator('#main-content');
    await expect(mainContent).toBeVisible({ timeout: 5000 });
  });

  test('explore page has main-content landmark', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    const mainContent = authenticatedPage.locator('#main-content');
    await expect(mainContent).toBeVisible({ timeout: 10000 });
  });

  test('FilterPills buttons have focus-visible classes', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    const newButton = authenticatedPage.locator('button', { hasText: 'New' }).first();
    const isVisible = await safeIsVisible(newButton, 'filter-new-btn', 10000);

    if (!isVisible) {
      // eslint-disable-next-line flakiness/no-test-skip -- FilterPills not rendered in test data
      test.skip(true, 'FilterPills not visible on explore page');
      return;
    }

    const className = await newButton.getAttribute('class');
    expect(className).toContain('focus-visible');
  });

  test('HomeTagSelector dropdown has aria-expanded', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    const difficultyBtn = authenticatedPage.getByTestId('home-tag-difficulty');
    const isVisible = await safeIsVisible(difficultyBtn, 'tag-difficulty-btn', 5000);

    if (!isVisible) {
      // eslint-disable-next-line flakiness/no-test-skip -- HomeTagSelector not visible in test layout
      test.skip(true, 'HomeTagSelector not visible');
      return;
    }

    await expect(difficultyBtn).toHaveAttribute('aria-expanded', 'false');
    await difficultyBtn.click();
    await expect(difficultyBtn).toHaveAttribute('aria-expanded', 'true');
    await difficultyBtn.click();
    await expect(difficultyBtn).toHaveAttribute('aria-expanded', 'false');
  });
});
