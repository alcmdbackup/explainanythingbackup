/**
 * E2E Tests for AI Suggestions Content Boundaries
 *
 * Tests for edge case content:
 * - Very long content handling
 * - Content with special markdown structures
 * - Content with only whitespace
 * - Content with code blocks
 * - Content with deeply nested lists
 */

import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import { UserLibraryPage } from '../../helpers/pages/UserLibraryPage';
import {
  mockAISuggestionsPipelineAPI,
} from '../../helpers/api-mocks';
import {
  submitAISuggestionPrompt,
  waitForSuggestionsSuccess,
  waitForDiffNodes,
  getDiffCounts,
  waitForEditMode,
  enterEditMode,
} from '../../helpers/suggestions-test-helpers';

// Mock responses with modifications
const mockResponses = {
  longContent: `# Very Long Article

{++This is a new introduction paragraph. ++}${'This is a paragraph with a lot of text that goes on and on. '.repeat(50)}

## Section One

${'More content that repeats many times to make this a very long document. '.repeat(30)}

## Section Two

{--Even more content to push the boundaries of what the editor can handle. --}${'Even more content to push the boundaries of what the editor can handle. '.repeat(29)}

## Conclusion

${'Final thoughts repeated many times. '.repeat(20)}`,

  codeBlocks: `# Code Examples

{++Here is some improved explanation of ++}JavaScript code:

\`\`\`javascript
function hello() {
  console.log("Hello, World!");
  return true;
}
\`\`\`

And some Python:

\`\`\`python
def greet(name):
    print(f"Hello, {name}!")
    return name
\`\`\`

Inline code: \`const x = 42\``,

  nestedList: `# Nested Lists

- Level 1 Item A
  - Level 2 Item A.1
    - Level 3 Item A.1.1
      - Level 4 Item A.1.1.1
        - Level 5 Item A.1.1.1.1
    - Level 3 Item A.1.2
  - Level 2 Item A.2
{++  - Level 2 Item A.3 (new item)++}
- Level 1 Item B
  - Level 2 Item B.1
    - Level 3 Item B.1.1

1. Ordered Level 1
   1. Ordered Level 2
      1. Ordered Level 3
         1. Ordered Level 4`,
};

test.describe('AI Suggestions Content Boundaries', () => {
  test.describe.configure({ retries: 2 });

  test('should handle suggestions on content with code blocks', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockResponses.codeBlocks,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

    await submitAISuggestionPrompt(page, 'Improve the explanation');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Verify diffs appeared
    const counts = await getDiffCounts(page);
    expect(counts.total).toBeGreaterThan(0);
  });

  test('should handle suggestions on content with deeply nested lists', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockResponses.nestedList,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

    await submitAISuggestionPrompt(page, 'Add a new list item');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Verify diffs appeared
    const counts = await getDiffCounts(page);
    expect(counts.total).toBeGreaterThan(0);
  });

  test('should handle suggestions on very long content', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();
    test.setTimeout(60000);

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: mockResponses.longContent,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

    await submitAISuggestionPrompt(page, 'Add an introduction');
    await waitForSuggestionsSuccess(page, 30000);
    await waitForEditMode(page);
    await waitForDiffNodes(page, 10000);

    // Verify diffs appeared even for long content
    const counts = await getDiffCounts(page);
    expect(counts.total).toBeGreaterThan(0);
  });

  test('should handle error for empty prompt', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Try to submit empty prompt
    const textarea = page.locator('#ai-prompt');
    await textarea.fill('');

    // Submit button should be disabled
    const submitButton = page.locator('button:has-text("Get Suggestions")');
    await expect(submitButton).toBeDisabled();
  });

  test('should handle suggestions with special characters', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    // Response with special characters preserved
    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: `# Special Characters

- Emoji: 🎉 🚀 ✅ ❌ 🔥 {++🌟 (new)++}
- Unicode: こんにちは 你好 مرحبا
- Symbols: © ® ™ € £ ¥
- Math: ∑ ∏ ∫ √ ∞
- Arrows: → ← ↑ ↓ ⇒ ⇐`,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

    await submitAISuggestionPrompt(page, 'Add more emojis');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Verify diffs appeared
    const counts = await getDiffCounts(page);
    expect(counts.total).toBeGreaterThan(0);
  });

  test('should handle mixed formatting content', async ({ authenticatedPage: page }, testInfo) => {
    if (testInfo.retry === 0) test.slow();

    const resultsPage = new ResultsPage(page);
    const libraryPage = new UserLibraryPage(page);

    await libraryPage.navigate();
    const libraryState = await libraryPage.waitForLibraryReady();
    test.skip(libraryState !== 'loaded', 'No saved explanations available');

    await mockAISuggestionsPipelineAPI(page, {
      success: true,
      content: `# Mixed Formatting

**Bold text** and *italic text* and ***bold italic***.

~~Strikethrough~~ and \`inline code\` and [links](https://example.com).

{++> New blockquote with **bold** and *italic*++}

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
| Cell 3   | Cell 4   |`,
    });

    await libraryPage.clickViewByIndex(0);
    await page.waitForURL(/\/results\?explanation_id=/);
    await resultsPage.waitForAnyContent(60000);

    // Enter edit mode before submitting AI suggestions
    await enterEditMode(page);

    await submitAISuggestionPrompt(page, 'Add a blockquote');
    await waitForSuggestionsSuccess(page);
    await waitForEditMode(page);
    await waitForDiffNodes(page);

    // Verify diffs appeared
    const counts = await getDiffCounts(page);
    expect(counts.total).toBeGreaterThan(0);
  });
});
