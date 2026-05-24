/**
 * E2E: GenerationStatusPill states across the streaming lifecycle
 * (Phase 3 of fixes_explainanything_for_public_demo_20260523).
 *
 * Uses SSE mocking via page.route — does not need any guest auth env vars,
 * so runs under the standard chromium-critical project on the E2E_TEST_MODE
 * webServer like other search/generate tests.
 */

import { test, expect } from '../../fixtures/base';

test.describe('GenerationStatusPill', () => {
  test('shows State A (streaming) → State B (transition) → State C (hint)', { tag: '@critical' }, async ({ page }) => {
    // Mock the SSE endpoint to control event timing.
    await page.unroute('**/api/returnExplanation');
    await page.route('**/api/returnExplanation', async (route) => {
      const encoder = new TextEncoder();
      const chunks = [
        'event: streaming_start\ndata: {"type":"streaming_start"}\n\n',
        'event: message\ndata: {"type":"content","content":"## Heading\\n\\nFirst paragraph."}\n\n',
        'event: complete\ndata: {"type":"complete","result":{"explanationId":12345,"data":{"content":"## Heading\\n\\nFirst paragraph.","explanation_title":"Test"}}}\n\n',
      ];
      const body = chunks.join('');
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: encoder.encode(body) as unknown as Buffer,
      });
    });

    await page.goto('/results?q=test+pill');

    // State A or B should appear; with expect.poll to retry through state transitions.
    await expect.poll(
      async () => {
        const pill = page.getByTestId('generation-status-pill');
        if (await pill.count() === 0) return null;
        return pill.getAttribute('data-pill-state');
      },
      { timeout: 15000 },
    ).toMatch(/^(streaming|transition|hint)$/);

    // Eventually reaches hint state with the AI-editor copy.
    await expect.poll(
      async () => page.getByTestId('generation-status-pill').textContent().catch(() => null),
      { timeout: 15000 },
    ).toMatch(/AI editor/);
  });

  test('dismiss button hides the pill', async ({ page }) => {
    await page.unroute('**/api/returnExplanation');
    await page.route('**/api/returnExplanation', async (route) => {
      const body = [
        'event: complete\ndata: {"type":"complete","result":{"explanationId":12345,"data":{"content":"## H\\n\\nx.","explanation_title":"T"}}}\n\n',
      ].join('');
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body,
      });
    });

    await page.goto('/results?q=test+dismiss');

    const dismiss = page.getByTestId('generation-status-pill-dismiss');
    await dismiss.waitFor({ state: 'visible', timeout: 15000 });
    await dismiss.click();

    await expect(page.getByTestId('generation-status-pill')).toHaveCount(0);
  });
});
