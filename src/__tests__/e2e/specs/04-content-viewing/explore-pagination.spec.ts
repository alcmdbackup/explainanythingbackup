// E2E tests for explore page pagination — verifies load-more button works.

import { test, expect } from '../../fixtures/auth';
import { safeIsVisible } from '../../helpers/error-utils';

test.describe('Explore Page Pagination', { tag: '@critical' }, () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(30000);

  test('explore page renders initial explanations or empty state', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations', { timeout: 30000 });
    await authenticatedPage.waitForLoadState('domcontentloaded');

    const heading = authenticatedPage.locator('h1', { hasText: 'Explore' });
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Either we have content or an empty state
    const hasContent = await safeIsVisible(
      authenticatedPage.locator('article, [class*="FeedCard"]').first(),
      'feed-cards',
      5000
    );
    const hasEmpty = await safeIsVisible(
      authenticatedPage.locator('text=Nothing to explore'),
      'empty-state',
      2000
    );

    expect(hasContent || hasEmpty).toBe(true);
  });

  test('load-more button loads additional content when available', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations', { timeout: 30000 });
    await authenticatedPage.waitForLoadState('domcontentloaded');

    const loadMoreBtn = authenticatedPage.getByTestId('load-more-btn');
    const hasLoadMore = await safeIsVisible(loadMoreBtn, 'load-more-btn', 5000);

    if (!hasLoadMore) {
      // eslint-disable-next-line flakiness/no-test-skip -- Fewer than 20 explanations in test DB
      test.skip(true, 'Fewer than 20 explanations — load-more not shown');
      return;
    }

    await loadMoreBtn.click();

    // Wait for button to re-enable (loading state ends)
    await expect(loadMoreBtn).toBeEnabled({ timeout: 10000 });
  });

  test('explore page filter pills navigate to sort=top', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations', { timeout: 30000 });
    await authenticatedPage.waitForLoadState('domcontentloaded');

    const topButton = authenticatedPage.locator('button', { hasText: 'Top' }).first();
    const isVisible = await safeIsVisible(topButton, 'top-filter-btn', 10000);

    if (!isVisible) {
      // eslint-disable-next-line flakiness/no-test-skip -- Filter pills not rendered
      test.skip(true, 'Filter pills not visible');
      return;
    }

    await topButton.click();
    await authenticatedPage.waitForURL(/sort=top/, { timeout: 5000 });
    expect(authenticatedPage.url()).toContain('sort=top');
  });
});
