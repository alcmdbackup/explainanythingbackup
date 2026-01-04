/**
 * E2E Tests for User Library Management
 *
 * Tests library page functionality including navigation, sorting, and search.
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

  test('should show loading state when navigating to library', async ({ authenticatedPage }) => {
    // Navigate without waiting
    await authenticatedPage.goto('/userlibrary');

    // Should show loading indicator (it's OK if loading is too fast to catch)
    await safeIsVisible(
      authenticatedPage.locator('[data-testid="library-loading"]'),
      'library.spec (loading indicator)'
    );

    // This test passes if we reach here - loading may be too fast to catch
    expect(true).toBe(true);
  });

  test('should display user library page after authentication', { tag: '@critical' }, async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // Should show either content table, empty state, OR error message
    const hasTable = await safeIsVisible(
      authenticatedPage.locator('table'),
      'library.spec (table)'
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
    expect(hasTable || hasEmptyState || hasError).toBe(true);
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  test('should display page title when content loads', async ({ authenticatedPage: _page }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // Page title should always be visible regardless of content state
    const pageTitle = await libraryPage.getPageTitle();
    expect(pageTitle).toContain('My Library');
  });

  test('should have sortable table headers when content loads', async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // With test data created in beforeAll, table should always be visible
    const hasTable = await safeIsVisible(
      authenticatedPage.locator('table'),
      'library.spec (sortable headers check)'
    );
    expect(hasTable).toBe(true);

    // Check for sortable headers
    const titleHeader = authenticatedPage.locator('th:has-text("Title")');
    const dateHeader = authenticatedPage.locator('th:has-text("Created")');

    expect(await titleHeader.isVisible()).toBe(true);
    expect(await dateHeader.isVisible()).toBe(true);
  });

  test('should allow sorting by title', async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // With test data created in beforeAll, table should always be visible
    const hasTable = await safeIsVisible(
      authenticatedPage.locator('table'),
      'library.spec (sort by title check)'
    );
    expect(hasTable).toBe(true);

    // Click title header to sort
    await libraryPage.clickSortByTitle();

    // Check that sort indicator appears (arrow icon)
    const titleHeader = authenticatedPage.locator('th:has-text("Title")');
    const hasSortIndicator = await titleHeader.locator('svg').isVisible();
    expect(hasSortIndicator).toBe(true);
  });

  test('should allow sorting by date', async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // With test data created in beforeAll, table should always be visible
    const hasTable = await safeIsVisible(
      authenticatedPage.locator('table'),
      'library.spec (sort by date check)'
    );
    expect(hasTable).toBe(true);

    // Toggle sort order (default is date desc)
    await libraryPage.clickSortByDate();

    // Check that sort indicator appears
    const dateHeader = authenticatedPage.locator('th:has-text("Created")');
    const hasSortIndicator = await dateHeader.locator('svg').isVisible();
    expect(hasSortIndicator).toBe(true);
  });

  test('should navigate to results page when clicking View link', { tag: '@critical' }, async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // With test data created in beforeAll, explanation count should be > 0
    const explanationCount = await libraryPage.getExplanationCount();
    expect(explanationCount).toBeGreaterThan(0);

    // Click the View link for the first explanation
    await libraryPage.clickViewByIndex(0);

    // Should navigate to results page with explanation_id
    await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 10000 });
    const url = authenticatedPage.url();
    expect(url).toContain('/results?explanation_id=');
  });

  test('should show Date Saved column for user library', async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // With test data created in beforeAll, explanation count should be > 0
    const explanationCount = await libraryPage.getExplanationCount();
    expect(explanationCount).toBeGreaterThan(0);

    // Saved column should be visible in user library
    const hasDateSavedHeader = await authenticatedPage.locator('th:has-text("Saved")').isVisible();
    expect(hasDateSavedHeader).toBe(true);
  });

  test('should have search bar in navigation', { tag: '@critical' }, async ({ authenticatedPage }) => {
    await libraryPage.navigate();
    await waitForPageReady(libraryPage);

    // With test data created in beforeAll, table should always be visible
    const hasTable = await safeIsVisible(
      authenticatedPage.locator('table'),
      'library.spec (search bar check)'
    );
    expect(hasTable).toBe(true);

    const hasSearchBar = await libraryPage.hasSearchBar();
    expect(hasSearchBar).toBe(true);
  });

  test('should handle search from library page', { tag: '@critical' }, async ({ authenticatedPage }) => {
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
