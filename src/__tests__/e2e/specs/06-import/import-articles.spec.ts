import { test, expect } from '../../fixtures/auth';
import { ImportPage } from '../../helpers/pages/ImportPage';

/**
 * E2E tests for Import Articles feature
 * Tests the full flow of importing AI-generated content as articles
 */

// Sample content that mimics ChatGPT output
const CHATGPT_CONTENT = `Certainly! Here's an explanation of how React hooks work in modern web development.

React Hooks are a powerful feature introduced in React 16.8 that allow you to use state and other React features without writing a class component. They provide a more direct way to use the React features you already know.

## What are Hooks?

Hooks are functions that let you "hook into" React state and lifecycle features from function components. They don't work inside classes — they let you use React without classes.

### The useState Hook

The useState hook is the most commonly used hook. It allows you to add state to functional components.

- First, import useState from React
- Then, call it with an initial value
- It returns an array with the current state and a function to update it

### The useEffect Hook

useEffect lets you perform side effects in function components:

1. Data fetching
2. Setting up subscriptions
3. Manually changing the DOM

Feel free to ask if you have any questions about React hooks!`;

// Sample content that mimics Claude output
const CLAUDE_CONTENT = `I'll help you understand database indexing in depth. Here's a comprehensive explanation of how indexes work in relational databases.

Database indexes are data structures that improve the speed of data retrieval operations on database tables. Let me guide you through the key concepts.

## How Indexes Work

An index is essentially a pointer to data in a table. Think of it like the index in a book - instead of reading the entire book to find a topic, you can look up the topic in the index to find the page number.

### B-Tree Indexes

B-tree indexes are the most common type:

- Self-balancing tree structure
- Maintains sorted data
- Allows for efficient searches, insertions, and deletions

### Hash Indexes

Hash indexes use a hash function to compute the location of data. I'd be glad to explain more about their use cases.`;

// Generic content without AI markers
const GENERIC_CONTENT = `This is an article about software architecture patterns that are commonly used in modern applications.

## Introduction to Architecture Patterns

Software architecture patterns provide reusable solutions to commonly occurring problems in software architecture design.

### Microservices Pattern

The microservices pattern involves building an application as a collection of small, autonomous services.

- Each service runs its own process
- Services communicate via well-defined APIs
- Independent deployment and scaling

This approach has both benefits and challenges that developers should carefully consider.`;

test.describe('Import Articles Feature', () => {
    test.describe('Full Import Flow', () => {
        test('should import ChatGPT content with auto-detection', async ({ authenticatedPage }) => {
            const importPage = new ImportPage(authenticatedPage);

            // Navigate to home page
            await authenticatedPage.goto('/');
            await authenticatedPage.waitForLoadState('networkidle');

            // Open import modal
            await importPage.openModal();

            // Paste ChatGPT content
            await importPage.pasteContent(CHATGPT_CONTENT);

            // Wait for auto-detection
            await importPage.waitForDetectionComplete();

            // Verify source was detected as ChatGPT
            const source = await importPage.getSelectedSource();
            expect(source).toContain('ChatGPT');

            // Click Process
            await importPage.clickProcess();

            // Wait for preview modal
            await importPage.waitForPreview();

            // Verify preview shows content
            const previewTitle = await importPage.getPreviewTitle();
            expect(previewTitle).toBeTruthy();
            expect(previewTitle!.length).toBeGreaterThan(0);

            // Verify source badge shows ChatGPT
            const sourceBadge = await importPage.getPreviewSourceBadge();
            expect(sourceBadge).toContain('ChatGPT');

            // Click Publish
            await importPage.clickPublish();

            // Wait for success and redirect
            await importPage.waitForPublishSuccess();

            // Should redirect to results page
            await authenticatedPage.waitForURL(/\/results\?explanation_id=\d+/, { timeout: 10000 });
            expect(authenticatedPage.url()).toContain('/results');
        });

        test('should import with manual source selection', async ({ authenticatedPage }) => {
            const importPage = new ImportPage(authenticatedPage);

            await authenticatedPage.goto('/');
            await authenticatedPage.waitForLoadState('networkidle');

            await importPage.openModal();

            // Paste generic content
            await importPage.pasteContent(GENERIC_CONTENT);

            // Manually select Claude as source
            await importPage.selectSource('claude');

            // Process
            await importPage.clickProcess();
            await importPage.waitForPreview();

            // Verify source badge shows Claude
            const sourceBadge = await importPage.getPreviewSourceBadge();
            expect(sourceBadge).toContain('Claude');
        });
    });

    test.describe('Validation', () => {
        test('should disable Process button when content is empty', async ({ authenticatedPage }) => {
            const importPage = new ImportPage(authenticatedPage);

            await authenticatedPage.goto('/');
            await authenticatedPage.waitForLoadState('networkidle');

            await importPage.openModal();

            // Process button should be disabled
            const isDisabled = await importPage.isProcessButtonDisabled();
            expect(isDisabled).toBe(true);
        });

        test('should show error for content under minimum length', async ({ authenticatedPage }) => {
            const importPage = new ImportPage(authenticatedPage);

            await authenticatedPage.goto('/');
            await authenticatedPage.waitForLoadState('networkidle');

            await importPage.openModal();

            // Type short content (under 50 chars)
            await importPage.pasteContent('Too short');

            // Process button should now be enabled (validation happens server-side)
            await importPage.clickProcess();

            // Should show error
            await authenticatedPage.waitForTimeout(1000);
            const error = await importPage.getImportError();
            expect(error).toContain('too short');
        });
    });

    test.describe('Modal Behavior', () => {
        test('should cancel and clear form', async ({ authenticatedPage }) => {
            const importPage = new ImportPage(authenticatedPage);

            await authenticatedPage.goto('/');
            await authenticatedPage.waitForLoadState('networkidle');

            await importPage.openModal();

            // Enter content
            await importPage.pasteContent('Some test content that is long enough to be valid for import.');

            // Cancel
            await importPage.clickCancel();

            // Wait for modal to close
            await authenticatedPage.waitForTimeout(500);

            // Reopen modal
            await importPage.openModal();

            // Content should be cleared (check textarea is empty)
            const textarea = authenticatedPage.locator('[data-testid="import-content"]');
            const value = await textarea.inputValue();
            expect(value).toBe('');
        });

        test('should go back from preview to modal', async ({ authenticatedPage }) => {
            const importPage = new ImportPage(authenticatedPage);

            await authenticatedPage.goto('/');
            await authenticatedPage.waitForLoadState('networkidle');

            await importPage.openModal();
            await importPage.pasteContent(CHATGPT_CONTENT);
            await importPage.clickProcess();
            await importPage.waitForPreview();

            // Click Back
            await importPage.clickBack();

            // Should be back in import modal
            const textarea = authenticatedPage.locator('[data-testid="import-content"]');
            await textarea.waitFor({ state: 'visible' });
        });
    });

    test.describe('Source Detection', () => {
        test('should detect Claude content', async ({ authenticatedPage }) => {
            const importPage = new ImportPage(authenticatedPage);

            await authenticatedPage.goto('/');
            await authenticatedPage.waitForLoadState('networkidle');

            await importPage.openModal();
            await importPage.pasteContent(CLAUDE_CONTENT);
            await importPage.waitForDetectionComplete();

            const source = await importPage.getSelectedSource();
            expect(source).toContain('Claude');
        });

        test('should default to Other for generic content', async ({ authenticatedPage }) => {
            const importPage = new ImportPage(authenticatedPage);

            await authenticatedPage.goto('/');
            await authenticatedPage.waitForLoadState('networkidle');

            await importPage.openModal();
            await importPage.pasteContent(GENERIC_CONTENT);
            await importPage.waitForDetectionComplete();

            const source = await importPage.getSelectedSource();
            expect(source).toContain('Other');
        });
    });
});
