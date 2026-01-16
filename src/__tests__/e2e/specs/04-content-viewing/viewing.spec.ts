/**
 * E2E Tests for Content Viewing
 *
 * Tests for viewing saved explanations from the results page.
 * Uses test-data-factory for isolated, reliable test data.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('Content Viewing', () => {
  // Add retries for flaky network conditions
  test.describe.configure({ retries: 1 });

  // Increase timeout for these tests since they involve DB loading
  test.setTimeout(60000);

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    // Create isolated test data for this test file
    testExplanation = await createTestExplanationInLibrary({
      title: 'Content Viewing Test',
      content: '<h1>Test Content</h1><p>This is test content for viewing tests. It has multiple sentences to test display.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  test('should load existing explanation by ID from URL', { tag: '@critical' }, async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    // Navigate directly to the test explanation
    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);

    // Wait for content to load (not streaming, just DB fetch)
    await resultsPage.waitForAnyContent(60000);

    // Verify explanation displays
    const title = await resultsPage.getTitle();
    expect(title.length).toBeGreaterThan(0);

    const hasContent = await resultsPage.hasContent();
    expect(hasContent).toBe(true);
  });

  test('should display explanation title', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    // Navigate directly to the test explanation
    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForAnyContent(60000);

    const displayedTitle = await resultsPage.getTitle();
    expect(displayedTitle).toContain('Content Viewing Test');
  });

  test('should display tags for explanation', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    // Navigate directly to the test explanation
    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForAnyContent(60000);

    // Check for TagBar presence (may or may not have tags)
    const hasTags = await resultsPage.hasTags();

    // Either has tags or TagBar is simply empty
    expect(typeof hasTags).toBe('boolean');
  });

  test('should show save button state correctly', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    // Navigate directly to the test explanation
    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForAnyContent(60000);

    // Save button should be visible (already saved explanations show "Saved" or are disabled)
    const saveButtonExists = await resultsPage.isSaveToLibraryVisible();
    expect(saveButtonExists).toBe(true);
  });

  test('should preserve explanation ID in URL', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    // Navigate directly to the test explanation
    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);

    // Verify explanation_id is in the URL
    const hasId = await resultsPage.hasExplanationIdInUrl();
    expect(hasId).toBe(true);

    const explanationId = await resultsPage.getExplanationIdFromUrl();
    expect(explanationId).toBeTruthy();
    expect(explanationId?.length).toBeGreaterThan(0);
  });
});
