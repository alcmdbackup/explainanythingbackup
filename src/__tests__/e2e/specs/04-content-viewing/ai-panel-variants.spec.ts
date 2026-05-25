/**
 * E2E Tests for ai-panel-variants URL-param wiring.
 *
 * Verifies the AI Editor Panel's right-side variant chrome responds to
 * `?panelVariant=<key>` and falls back safely on unknown / Object.prototype
 * keys. Tagged @critical so PR CI's `npm run test:e2e:critical` job catches
 * regressions.
 */
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  createTestExplanationInLibrary,
  type TestExplanation,
} from '../../helpers/test-data-factory';

test.describe('AI panel variants — URL param wiring @critical', () => {
  test.describe.configure({ retries: 2, mode: 'serial', timeout: 90000 });

  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    testExplanation = await createTestExplanationInLibrary({
      title: 'AI Panel Variants Test',
      content: '<h1>AI Panel Variants Test</h1><p>Content for panelVariant URL-param tests.</p>',
      status: 'published',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  test('?panelVariant=parchment applies paper-texture to AI panel @critical', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}&panelVariant=parchment`);
    await resultsPage.waitForStreamingComplete(30000);

    const panel = authenticatedPage.locator('[data-testid="ai-suggestions-panel"]');
    await expect(panel).toBeVisible();
    const className = await panel.getAttribute('class');
    expect(className).toContain('paper-texture');
    // Sanity: parchment uses surface-secondary, NOT the legacy lined-paper surface-elevated.
    expect(className).toContain('bg-[var(--surface-secondary)]');
  });

  test('?panelVariant=vellum applies vellum-panel class @critical', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}&panelVariant=vellum`);
    await resultsPage.waitForStreamingComplete(30000);

    const panel = authenticatedPage.locator('[data-testid="ai-suggestions-panel"]');
    const className = await panel.getAttribute('class');
    expect(className).toContain('vellum-panel');
  });

  test('?panelVariant=garbage falls back to default (embossed) @critical', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}&panelVariant=garbage`);
    await resultsPage.waitForStreamingComplete(30000);

    const panel = authenticatedPage.locator('[data-testid="ai-suggestions-panel"]');
    const className = await panel.getAttribute('class');
    // Default is now 'embossed' (signature: surface-elevated + shadow-page).
    expect(className).toContain('bg-[var(--surface-elevated)]');
    expect(className).toContain('shadow-page');
    // Sanity: should not have applied any other one-block surface treatment
    expect(className).not.toContain('paper-texture');
    expect(className).not.toContain('vellum-panel');
    expect(className).not.toContain('focused-minimal-panel');
    expect(className).not.toContain('gilded-edge-panel');
  });

  test('?panelVariant=toString does NOT produce className with "undefined" (Object.prototype attack regression) @critical', async ({ authenticatedPage }) => {
    const resultsPage = new ResultsPage(authenticatedPage);

    await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}&panelVariant=toString`);
    await resultsPage.waitForStreamingComplete(30000);

    const panel = authenticatedPage.locator('[data-testid="ai-suggestions-panel"]');
    const className = await panel.getAttribute('class');
    // Must NOT contain literal "undefined" (the bug we guard against).
    expect(className).not.toContain('undefined');
    // Must fall back to embossed default.
    expect(className).toContain('shadow-page');
  });
});
