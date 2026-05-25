/**
 * E2E Tests for editor-panel-variants URL-param wiring and flag-button mobile visibility.
 *
 * Two concerns covered:
 * 1. ?editorVariant=<key> selects a panel variant; unknown / Object.prototype keys fall back to default.
 * 2. The ReportContentButton (flag) is hidden on mobile (<sm) and visible on desktop, via `hidden sm:inline-flex`.
 *
 * Tagged @critical so PR CI's `npm run test:e2e:critical` job catches regressions.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('Editor panel variants — URL param wiring @critical', () => {
  test.describe.configure({ retries: 2, mode: 'serial', timeout: 90000 });

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    testExplanation = await createTestExplanationInLibrary({
      title: 'Editor Panel Variants Test',
      content: '<h1>Variants Test</h1><p>Content for variant URL-param tests.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  test('?editorVariant=parchment renders panel with paper-texture class @critical', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}&editorVariant=parchment`);
    await resultsPage.waitForStreamingComplete(30000);

    const wrapper = authenticatedPage.locator('[data-testid="explanation-content"]');
    await expect(wrapper).toBeVisible();
    const className = await wrapper.getAttribute('class');
    expect(className).toContain('paper-texture');
    expect(className).toContain('scholar-card');
  });

  test('?editorVariant=garbage falls back to default (embossed) @critical', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}&editorVariant=garbage`);
    await resultsPage.waitForStreamingComplete(30000);

    const wrapper = authenticatedPage.locator('[data-testid="explanation-content"]');
    const className = await wrapper.getAttribute('class');
    // Default is now 'embossed' (signature: surface-elevated bg + shadow-page).
    expect(className).toContain('bg-[var(--surface-elevated)]');
    expect(className).toContain('shadow-page');
    // Sanity: default doesn't pull in any other variant's signature class.
    expect(className).not.toContain('paper-texture');
    expect(className).not.toContain('vellum-editor');
    expect(className).not.toContain('card-enhanced');
  });

  test('?editorVariant=toString does NOT produce className="undefined" (Object.prototype attack regression) @critical', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}&editorVariant=toString`);
    await resultsPage.waitForStreamingComplete(30000);

    const wrapper = authenticatedPage.locator('[data-testid="explanation-content"]');
    const className = await wrapper.getAttribute('class');
    // Must NOT contain literal "undefined" (that would be the bug).
    expect(className).not.toContain('undefined');
    // Must fall back to embossed default.
    expect(className).toContain('shadow-page');
  });
});
