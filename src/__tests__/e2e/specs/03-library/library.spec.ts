/**
 * E2E Tests for User Library Management
 *
 * Tests library page functionality using FeedCard-based layout.
 * Uses test-data-factory to ensure test data exists (no conditional skips).
 */
import { test, expect } from '../../fixtures/auth';
import { UserLibraryPage } from '../../helpers/pages/UserLibraryPage';
import { safeIsVisible } from '../../helpers/error-utils';
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('User Library Management', () => {
  // Run tests serially to avoid shared data contention
  test.describe.configure({ mode: 'serial' });

  let libraryPage: UserLibraryPage;
  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    // Create test data to ensure library is never empty
    testExplanation = await createTestExplanationInLibrary({
      title: 'Library Test Explanation',
      content: '<p>Test content for library management tests.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  test.beforeEach(async ({ authenticatedPage }) => {
    libraryPage = new UserLibraryPage(authenticatedPage);
  });

  // Helper to wait for page to finish loading (content or error)
  async function waitForPageReady(page: UserLibraryPage, timeout: number = 30000) {
    await page.waitForContentOrError(timeout);
  }

  test('should display user library page after authentication', async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // Should show either content cards, empty state, OR error message
    const hasCards = await safeIsVisible(
      authenticatedPage.locator('[data-testid="feed-card"]'),
      'library.spec (cards)'
    );
    const hasEmptyState = await safeIsVisible(
      authenticatedPage.locator('[data-testid="library-empty-state"]'),
      'library.spec (empty state)'
    );
    const hasError = await safeIsVisible(
      authenticatedPage.locator('[data-testid="library-error"]'),
      'library.spec (error)'
    );

    // Page should render something after loading
    expect(hasCards || hasEmptyState || hasError).toBe(true);
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  test('should display page title when content loads', async ({ authenticatedPage: _page }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // Page title should always be visible regardless of content state
    const pageTitle = await libraryPage.getPageTitle();
    expect(pageTitle).toContain('My Library');
  });

  test('should display FeedCard components for saved explanations', async () => {
    await libraryPage.navigate();
    // Wait specifically for cards to load (test data created in beforeAll)
    await libraryPage.waitForCards(30000);

    // Should have at least one card
    const cardCount = await libraryPage.getCardCount();
    expect(cardCount).toBeGreaterThan(0);
  });

  test('should navigate to results page when clicking card', async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    // Wait specifically for cards (test data created in beforeAll)
    await libraryPage.waitForCards(30000);
    const cardCount = await libraryPage.getCardCount();
    expect(cardCount).toBeGreaterThan(0);

    // Click the first card
    await libraryPage.clickCardByIndex(0);

    // Should navigate to results page with explanation_id
    await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 10000 });
    const url = authenticatedPage.url();
    expect(url).toContain('/results?explanation_id=');
  });

  test('should show saved date on cards', async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    // Wait specifically for cards (test data created in beforeAll)
    await libraryPage.waitForCards(30000);
    const cardCount = await libraryPage.getCardCount();
    expect(cardCount).toBeGreaterThan(0);

    // Cards should have saved-date element
    const savedDates = authenticatedPage.locator('[data-testid="saved-date"]');
    const savedDateCount = await savedDates.count();
    expect(savedDateCount).toBeGreaterThan(0);
  });

  test('should have search bar in navigation', async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // With test data created in beforeAll, cards should be visible
    const hasCards = await safeIsVisible(
      authenticatedPage.locator('[data-testid="feed-card"]'),
      'library.spec (search bar check)'
    );
    expect(hasCards).toBe(true);

    const hasSearchBar = await libraryPage.hasSearchBar();
    expect(hasSearchBar).toBe(true);
  });

  test('should handle search from library page', async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // Search bar should always be present in navigation
    const hasSearchBar = await libraryPage.hasSearchBar();
    expect(hasSearchBar).toBe(true);

    // Use the search bar in the navigation (nav variant uses Enter key, no submit button)
    const searchInput = authenticatedPage.locator('[data-testid="search-input"]');
    await searchInput.fill('quantum');
    await searchInput.press('Enter');

    // Should navigate to results page
    await authenticatedPage.waitForURL(/\/results\?q=/, { timeout: 10000 });
    const url = authenticatedPage.url();
    expect(url).toContain('/results?q=quantum');
  });

  // NOTE: Auth test moved to unauth.spec.ts since it requires unauthenticated state
});
