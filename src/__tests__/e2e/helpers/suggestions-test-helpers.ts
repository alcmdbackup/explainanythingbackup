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
 */
export async function waitForDiffNodes(page: Page, timeout = 5000): Promise<void> {
  await page.waitForSelector('[data-critic-markup]', { timeout });
}

/**
 * Gets all diff nodes from the editor.
 */
export async function getDiffNodes(page: Page): Promise<Locator[]> {
  return await page.locator('[data-critic-markup]').all();
}

/**
 * Gets insertion diff nodes from the editor.
 */
export async function getInsertionDiffs(page: Page): Promise<Locator[]> {
  return await page.locator('[data-critic-markup="insertion"]').all();
}

/**
 * Gets deletion diff nodes from the editor.
 */
export async function getDeletionDiffs(page: Page): Promise<Locator[]> {
  return await page.locator('[data-critic-markup="deletion"]').all();
}

/**
 * Gets the accept button for a diff node by hovering over it.
 */
export async function getAcceptButton(page: Page, diffNode: Locator): Promise<Locator> {
  await diffNode.hover();
  return page.locator('[data-testid="accept-diff-button"]');
}

/**
 * Gets the reject button for a diff node by hovering over it.
 */
export async function getRejectButton(page: Page, diffNode: Locator): Promise<Locator> {
  await diffNode.hover();
  return page.locator('[data-testid="reject-diff-button"]');
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
  await acceptAllButton.click();
}

/**
 * Clicks the "Reject All" button to reject all diffs at once.
 */
export async function rejectAllDiffs(page: Page): Promise<void> {
  const rejectAllButton = page.locator('[data-testid="reject-all-diffs-button"]');
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
  await textarea.fill(prompt);

  const submitButton = page.locator('button:has-text("Get Suggestions")');
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
