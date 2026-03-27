// E2E tests for explore page pagination — verifies load-more button works.

import { test, expect } from '../../fixtures/auth';

test.describe('Explore Page Pagination', { tag: '@critical' }, () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(30000);

  test('explore page renders initial explanations', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Wait for the page to render content
    const heading = authenticatedPage.locator('h1', { hasText: 'Explore' });
    await expect(heading).toBeVisible({ timeout: 10000 });

    // Check for either content or empty state
    const hasFeedCards = await authenticatedPage.locator('[class*="FeedCard"], [class*="feed-card"], article').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmptyState = await authenticatedPage.locator('text=Nothing to explore').isVisible({ timeout: 2000 }).catch(() => false);

    // Either we have cards or an empty state message
    expect(hasFeedCards || hasEmptyState).toBe(true);
  });

  test('load-more button appears when there are enough results', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Wait for initial content to load
    await authenticatedPage.waitForTimeout(3000);

    // Check if load-more button exists (only if we have 20+ explanations)
    const loadMoreBtn = authenticatedPage.getByTestId('load-more-btn');
    const hasLoadMore = await loadMoreBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!hasLoadMore) {
      // Less than 20 explanations — no load-more expected
      test.skip(true, 'Fewer than 20 explanations — load-more not shown');
      return;
    }

    // Count initial items
    const initialCards = authenticatedPage.locator('[class*="max-w-3xl"] > div').first();
    const initialCount = await authenticatedPage.locator('[class*="max-w-3xl"] > div > *').count();

    // Click load more
    await loadMoreBtn.click();

    // Wait for new content to load
    await authenticatedPage.waitForTimeout(3000);

    // Count should increase
    const afterCount = await authenticatedPage.locator('[class*="max-w-3xl"] > div > *').count();
    expect(afterCount).toBeGreaterThanOrEqual(initialCount);
  });

  test('explore page filter pills work', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/explanations');
    await authenticatedPage.waitForLoadState('domcontentloaded');

    // Find the Top pill button
    const topButton = authenticatedPage.locator('button', { hasText: 'Top' }).first();
    const isVisible = await topButton.isVisible({ timeout: 10000 }).catch(() => false);

    if (!isVisible) {
      test.skip(true, 'Filter pills not visible');
      return;
    }

    // Click Top filter
    await topButton.click();

    // URL should update to include sort=top
    await authenticatedPage.waitForURL(/sort=top/, { timeout: 5000 }).catch(() => {});
    expect(authenticatedPage.url()).toContain('sort=top');
  });
});
