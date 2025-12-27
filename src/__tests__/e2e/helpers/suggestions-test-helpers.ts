import { Page, Locator, expect } from '@playwright/test';

/**
 * Test helpers for AI Suggestions E2E tests.
 *
 * These helpers use the test-only API route `/api/runAISuggestionsPipeline`
 * to bypass RSC wire format issues with server action mocking.
 */

export interface TriggerAISuggestionsOptions {
  currentContent: string;
  userPrompt: string;
  sessionData?: {
    explanation_id: number;
    explanation_title: string;
  };
}

export interface AISuggestionsResult {
  success: boolean;
  content?: string;
  error?: string;
  session_id?: string;
}

/**
 * Triggers AI suggestions via the test-only API route.
 * This bypasses the server action (RSC wire format) for E2E testing.
 */
export async function triggerAISuggestionsViaAPI(
  page: Page,
  options: TriggerAISuggestionsOptions
): Promise<AISuggestionsResult> {
  return await page.evaluate(async (opts) => {
    const response = await fetch('/api/runAISuggestionsPipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    return response.json();
  }, options);
}

/**
 * Waits for diff nodes (CriticMarkup) to appear in the editor after AI suggestions.
 * Uses data-diff-key attribute which is set by DiffTagNodeInline.
 */
export async function waitForDiffNodes(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('[data-diff-key]', { timeout });
}

/**
 * Gets all diff nodes from the editor.
 */
export async function getDiffNodes(page: Page): Promise<Locator[]> {
  return await page.locator('[data-diff-key]').all();
}

/**
 * Gets insertion diff nodes from the editor.
 */
export async function getInsertionDiffs(page: Page): Promise<Locator[]> {
  return await page.locator('[data-diff-type="ins"]').all();
}

/**
 * Gets deletion diff nodes from the editor.
 */
export async function getDeletionDiffs(page: Page): Promise<Locator[]> {
  return await page.locator('[data-diff-type="del"]').all();
}

/**
 * Gets update diff nodes from the editor.
 */
export async function getUpdateDiffs(page: Page): Promise<Locator[]> {
  return await page.locator('[data-diff-type="update"]').all();
}

/**
 * Gets the accept button for a diff node by hovering over it.
 * Waits for button to be visible after hover (CSS transition).
 */
export async function getAcceptButton(page: Page, diffNode: Locator): Promise<Locator> {
  await diffNode.hover();
  const button = page.locator('[data-testid="accept-diff-button"]');
  await button.waitFor({ state: 'visible', timeout: 5000 });
  return button;
}

/**
 * Gets the reject button for a diff node by hovering over it.
 * Waits for button to be visible after hover (CSS transition).
 */
export async function getRejectButton(page: Page, diffNode: Locator): Promise<Locator> {
  await diffNode.hover();
  const button = page.locator('[data-testid="reject-diff-button"]');
  await button.waitFor({ state: 'visible', timeout: 5000 });
  return button;
}

/**
 * Accepts a specific diff by clicking the accept button.
 */
export async function acceptDiff(page: Page, diffNode: Locator): Promise<void> {
  const acceptButton = await getAcceptButton(page, diffNode);
  await acceptButton.click();
}

/**
 * Rejects a specific diff by clicking the reject button.
 */
export async function rejectDiff(page: Page, diffNode: Locator): Promise<void> {
  const rejectButton = await getRejectButton(page, diffNode);
  await rejectButton.click();
}

/**
 * Clicks the "Accept All" button to accept all diffs at once.
 */
export async function acceptAllDiffs(page: Page): Promise<void> {
  const acceptAllButton = page.locator('[data-testid="accept-all-diffs-button"]');
  await acceptAllButton.waitFor({ state: 'visible', timeout: 5000 });
  await acceptAllButton.click();
}

/**
 * Clicks the "Reject All" button to reject all diffs at once.
 */
export async function rejectAllDiffs(page: Page): Promise<void> {
  const rejectAllButton = page.locator('[data-testid="reject-all-diffs-button"]');
  await rejectAllButton.waitFor({ state: 'visible', timeout: 5000 });
  await rejectAllButton.click();
}

/**
 * Types a prompt into the AI suggestions panel and submits it.
 * Uses the test API route mock for the response.
 */
export async function submitAISuggestionPrompt(
  page: Page,
  prompt: string
): Promise<void> {
  const textarea = page.locator('#ai-prompt');
  await textarea.waitFor({ state: 'visible' });

  // Clear and fill with verification to handle React controlled input race conditions
  await textarea.clear();
  await textarea.fill(prompt);
  await textarea.blur();

  // Verify value stuck
  const value = await textarea.inputValue();
  if (value !== prompt) {
    await textarea.click();
    await textarea.pressSequentially(prompt, { delay: 50 });
  }

  const submitButton = page.locator('button:has-text("Get Suggestions")');
  await submitButton.waitFor({ state: 'visible' });
  await submitButton.click();
}

/**
 * Waits for the AI suggestions panel to show success state.
 */
export async function waitForSuggestionsSuccess(page: Page, timeout = 10000): Promise<void> {
  await page.waitForSelector('[data-testid="suggestions-success"]', { timeout });
}

/**
 * Waits for the AI suggestions panel to show error state.
 */
export async function waitForSuggestionsError(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('[data-testid="suggestions-error"]', { timeout });
}

/**
 * Waits for the AI suggestions panel to show loading state.
 */
export async function waitForSuggestionsLoading(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('[data-testid="suggestions-loading"]', { timeout });
}

/**
 * Verifies that diff nodes contain expected text patterns.
 */
export async function verifyDiffContent(
  diffNode: Locator,
  expectedText: string | RegExp
): Promise<void> {
  await expect(diffNode).toContainText(expectedText);
}

/**
 * Gets the text content from all diff nodes.
 */
export async function getAllDiffTexts(page: Page): Promise<string[]> {
  const diffs = await getDiffNodes(page);
  const texts: string[] = [];
  for (const diff of diffs) {
    const text = await diff.textContent();
    if (text) texts.push(text);
  }
  return texts;
}

/**
 * Gets the text content from the editor (excluding diff controls).
 * Works in both edit mode (contenteditable) and read-only mode.
 * Waits for content to be present in the editor before returning.
 *
 * @throws Error if content is not found within timeout (prevents flaky tests)
 */
export async function getEditorTextContent(page: Page, timeout = 30000): Promise<string> {
  // Use .lexical-editor class which is always present on the ContentEditable component
  // This works in both edit mode and read-only mode
  const editor = page.locator('.lexical-editor');
  await editor.waitFor({ state: 'visible', timeout });

  // Wait for content to actually be present (Lexical initializes async)
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const content = await editor.textContent() ?? '';
    if (content.trim().length > 0) {
      return content;
    }
    await page.waitForTimeout(100);
  }

  // Fail fast with clear error message instead of returning empty
  // This prevents flaky tests where contentBefore is empty but contentAfter has content
  throw new Error(
    `getEditorTextContent: No content found in .lexical-editor after ${timeout}ms. ` +
    `This usually means the page hasn't fully loaded yet. ` +
    `Ensure waitForAnyContent() or similar is called before getEditorTextContent().`
  );
}

/**
 * Clicks the accept button (✓) on the first visible diff node.
 * Uses data-action="accept" attribute to avoid matching "Saved ✓" button.
 */
export async function clickAcceptOnFirstDiff(page: Page): Promise<void> {
  const button = page.locator('button[data-action="accept"]').first();
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await button.click();
}

/**
 * Clicks the reject button (✕) on the first visible diff node.
 * Uses data-action="reject" attribute for reliable targeting.
 */
export async function clickRejectOnFirstDiff(page: Page): Promise<void> {
  const button = page.locator('button[data-action="reject"]').first();
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await button.click();
}

/**
 * Gets the count of each diff type in the editor.
 */
export async function getDiffCounts(page: Page): Promise<{
  insertions: number;
  deletions: number;
  updates: number;
  total: number;
}> {
  const insertions = await page.locator('[data-diff-type="ins"]').count();
  const deletions = await page.locator('[data-diff-type="del"]').count();
  const updates = await page.locator('[data-diff-type="update"]').count();
  return {
    insertions,
    deletions,
    updates,
    total: insertions + deletions + updates,
  };
}

/**
 * Enters edit mode by clicking the Edit button if not already in edit mode.
 * This is required before AI suggestions can modify the editor content.
 */
export async function enterEditMode(page: Page, timeout = 10000): Promise<void> {
  // Check if already in edit mode (Done button visible)
  const doneButton = page.locator('[data-testid="edit-button"]:has-text("Done")');
  if (await doneButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    return; // Already in edit mode
  }

  // Click Edit button to enter edit mode
  const editButton = page.locator('[data-testid="edit-button"]:has-text("Edit")');
  await editButton.waitFor({ state: 'visible', timeout });

  // Force click with all modifiers to ensure the click is handled
  await editButton.click({ force: true });

  // Wait a moment for React state to update
  await page.waitForTimeout(500);

  // Wait for Done button to appear (confirms edit mode)
  // If this fails, try clicking again as sometimes first click may not register
  try {
    await page.waitForSelector('[data-testid="edit-button"]:has-text("Done")', { timeout: 3000 });
  } catch {
    // First click may have failed - try again
    await editButton.click({ force: true });
    await page.waitForTimeout(500);
    await page.waitForSelector('[data-testid="edit-button"]:has-text("Done")', { timeout });
  }
}

/**
 * Waits for the editor to be in edit mode (after AI suggestions).
 */
export async function waitForEditMode(page: Page, timeout = 10000): Promise<void> {
  await page.waitForSelector('button:has-text("Done")', { timeout });
}

/**
 * Clicks the Done button to exit edit mode.
 */
export async function clickDoneButton(page: Page): Promise<void> {
  const button = page.locator('button:has-text("Done")');
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await button.click();
}
