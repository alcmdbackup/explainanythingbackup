/**
 * E2E Tests for Results Page Action Buttons
 *
 * Tests for Save, Edit, Format Toggle, Mode Dropdown, and Rewrite functionality.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import { UserLibraryPage } from '../../helpers/pages/UserLibraryPage';
import { SearchPage } from '../../helpers/pages/SearchPage';
test.describe('Action Buttons', () => {
  let resultsPage: ResultsPage;
  let libraryPage: UserLibraryPage;

  // Add retries for flaky network conditions
  test.describe.configure({ retries: 1 });

  // Increase timeout for these tests since they involve DB loading and streaming
  test.setTimeout(60000);

  test.beforeEach(async ({ authenticatedPage }) => {
    resultsPage = new ResultsPage(authenticatedPage);
    libraryPage = new UserLibraryPage(authenticatedPage);
  });

  test.describe('Save Button Flow (P0)', () => {
    // Note: With E2E_TEST_MODE, the API returns mock SSE streaming,
    // so these tests no longer require real OpenAI API calls.
    test('should save explanation to library when save button clicked', { tag: '@critical' }, async ({ authenticatedPage }) => {
      // Generate a new explanation that isn't saved yet
      const searchPage = new SearchPage(authenticatedPage);
      await searchPage.navigate();

      const uniqueQuery = `test query for save ${Date.now()}`;
      await searchPage.search(uniqueQuery);

      // Wait for navigation to results and streaming to complete
      await authenticatedPage.waitForURL(/\/results/, { timeout: 30000 });
      await resultsPage.waitForStreamingComplete(60000);

      // Verify save button is visible and enabled
      const saveVisible = await resultsPage.isSaveToLibraryVisible();
      expect(saveVisible).toBe(true);

      const saveEnabled = await resultsPage.isSaveToLibraryEnabled();
      expect(saveEnabled).toBe(true);

      // Get initial button text
      const initialText = await resultsPage.getSaveButtonText();
      expect(initialText).toBe('Save');

      // Click save button
      await resultsPage.clickSaveToLibrary();

      // Wait for save to complete
      await resultsPage.waitForSaveComplete(15000);

      // Verify button text changed to "Saved ✓"
      const savedText = await resultsPage.getSaveButtonText();
      expect(savedText).toContain('Saved');
    });

    test('should disable save button after successful save', async ({ authenticatedPage }) => {
      // Generate new explanation
      const searchPage = new SearchPage(authenticatedPage);
      await searchPage.navigate();

      const uniqueQuery = `test disable save ${Date.now()}`;
      await searchPage.search(uniqueQuery);

      await authenticatedPage.waitForURL(/\/results/, { timeout: 30000 });
      await resultsPage.waitForStreamingComplete(60000);

      // Save the explanation
      await resultsPage.clickSaveToLibrary();
      await resultsPage.waitForSaveComplete(15000);

      // Verify button is now disabled
      const isEnabled = await resultsPage.isSaveToLibraryEnabled();
      expect(isEnabled).toBe(false);
    });

    test('should show already saved state for existing saved explanations', { tag: '@critical' }, async ({ authenticatedPage }) => {
      // Navigate to library to get an existing saved explanation
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      // Click on first explanation
      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);
      // Wait for lifecycle phase to reach 'viewing' so userSaved state is set
      await resultsPage.waitForViewingPhase();
      // Wait for userSaved async check to complete
      await resultsPage.waitForUserSavedState();

      // Save button should show "Saved" for already saved explanations
      const saveText = await resultsPage.getSaveButtonText();
      expect(saveText).toContain('Saved');
    });
  });

  test.describe('Edit Mode (P0)', () => {
    test('should enter edit mode when edit button clicked', { tag: '@critical' }, async ({ authenticatedPage }) => {
      // Get existing explanation
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);
      // Wait for lifecycle phase to reach 'viewing' (required for ENTER_EDIT_MODE action)
      await resultsPage.waitForViewingPhase();

      // Verify edit button is visible
      const editVisible = await resultsPage.isEditButtonVisible();
      expect(editVisible).toBe(true);

      // Get initial button text
      const initialText = await resultsPage.getEditButtonText();
      expect(initialText).toBe('Edit');

      // Click edit button
      await resultsPage.clickEditButton();

      // Verify button text changed to "Done"
      const editModeText = await resultsPage.getEditButtonText();
      expect(editModeText).toBe('Done');

      // Verify we're in edit mode
      const isInEditMode = await resultsPage.isInEditMode();
      expect(isInEditMode).toBe(true);
    });

    test('should exit edit mode when done button clicked', async ({ authenticatedPage }) => {
      // Get existing explanation
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);
      // Wait for lifecycle phase to reach 'viewing' (required for ENTER_EDIT_MODE action)
      await resultsPage.waitForViewingPhase();

      // Enter edit mode
      await resultsPage.clickEditButton();
      expect(await resultsPage.isInEditMode()).toBe(true);

      // Exit edit mode
      await resultsPage.clickEditButton();

      // Verify we're no longer in edit mode
      const isInEditMode = await resultsPage.isInEditMode();
      expect(isInEditMode).toBe(false);

      const buttonText = await resultsPage.getEditButtonText();
      expect(buttonText).toBe('Edit');
    });
  });

  test.describe('Format Toggle (P2)', () => {
    test('should toggle from markdown to plain text view', async ({ authenticatedPage }) => {
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);

      // Verify format toggle is visible
      const formatToggleVisible = await resultsPage.isFormatToggleVisible();
      expect(formatToggleVisible).toBe(true);

      // Check initial state (should be markdown mode showing "Plain Text" button)
      const isMarkdown = await resultsPage.isMarkdownMode();
      expect(isMarkdown).toBe(true);

      // Toggle to plain text
      await resultsPage.clickFormatToggle();

      // Verify we're now in plain text mode
      const isPlainText = await resultsPage.isPlainTextMode();
      expect(isPlainText).toBe(true);
    });

    test('should toggle from plain text back to markdown', async ({ authenticatedPage }) => {
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);

      // Toggle to plain text first
      await resultsPage.clickFormatToggle();
      expect(await resultsPage.isPlainTextMode()).toBe(true);

      // Toggle back to markdown
      await resultsPage.clickFormatToggle();
      expect(await resultsPage.isMarkdownMode()).toBe(true);
    });
  });

  test.describe('Mode Dropdown (P2)', () => {
    test('should change mode to Skip Match', async ({ authenticatedPage }) => {
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);

      // Verify mode select is visible
      const modeSelectVisible = await resultsPage.isModeSelectVisible();
      expect(modeSelectVisible).toBe(true);

      // Change to Skip Match mode
      await resultsPage.selectMode('Skip Match');

      // Verify mode was changed
      const selectedMode = await resultsPage.getSelectedMode();
      expect(selectedMode).toBe('skipMatch');
    });

    test('should change mode to Force Match', async ({ authenticatedPage }) => {
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);

      // Change to Force Match mode
      await resultsPage.selectMode('Force Match');

      // Verify mode was changed
      const selectedMode = await resultsPage.getSelectedMode();
      expect(selectedMode).toBe('forceMatch');
    });
  });

  test.describe('Rewrite Flow (P1)', () => {
    test('should trigger regeneration when rewrite button clicked', async ({ authenticatedPage }) => {
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);

      // Click rewrite button
      await resultsPage.clickRewriteButton();

      // Wait for streaming to start (title should appear)
      await resultsPage.waitForStreamingStart(30000);

      // Wait for streaming to complete
      await resultsPage.waitForStreamingComplete(60000);

      // Verify content was regenerated (may be same or different, but should exist)
      const newContent = await resultsPage.getContent();
      expect(newContent.length).toBeGreaterThan(0);
    });

    test('should show rewrite with tags option in dropdown', async ({ authenticatedPage }) => {
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);

      // Open rewrite dropdown
      await resultsPage.openRewriteDropdown();

      // Verify dropdown options are visible
      const dropdownVisible = await resultsPage.isRewriteDropdownVisible();
      expect(dropdownVisible).toBe(true);
    });

    // Note: @smoke tag removed - the "Rewrite with tags" UI button (data-testid="rewrite-with-tags")
    // is not currently present in the results page. Re-enable when feature is implemented.
    test('should enter rewrite with tags mode and show TagBar', async ({ authenticatedPage }) => {
      // This test validates that:
      // 1. The tags seed data exists in the database (IDs 2 and 5)
      // 2. The getTempTagsForRewriteWithTagsAction server action works
      // 3. The TagBar appears in RewriteWithTags mode
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);

      // Open rewrite dropdown and click "Rewrite with tags"
      await resultsPage.openRewriteDropdown();
      await resultsPage.clickRewriteWithTags();

      // Wait for TagBar to appear with "Rewrite with Tags" button
      // This confirms the server action succeeded and tags were fetched
      const applyButton = authenticatedPage.locator('[data-testid="tag-apply-button"]');
      await expect(applyButton).toBeVisible({ timeout: 10000 });

      // Verify the button text indicates we're in RewriteWithTags mode
      await expect(applyButton).toContainText('Rewrite with Tags');
    });

    test('should enter edit with tags mode and show TagBar', async ({ authenticatedPage }) => {
      // This test validates the Edit with Tags flow works correctly
      await libraryPage.navigate();
      const libraryState = await libraryPage.waitForLibraryReady();
      if (libraryState !== 'loaded') {
        test.skip();
        return;
      }

      const hasExplanations = await authenticatedPage.locator('[data-testid="explanation-row"]').count() > 0;
      if (!hasExplanations) {
        test.skip();
        return;
      }

      await authenticatedPage.locator('[data-testid="explanation-row"]').first().locator('a:has-text("View")').click();
      await authenticatedPage.waitForURL(/\/results\?explanation_id=/, { timeout: 15000 });
      await resultsPage.waitForAnyContent(60000);

      // Open rewrite dropdown and click "Edit with tags"
      await resultsPage.openRewriteDropdown();
      await resultsPage.clickEditWithTags();

      // Wait for TagBar to appear with "Edit with Tags" button
      const applyButton = authenticatedPage.locator('[data-testid="tag-apply-button"]');
      await expect(applyButton).toBeVisible({ timeout: 10000 });

      // Verify the button text indicates we're in EditWithTags mode
      await expect(applyButton).toContainText('Edit with Tags');
    });
  });
});
