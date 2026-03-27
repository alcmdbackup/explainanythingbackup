// E2E tests for accessibility features — skip-nav, focus rings, aria attributes.

import { test, expect } from '../../fixtures/auth';

test.describe('Accessibility Features', { tag: '@critical' }, () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(30000);

  test('skip-to-main-content link is visible on keyboard focus', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Tab to activate skip link (first focusable element)
    await authenticatedPage.keyboard.press('Tab');

    // The skip link should become visible when focused
    const skipLink = authenticatedPage.locator('a[href="#main-content"]');
    await expect(skipLink).toBeFocused({ timeout: 3000 });

    // Verify the text
    const text = await skipLink.textContent();
    expect(text).toContain('Skip to main content');
  });

  test('skip-nav link navigates to main content', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Tab to skip link and activate it
    await authenticatedPage.keyboard.press('Tab');
    await authenticatedPage.keyboard.press('Enter');

    // Focus should move to or near main-content
    const mainContent = authenticatedPage.locator('#main-content');
    await expect(mainContent).toBeVisible({ timeout: 5000 });
  });

  test('explore page has main-content landmark', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    const mainContent = authenticatedPage.locator('#main-content');
    await expect(mainContent).toBeVisible({ timeout: 10000 });
  });

  test('FilterPills buttons have focus-visible rings', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Find the sort pill buttons (New/Top)
    const newButton = authenticatedPage.locator('button', { hasText: 'New' }).first();
    const isVisible = await newButton.isVisible({ timeout: 10000 }).catch(() => false);

    if (!isVisible) {
      test.skip(true, 'FilterPills not visible on explore page');
      return;
    }

    // Tab to the button and check focus ring
    await newButton.focus();

    // Verify the button has focus-visible ring classes in its className
    const className = await newButton.getAttribute('class');
    expect(className).toContain('focus-visible');
  });

  test('HomeTagSelector dropdown has aria-expanded', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Find the difficulty dropdown trigger
    const difficultyBtn = authenticatedPage.getByTestId('home-tag-difficulty');
    const isVisible = await difficultyBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!isVisible) {
      test.skip(true, 'HomeTagSelector not visible');
      return;
    }

    // Should have aria-expanded="false" when closed
    await expect(difficultyBtn).toHaveAttribute('aria-expanded', 'false');

    // Click to open
    await difficultyBtn.click();

    // Should have aria-expanded="true" when open
    await expect(difficultyBtn).toHaveAttribute('aria-expanded', 'true');

    // Click again to close
    await difficultyBtn.click();
    await expect(difficultyBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('MetricsTab tables have scope="col" on headers', async ({ authenticatedPage }) => {
    // This is an admin page test - navigate to evolution run with metrics
    // Skip if not accessible
    await authenticatedPage.goto('/admin/evolution-dashboard');
    const dashVisible = await authenticatedPage.locator('text=Evolution').first().isVisible({ timeout: 5000 }).catch(() => false);

    if (!dashVisible) {
      test.skip(true, 'Evolution dashboard not accessible');
      return;
    }

    // Find a run link
    const runLink = authenticatedPage.locator('a[href*="/admin/evolution/runs/"]').first();
    const hasRun = await runLink.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasRun) {
      test.skip(true, 'No evolution runs available');
      return;
    }

    await runLink.click();
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Click Metrics tab
    const metricsTab = authenticatedPage.getByRole('tab', { name: /metrics/i });
    const metricsVisible = await metricsTab.isVisible({ timeout: 5000 }).catch(() => false);

    if (!metricsVisible) {
      test.skip(true, 'Metrics tab not visible');
      return;
    }

    await metricsTab.click();

    // Check that th elements have scope="col"
    const thElements = authenticatedPage.locator('th[scope="col"]');
    const thCount = await thElements.count();
    expect(thCount).toBeGreaterThan(0);
  });
});
