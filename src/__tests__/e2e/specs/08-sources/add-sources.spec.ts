/**
 * E2E tests for Add Sources feature
 * Tests the full flow of adding URL sources to ground explanations with citations
 *
 * Only "Sources with Search" test is @critical (CI critical path)
 * Other tests run in full E2E suite (nightly, production PRs)
 */

import { test, expect } from '../../fixtures/auth';

// Test timeout for LLM/network operations
test.describe.configure({ retries: 1 });

/**
 * Test URLs - using reliable public sites
 * Wikipedia is ideal as it's always accessible and was the regression trigger
 */
const WIKIPEDIA_URL = 'https://en.wikipedia.org/wiki/Quantum_computing';
const MALFORMED_URL = 'not-a-valid-url';

test.describe('Add Sources Feature', () => {
  test.describe('Source Input Flow', () => {
    test('should expand sources section when clicking "+ Add sources"', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/');
      await authenticatedPage.waitForLoadState('domcontentloaded');

      // Click the add sources toggle
      const toggle = authenticatedPage.locator('[data-testid="add-sources-toggle"]');
      await expect(toggle).toBeVisible({ timeout: 10000 });
      await toggle.click();

      // Source input should now be visible
      const sourceInput = authenticatedPage.locator('[data-testid="source-url-input"]');
      await expect(sourceInput).toBeVisible({ timeout: 5000 });
    });

    test('should add Wikipedia source successfully (regression test)', async ({ authenticatedPage }) => {
      test.setTimeout(30000); // Allow time for fetch

      await authenticatedPage.goto('/');
      await authenticatedPage.waitForLoadState('domcontentloaded');

      // Expand sources section
      const toggle = authenticatedPage.locator('[data-testid="add-sources-toggle"]');
      await expect(toggle).toBeVisible({ timeout: 10000 });
      await toggle.click();

      // Enter Wikipedia URL
      const sourceInput = authenticatedPage.locator('[data-testid="source-url-input"]');
      await expect(sourceInput).toBeVisible({ timeout: 5000 });
      await sourceInput.fill(WIKIPEDIA_URL);

      // Click add button
      const addButton = authenticatedPage.locator('[data-testid="source-add-button"]');
      await addButton.click();

      // Wait for loading chip to appear then transition to success
      const loadingChip = authenticatedPage.locator('[data-testid="source-chip-loading"]');
      await expect(loadingChip).toBeVisible({ timeout: 5000 });

      // Wait for success chip (loading chip disappears, success chip appears)
      const successChip = authenticatedPage.locator('[data-testid="source-chip-success"]');
      await expect(successChip).toBeVisible({ timeout: 20000 });

      // Verify success chip shows title (not just domain)
      const chipText = await successChip.textContent();
      expect(chipText).toBeTruthy();
      expect(chipText!.toLowerCase()).toContain('quantum');

      // Verify NO error message appears
      const errorMessage = authenticatedPage.locator('[data-testid="sources-failed-message"]');
      await expect(errorMessage).not.toBeVisible();
    });

    test('should show validation error for invalid URL format', async ({ authenticatedPage }) => {
      await authenticatedPage.goto('/');
      await authenticatedPage.waitForLoadState('domcontentloaded');

      // Expand sources section
      const toggle = authenticatedPage.locator('[data-testid="add-sources-toggle"]');
      await toggle.click();

      // Enter invalid URL
      const sourceInput = authenticatedPage.locator('[data-testid="source-url-input"]');
      await expect(sourceInput).toBeVisible({ timeout: 5000 });
      await sourceInput.fill(MALFORMED_URL);

      // Click add button
      const addButton = authenticatedPage.locator('[data-testid="source-add-button"]');
      await addButton.click();

      // Should show validation error (inline, not chip)
      const errorText = authenticatedPage.locator('text=Please enter a valid URL');
      await expect(errorText).toBeVisible({ timeout: 5000 });

      // No chip should be added
      const anyChip = authenticatedPage.locator('[data-testid^="source-chip-"]');
      await expect(anyChip).not.toBeVisible();
    });

    test('should handle failed source fetch gracefully', async ({ authenticatedPage }) => {
      test.setTimeout(30000);

      await authenticatedPage.goto('/');
      await authenticatedPage.waitForLoadState('domcontentloaded');

      // Expand sources section
      const toggle = authenticatedPage.locator('[data-testid="add-sources-toggle"]');
      await toggle.click();

      // Enter a URL that will fail to fetch (non-existent domain)
      const sourceInput = authenticatedPage.locator('[data-testid="source-url-input"]');
      await expect(sourceInput).toBeVisible({ timeout: 5000 });
      await sourceInput.fill('https://this-domain-definitely-does-not-exist-12345.com/article');

      // Click add button
      const addButton = authenticatedPage.locator('[data-testid="source-add-button"]');
      await addButton.click();

      // Wait for loading chip
      const loadingChip = authenticatedPage.locator('[data-testid="source-chip-loading"]');
      await expect(loadingChip).toBeVisible({ timeout: 5000 });

      // Wait for failed chip (network error)
      const failedChip = authenticatedPage.locator('[data-testid="source-chip-failed"]');
      await expect(failedChip).toBeVisible({ timeout: 20000 });

      // Error message should appear
      const errorMessage = authenticatedPage.locator('[data-testid="sources-failed-message"]');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    });

    test('should allow removing a source chip', async ({ authenticatedPage }) => {
      test.setTimeout(30000);

      await authenticatedPage.goto('/');
      await authenticatedPage.waitForLoadState('domcontentloaded');

      // Expand sources section
      const toggle = authenticatedPage.locator('[data-testid="add-sources-toggle"]');
      await toggle.click();

      // Add a source
      const sourceInput = authenticatedPage.locator('[data-testid="source-url-input"]');
      await expect(sourceInput).toBeVisible({ timeout: 5000 });
      await sourceInput.fill(WIKIPEDIA_URL);

      const addButton = authenticatedPage.locator('[data-testid="source-add-button"]');
      await addButton.click();

      // Wait for success chip
      const successChip = authenticatedPage.locator('[data-testid="source-chip-success"]');
      await expect(successChip).toBeVisible({ timeout: 20000 });

      // Click remove button on chip
      const removeButton = successChip.locator('button[aria-label="Remove source"]');
      await removeButton.click();

      // Chip should be removed
      await expect(successChip).not.toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Sources with Search', () => {
    test('should include sources when submitting search', { tag: '@critical' }, async ({ authenticatedPage }) => {
      test.setTimeout(45000);

      await authenticatedPage.goto('/');
      await authenticatedPage.waitForLoadState('domcontentloaded');

      // Add a source first
      const toggle = authenticatedPage.locator('[data-testid="add-sources-toggle"]');
      await toggle.click();

      const sourceInput = authenticatedPage.locator('[data-testid="source-url-input"]');
      await expect(sourceInput).toBeVisible({ timeout: 5000 });
      await sourceInput.fill(WIKIPEDIA_URL);

      const addButton = authenticatedPage.locator('[data-testid="source-add-button"]');
      await addButton.click();

      // Wait for success chip
      const successChip = authenticatedPage.locator('[data-testid="source-chip-success"]');
      await expect(successChip).toBeVisible({ timeout: 20000 });

      // Enter search query
      const searchInput = authenticatedPage.locator('[data-testid="search-input"]');
      await searchInput.fill('Explain quantum computing');

      // Submit search
      const searchButton = authenticatedPage.locator('[data-testid="search-submit"]');
      await searchButton.click();

      // Should navigate to results page
      await authenticatedPage.waitForURL(/\/results/, { timeout: 10000 });
      expect(authenticatedPage.url()).toContain('/results');
    });
  });
});
