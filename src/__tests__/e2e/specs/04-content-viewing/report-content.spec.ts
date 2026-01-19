/**
 * E2E Tests for Report Content Button (Flag Modal)
 *
 * Tests for the flag button that allows users to report inappropriate content.
 * Tests modal opening, form submission, and z-index stacking.
 *
 * Note: These tests are NOT marked as @critical per requirements.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('Report Content Button', () => {
  test.describe.configure({ retries: 1 });
  test.setTimeout(60000);

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    testExplanation = await createTestExplanationInLibrary({
      title: 'Report Content Test',
      content: '<h1>Test Content</h1><p>Content for report modal tests.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  test('should open report modal when flag button clicked', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    // Navigate to the test explanation
    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForStreamingComplete(30000);

    // Find and click the flag button
    const flagButton = authenticatedPage.locator('button[title="Report this content"]');
    await expect(flagButton).toBeVisible();
    await flagButton.click();

    // Verify modal opens
    const modalTitle = authenticatedPage.locator('h3:has-text("Report Content")');
    await expect(modalTitle).toBeVisible();

    // Verify report reasons are shown
    await expect(authenticatedPage.locator('text=Inappropriate Content')).toBeVisible();
    await expect(authenticatedPage.locator('text=Misinformation')).toBeVisible();
    await expect(authenticatedPage.locator('text=Spam')).toBeVisible();
    await expect(authenticatedPage.locator('text=Copyright Violation')).toBeVisible();
    await expect(authenticatedPage.locator('text=Other')).toBeVisible();
  });

  test('should close modal when cancel is clicked', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForStreamingComplete(30000);

    // Open modal
    const flagButton = authenticatedPage.locator('button[title="Report this content"]');
    await flagButton.click();
    await expect(authenticatedPage.locator('h3:has-text("Report Content")')).toBeVisible();

    // Click cancel
    const cancelButton = authenticatedPage.locator('button:has-text("Cancel")');
    await cancelButton.click();

    // Verify modal is closed
    await expect(authenticatedPage.locator('h3:has-text("Report Content")')).not.toBeVisible();
  });

  test('should close modal when X button is clicked', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForStreamingComplete(30000);

    // Open modal
    const flagButton = authenticatedPage.locator('button[title="Report this content"]');
    await flagButton.click();
    await expect(authenticatedPage.locator('h3:has-text("Report Content")')).toBeVisible();

    // Click X button
    const closeButton = authenticatedPage.locator('button:has-text("×")');
    await closeButton.click();

    // Verify modal is closed
    await expect(authenticatedPage.locator('h3:has-text("Report Content")')).not.toBeVisible();
  });

  test('should require reason selection before submission', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForStreamingComplete(30000);

    // Open modal
    const flagButton = authenticatedPage.locator('button[title="Report this content"]');
    await flagButton.click();

    // Try to submit without selecting reason
    const submitButton = authenticatedPage.locator('button:has-text("Submit Report")');
    await submitButton.click();

    // Should show validation error
    await expect(authenticatedPage.locator('text=Please select a reason')).toBeVisible();
  });

  test('should submit report successfully with reason selected', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForStreamingComplete(30000);

    // Open modal
    const flagButton = authenticatedPage.locator('button[title="Report this content"]');
    await flagButton.click();

    // Select a reason (click the label/radio for "Spam")
    const spamOption = authenticatedPage.locator('label:has-text("Spam")');
    await spamOption.click();

    // Submit
    const submitButton = authenticatedPage.locator('button:has-text("Submit Report")');
    await submitButton.click();

    // Should show success message
    await expect(authenticatedPage.locator('text=Thank you for your report')).toBeVisible({ timeout: 10000 });

    // Modal should close automatically after success
    await expect(authenticatedPage.locator('h3:has-text("Report Content")')).not.toBeVisible({ timeout: 5000 });
  });

  test('modal should appear above other page elements (z-index test)', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
    await resultsPage.waitForStreamingComplete(30000);

    // Open modal
    const flagButton = authenticatedPage.locator('button[title="Report this content"]');
    await flagButton.click();

    // Verify modal is visible and interactive
    const modal = authenticatedPage.locator('.fixed.inset-0.bg-black\\/50');
    await expect(modal).toBeVisible();

    // Verify modal content is clickable (not obscured)
    const modalContent = authenticatedPage.locator('h3:has-text("Report Content")');
    await expect(modalContent).toBeVisible();

    // The modal backdrop should capture clicks (clicking outside closes modal)
    // We verify the modal is properly stacked by checking the submit button is clickable
    const submitButton = authenticatedPage.locator('button:has-text("Submit Report")');
    await expect(submitButton).toBeEnabled();

    // Verify we can type in the textarea (proves modal is receiving input)
    const textarea = authenticatedPage.locator('textarea[placeholder*="additional context"]');
    await textarea.fill('Test details');
    await expect(textarea).toHaveValue('Test details');
  });
});
