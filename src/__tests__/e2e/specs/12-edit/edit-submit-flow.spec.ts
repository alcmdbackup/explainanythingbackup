/**
 * /edit submit-flow E2E — route-mocked.
 *
 * Exercises the CLIENT-SIDE flow only:
 *   /edit page → fill textarea → pick strategy → submit →
 *   (submitPublicEditAction mocked to return a fake runId) →
 *   browser navigates to /edit/runs/<fake-runId> →
 *   (getEditRunStatusAction mocked to return a completed run) →
 *   viewing phase renders with tabs + meta strip
 *
 * The server-side path (whitelist enforcement, per-IP reservation, DB insert)
 * is covered by:
 *   - src/__tests__/integration/public-edit-widen-filter.integration.test.ts (Phase 4)
 *   - evolution/src/lib/pipeline/claimAndExecuteRun.test.ts (unit)
 *
 * Rewritten in improvements_to_edit_page_evolution_20260630 Phase 4 (Task #3):
 *   The previous inline-DB-seed approach would have failed after the mock-model
 *   filter widened. Route-mocking sidesteps the whitelist collision AND avoids
 *   burning minicomputer budget on CI (no real run row created).
 *
 * Tag @evolution + @skip-prod. Needs BOT_PROTECTION_DISABLED to let Playwright
 * through Vercel BotID (only enforced in production, harmless off-Vercel).
 */

import { test, expect, type Route, type Request } from '@playwright/test';

// Next.js server actions POST back to the PAGE's URL (not a per-action path)
// with a Next-Action header identifying which action was invoked. We can't rely
// on distinguishing the two actions by URL — we distinguish by request body shape.

const FAKE_RUN_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

interface MockRunState {
  status: 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';
  originalContent: string;
  winnerVariantContent: string | null;
  errorMessage: string | null;
  costSpent: number | null;
  etaSeconds: number | null;
  strategyLabel: string | null;
}

const MOCK_COMPLETED_RESPONSE: MockRunState = {
  status: 'completed',
  originalContent: 'Some original article text for the smoke test.',
  winnerVariantContent: '# Rewritten heading\n\nThe **rewrite** looks better than the original.',
  errorMessage: null,
  costSpent: 0.04,
  etaSeconds: null,
  strategyLabel: 'Quick polish',
};

test.describe('/edit submit-flow (route-mocked)', { tag: ['@evolution', '@skip-prod'] }, () => {
  test.beforeEach(async ({ page }) => {
    // Mock both server actions. Server actions in Next.js are POSTs back to the
    // page URL with a Next-Action header; we match by URL prefix + POST + body shape.
    await page.route(
      (url) => url.pathname === '/edit' || url.pathname.startsWith('/edit/runs/'),
      async (route: Route, request: Request) => {
        if (request.method() !== 'POST') return route.continue();
        const nextActionHeader = request.headers()['next-action'];
        if (!nextActionHeader) return route.continue();
        // Both actions receive JSON-ish body. We shape the response by inspecting
        // the postData: submitPublicEditAction receives {articleText, strategyId},
        // getEditRunStatusAction receives a bare UUID string.
        const body = request.postData() ?? '';
        if (body.includes('articleText')) {
          // Return a Server Actions response envelope. The publicAction wrapper
          // shape is { success: true, data: {...}, error: null }.
          const envelope = { success: true, data: { runId: FAKE_RUN_ID }, error: null };
          return route.fulfill({
            status: 200,
            contentType: 'text/x-component',
            headers: { 'x-action-mock': 'submit' },
            body: `0:${JSON.stringify(envelope)}\n`,
          });
        }
        // Otherwise assume it's a getEditRunStatusAction call.
        const envelope = { success: true, data: MOCK_COMPLETED_RESPONSE, error: null };
        return route.fulfill({
          status: 200,
          contentType: 'text/x-component',
          headers: { 'x-action-mock': 'status' },
          body: `0:${JSON.stringify(envelope)}\n`,
        });
      },
    );
  });

  test.afterEach(async ({ page }) => {
    // Rule 10: prevent handler stacking across tests.
    await page.unrouteAll({ behavior: 'wait' });
  });

  test('form → submit → mocked redirect to /edit/runs/<id> → viewing phase renders', async ({ page }) => {
    await page.goto('/edit');

    const form = page.getByTestId('edit-form');
    const empty = page.getByTestId('edit-form-no-strategies');
    await expect(form.or(empty)).toBeVisible();

    // If the picker is empty (no public strategies at all), we still can't
    // exercise the submit — this environment has no seeded picker rows.
    // Once the widened filter surfaces real strategies on staging, this
    // branch becomes dead; keep as defensive fallback for local dev.
    if ((await form.count()) === 0) {
      // eslint-disable-next-line flakiness/no-test-skip -- environmental: no strategies in test DB
      test.skip(true, 'no strategies visible in test env');
      return;
    }

    // Fill textarea. Any content ≥ 1 char passes client + server input validation.
    const articleText = `[E2E submit-flow] Route-mocked spec run at ${Date.now()}.`;
    await page.getByTestId('edit-textarea').fill(articleText);

    // With the combobox, a strategy is auto-selected on page load (first option).
    // No picker click needed — just submit.
    await page.getByTestId('edit-submit').click();

    // Route-mock returns fake runId → client navigates. Wait for URL flip.
    await page.waitForURL(`**/edit/runs/${FAKE_RUN_ID}`, { timeout: 15_000 });

    // Viewing phase should render since getEditRunStatusAction is mocked to
    // return status='completed' immediately.
    await expect(page.getByTestId('edit-run-viewing')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('edit-run-meta-strip')).toContainText("Rewrote with 'Quick polish'");
    await expect(page.getByTestId('edit-run-meta-strip')).toContainText('$0.04');
  });
});
