/**
 * E2E tests for home page tabbed interface.
 * Tests Search/Import tab switching, source management, tag selection, and form submission.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import { mockReturnExplanationAPI, defaultMockExplanation } from '../../helpers/api-mocks';

test.describe('Home Page Tabs', () => {
  test.describe('Tab Switching', () => {
    test('should display Search tab by default', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Check Search tab is active
      const searchTab = page.locator('[data-testid="home-tab-search"]');
      await expect(searchTab).toHaveAttribute('aria-selected', 'true');

      // Check Search panel is visible
      const searchPanel = page.locator('#search-panel');
      await expect(searchPanel).toBeVisible();
    });

    test('should switch to Import tab when clicked', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Click Import tab
      const importTab = page.locator('[data-testid="home-tab-import"]');
      await importTab.click();

      // Check Import tab is active
      await expect(importTab).toHaveAttribute('aria-selected', 'true');

      // Check Import panel is visible
      const importPanel = page.locator('#import-panel');
      await expect(importPanel).toBeVisible();

      // Check Search panel is hidden
      const searchPanel = page.locator('#search-panel');
      await expect(searchPanel).not.toBeVisible();
    });

    test('should preserve state when switching tabs', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Enter query in Search tab
      const searchInput = page.locator('[data-testid="home-search-input"]');
      await searchInput.fill('quantum entanglement');

      // Switch to Import tab
      const importTab = page.locator('[data-testid="home-tab-import"]');
      await importTab.click();

      // Switch back to Search tab
      const searchTab = page.locator('[data-testid="home-tab-search"]');
      await searchTab.click();

      // Verify query is preserved
      await expect(searchInput).toHaveValue('quantum entanglement');
    });
  });

  test.describe('Search Tab - Query Input', () => {
    test('should enable search button when query is entered', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const searchInput = page.locator('[data-testid="home-search-input"]');
      const searchButton = page.locator('[data-testid="home-search-submit"]');

      // Button should be disabled initially
      await expect(searchButton).toBeDisabled();

      // Enter query
      await searchInput.fill('test query');

      // Button should be enabled
      await expect(searchButton).toBeEnabled();
    });

    test('should submit search on Enter key', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Mock the API
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const searchInput = page.locator('[data-testid="home-search-input"]');
      await searchInput.fill('quantum entanglement');
      await searchInput.press('Enter');

      // Should navigate to results page
      await page.waitForURL(/\/results\?q=/, { timeout: 10000 });
      const query = await resultsPage.getQueryFromUrl();
      expect(query).toContain('quantum entanglement');
    });

    test('should submit search on button click', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);

      // Mock the API
      await mockReturnExplanationAPI(page, defaultMockExplanation);

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const searchInput = page.locator('[data-testid="home-search-input"]');
      const searchButton = page.locator('[data-testid="home-search-submit"]');

      await searchInput.fill('quantum entanglement');
      await searchButton.click();

      // Should navigate to results page
      await page.waitForURL(/\/results\?q=/, { timeout: 10000 });
      const query = await resultsPage.getQueryFromUrl();
      expect(query).toContain('quantum entanglement');
    });

    test('should not submit on Shift+Enter (for newline)', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const searchInput = page.locator('[data-testid="home-search-input"]');
      await searchInput.fill('quantum entanglement');
      await searchInput.press('Shift+Enter');

      // Should still be on home page
      expect(page.url()).not.toContain('/results');
    });
  });

  test.describe('Search Tab - Tag Selection', () => {
    test('should display tag selector with default values', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Check difficulty dropdown shows Intermediate
      const difficultyButton = page.locator('[data-testid="home-tag-difficulty"]');
      await expect(difficultyButton).toContainText('Intermediate');

      // Check length dropdown shows Standard
      const lengthButton = page.locator('[data-testid="home-tag-length"]');
      await expect(lengthButton).toContainText('Standard');
    });

    test('should allow changing difficulty preset', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Click difficulty dropdown
      const difficultyButton = page.locator('[data-testid="home-tag-difficulty"]');
      await difficultyButton.click();

      // Select Advanced - dropdown uses custom buttons, not native <option> elements
      const advancedOption = page.getByRole('button', { name: 'Advanced' });
      await advancedOption.click();

      // Verify selection
      await expect(difficultyButton).toContainText('Advanced');
    });

    test('should allow changing length preset', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Click length dropdown
      const lengthButton = page.locator('[data-testid="home-tag-length"]');
      await lengthButton.click();

      // Select Brief - dropdown uses custom buttons, not native <option> elements
      const briefOption = page.getByRole('button', { name: 'Brief' });
      await briefOption.click();

      // Verify selection
      await expect(lengthButton).toContainText('Brief');
    });
  });

  test.describe('Search Tab - Sources', () => {
    test('should display Add URL button', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      const addSourceButton = page.locator('[data-testid="home-add-source-button"]');
      await expect(addSourceButton).toBeVisible();
    });

    test('should show URL input when Add URL is clicked', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Click Add URL
      const addSourceButton = page.locator('[data-testid="home-add-source-button"]');
      await addSourceButton.click();

      // URL input should appear
      const urlInput = page.locator('[data-testid="home-source-url-input"]');
      await expect(urlInput).toBeVisible();
    });
  });

  test.describe('Import Tab', () => {
    test('should display import textarea with placeholder', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Switch to Import tab
      const importTab = page.locator('[data-testid="home-tab-import"]');
      await importTab.click();

      // Check textarea has placeholder
      const importInput = page.locator('[data-testid="home-import-input"]');
      await expect(importInput).toHaveAttribute('placeholder', 'Paste content from ChatGPT, Claude, or Gemini...');
    });

    test('should disable Process button when content is too short', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Switch to Import tab
      const importTab = page.locator('[data-testid="home-tab-import"]');
      await importTab.click();

      const importInput = page.locator('[data-testid="home-import-input"]');
      const processButton = page.locator('[data-testid="home-import-submit"]');

      // Button should be disabled with no content
      await expect(processButton).toBeDisabled();

      // Enter short content (less than 100 chars)
      await importInput.fill('This is short content');

      // Button should still be disabled
      await expect(processButton).toBeDisabled();
    });

    test('should enable Process button when content is 100+ characters', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Switch to Import tab
      const importTab = page.locator('[data-testid="home-tab-import"]');
      await importTab.click();

      const importInput = page.locator('[data-testid="home-import-input"]');
      const processButton = page.locator('[data-testid="home-import-submit"]');

      // Enter long content (100+ chars)
      const longContent = 'x'.repeat(101);
      await importInput.fill(longContent);

      // Button should be enabled
      await expect(processButton).toBeEnabled();
    });

    test('should display AI source dropdown', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Switch to Import tab
      const importTab = page.locator('[data-testid="home-tab-import"]');
      await importTab.click();

      // Check source dropdown exists
      const sourceSelect = page.locator('[data-testid="home-import-source"]');
      await expect(sourceSelect).toBeVisible();

      // Default should be "other"
      await expect(sourceSelect).toHaveValue('other');
    });
  });

  test.describe('Accessibility', () => {
    test('should have correct ARIA attributes on tabs', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Check tablist role
      const tablist = page.getByRole('tablist');
      await expect(tablist).toBeVisible();

      // Check tab roles
      const searchTab = page.locator('[data-testid="home-tab-search"]');
      const importTab = page.locator('[data-testid="home-tab-import"]');

      await expect(searchTab).toHaveAttribute('role', 'tab');
      await expect(importTab).toHaveAttribute('role', 'tab');

      // Check aria-controls
      await expect(searchTab).toHaveAttribute('aria-controls', 'search-panel');
      await expect(importTab).toHaveAttribute('aria-controls', 'import-panel');
    });

    test('should have correct ARIA attributes on tab panels', async ({ authenticatedPage: page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');

      // Check search panel
      const searchPanel = page.locator('#search-panel');
      await expect(searchPanel).toHaveAttribute('role', 'tabpanel');
      await expect(searchPanel).toHaveAttribute('aria-labelledby', 'search-tab');

      // Switch to Import tab
      const importTab = page.locator('[data-testid="home-tab-import"]');
      await importTab.click();

      // Check import panel
      const importPanel = page.locator('#import-panel');
      await expect(importPanel).toHaveAttribute('role', 'tabpanel');
      await expect(importPanel).toHaveAttribute('aria-labelledby', 'import-tab');
    });
  });
});
