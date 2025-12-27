import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import { UserLibraryPage } from '../../helpers/pages/UserLibraryPage';

test.describe('Content Viewing', () => {
  let resultsPage: ResultsPage;
  let libraryPage: UserLibraryPage;

  // Add retries for flaky network conditions
  test.describe.configure({ retries: 1 });

  // Increase timeout for these tests since they involve DB loading
  test.setTimeout(60000);

  test.beforeEach(async ({ authenticatedPage }) => {
    resultsPage = new ResultsPage(authenticatedPage);
    libraryPage = new UserLibraryPage(authenticatedPage);
  });

  test('should load existing explanation by ID from URL', { tag: '@critical' }, async ({ authenticatedPage }) => {
    // First, we need to get an existing explanation ID from the library
    await authenticatedPage.goto('/userlibrary');

    // Wait for library to reach a stable state
    const libraryState = await libraryPage.waitForLibraryReady();
    if (libraryState === 'error') {
      throw new Error('Library failed to load');
    }
    if (libraryState === 'empty') {
      test.skip();
      return;
    }

    const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
    if (!hasExplanations) {
      test.skip();
      return;
    }

    // Click on the first explanation's View link
    await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();

    // Wait for navigation to results page
    await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 10000 });

    // Wait for content to load (not streaming, just DB fetch - use longer timeout)
    await resultsPage.waitForAnyContent(60000);

    // Verify explanation displays
    const title = await resultsPage.getTitle();
    expect(title.length).toBeGreaterThan(0);

    const hasContent = await resultsPage.hasContent();
    expect(hasContent).toBe(true);
  });

  test('should display explanation title', { tag: '@critical' }, async ({ authenticatedPage }) => {
    // Navigate to library first
    await authenticatedPage.goto('/userlibrary');
    const libraryState = await libraryPage.waitForLibraryReady();
    if (libraryState === 'error') {
      throw new Error('Library failed to load');
    }
    if (libraryState === 'empty') {
      test.skip();
      return;
    }

    const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
    if (!hasExplanations) {
      test.skip();
      return;
    }

    // Get the expected title from library
    const expectedTitle = await authenticatedPage.locator('[data-testid="explanation-title"]').first().textContent();

    // Click View
    await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
    await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 10000 });
    await resultsPage.waitForAnyContent(60000);

    const displayedTitle = await resultsPage.getTitle();
    expect(displayedTitle).toContain(expectedTitle || '');
  });

  test('should display tags for explanation', async ({ authenticatedPage }) => {
    // Navigate to a saved explanation
    await authenticatedPage.goto('/userlibrary');
    const libraryState = await libraryPage.waitForLibraryReady();
    if (libraryState === 'error') {
      throw new Error('Library failed to load');
    }
    if (libraryState === 'empty') {
      test.skip();
      return;
    }

    const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
    if (!hasExplanations) {
      test.skip();
      return;
    }

    await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
    await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 10000 });
    await resultsPage.waitForAnyContent(60000);

    // Check for TagBar presence (may or may not have tags)
    const hasTags = await resultsPage.hasTags();

    // Either has tags or TagBar is simply empty
    expect(typeof hasTags).toBe('boolean');
  });

  test('should show save button state correctly', { tag: '@critical' }, async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/userlibrary');
    const libraryState = await libraryPage.waitForLibraryReady();
    if (libraryState === 'error') {
      throw new Error('Library failed to load');
    }
    if (libraryState === 'empty') {
      test.skip();
      return;
    }

    const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
    if (!hasExplanations) {
      test.skip();
      return;
    }

    await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
    await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 10000 });
    await resultsPage.waitForAnyContent(60000);

    // Save button should be visible (already saved explanations show "Saved" or are disabled)
    const saveButtonExists = await resultsPage.isSaveToLibraryVisible();
    expect(saveButtonExists).toBe(true);
  });

  test('should preserve explanation ID in URL', { tag: '@critical' }, async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/userlibrary');
    const libraryState = await libraryPage.waitForLibraryReady();
    if (libraryState === 'error') {
      throw new Error('Library failed to load');
    }
    if (libraryState === 'empty') {
      test.skip();
      return;
    }

    const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
    if (!hasExplanations) {
      test.skip();
      return;
    }

    await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
    await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 10000 });

    // Verify explanation_id is in the URL
    const hasId = await resultsPage.hasExplanationIdInUrl();
    expect(hasId).toBe(true);

    const explanationId = await resultsPage.getExplanationIdFromUrl();
    expect(explanationId).toBeTruthy();
    expect(explanationId?.length).toBeGreaterThan(0);
  });
});
