// E2E coverage for GenerationStatusPill (Phase 3 of
// fixes_explainanything_for_public_demo_20260523). Confirms the floating
// status pill appears during streaming and transitions through its post-stream
// state machine. Drives the real SSE handler via E2E_TEST_MODE's `slow`
// scenario so the pill's `streaming` state stays visible long enough to assert.
//
// This is the integration-level coverage missing from the original PR; unit
// tests already cover the component's state transitions in isolation.

import { test, expect } from '../../fixtures/auth';

test.describe('GenerationStatusPill (streaming hand-off)', () => {
  test('appears during streaming and survives URL navigation', { tag: ['@critical', '@skip-prod'] }, async ({ authenticatedPage: page }) => {
    // X-Test-Scenario header selects the `slow` mock SSE scenario (200ms gap
    // between events) so the pill in 'streaming' state stays mounted long
    // enough to observe. The header is propagated by the test-mode router.
    await page.route('**/api/returnExplanation', async (route) => {
      const original = route.request();
      const headers = { ...original.headers(), 'x-test-scenario': 'slow' };
      await route.continue({ headers });
    });

    // Submit a query. The home page's SearchBar dispatches to /results?q=...
    await page.goto('/');
    const searchInput = page.locator('[data-testid="home-search-input"]');
    await searchInput.waitFor({ state: 'visible' });
    await searchInput.fill('What is a transistor');
    await searchInput.blur();
    await page.locator('[data-testid="home-search-submit"]').click();

    // Wait for navigation to /results (or for the pill to appear there).
    await page.waitForURL(/\/results/, { timeout: 10_000 });

    // The pill should appear with the 'streaming' state once the first
    // SSE event arrives. Use first() because React may mount-then-replace it.
    const pill = page.locator('[data-testid="generation-status-pill"]').first();
    await expect(pill).toBeVisible({ timeout: 10_000 });
    await expect(pill).toHaveAttribute('data-pill-state', 'streaming');
    await expect(pill).toContainText(/Drafting your article/i);
  });

  test('renders the hint state with the AI-editor copy after streaming', { tag: ['@critical', '@skip-prod'] }, async ({ authenticatedPage: page }) => {
    // Default scenario completes quickly (~400ms total). The streaming
    // handler only fires on /results — '/?q=...' is the home page and
    // doesn't dispatch START_GENERATION.
    await page.goto('/results?q=Test+pill+hint');

    const pill = page.locator('[data-testid="generation-status-pill"]').first();

    // Wait for the post-stream transition to hint state. The component
    // shows 'transition' for 800ms then auto-advances to 'hint' for 3s.
    await expect(pill).toHaveAttribute('data-pill-state', 'hint', { timeout: 15_000 });
    await expect(pill).toContainText(/AI editor/i);
  });

  test('shows error variant when the stream emits an error', async ({ authenticatedPage: page }) => {
    // Mock the SSE response directly so this test works in environments
    // without E2E_TEST_MODE (local Claude tmux server). The keyword-routed
    // `trigger-error` scenario in test-mode.ts only fires when E2E_TEST_MODE=true,
    // which playwright's own webServer sets but the tmux-managed dev server
    // does not.
    await page.route('**/api/returnExplanation', async (route) => {
      const body = [
        'data: {"type":"streaming_start","isStreaming":true}',
        'data: {"type":"error","error":"Mock SSE error for test","isStreaming":false,"isComplete":true}',
        '',
      ].join('\n\n');
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
        body,
      });
    });

    await page.goto('/results?q=trigger-error');

    const pill = page.locator('[data-testid="generation-status-pill"]').first();
    await expect(pill).toBeVisible({ timeout: 10_000 });
    await expect(pill).toHaveAttribute('data-pill-state', 'error');
    await expect(pill).toContainText(/Generation failed/i);
  });
});
