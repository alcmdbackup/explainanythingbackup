/**
 * /edit submit-flow E2E.
 *
 * Exercises the visitor side of the critical path:
 *   /edit page → fill textarea → pick strategy → submit →
 *   evolution_runs row is created with run_source='public_edit' →
 *   browser navigates to /edit/runs/<new-runId>
 *
 * Does NOT wait for pipeline execution + result — that requires a live
 * minicomputer or in-process runner, neither of which the test environment
 * provides. The execute half is covered by:
 *   - evolution/src/lib/pipeline/claimAndExecuteRun.test.ts (unit)
 *   - manual staging smoke (direct DB-insert + processRunQueue with mock LLM)
 * The polling→render handoff is covered by:
 *   - src/app/edit/runs/[runId]/EditRunViewer.test.tsx (unit, fake timers)
 *   - src/__tests__/e2e/specs/12-edit/edit-completed-run-handoff.spec.ts (pre-seeded fixture)
 *
 * Tag @evolution + @skip-prod. Needs SUPABASE_SERVICE_ROLE_KEY for DB
 * verification + BOT_PROTECTION_DISABLED to let Playwright's headless
 * browser through BotID.
 */

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

let supabase: SupabaseClient<Database>;
const createdRunIds: string[] = [];

test.describe('/edit submit-flow', { tag: ['@evolution', '@skip-prod'] }, () => {
  // Serial — shares the supabase client + cleanup tracking across tests.
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required');
    supabase = createClient<Database>(url, key);
  });

  test.afterAll(async () => {
    // Cleanup: delete any runs created by the spec to avoid burning minicomputer
    // budget. Best-effort — if delete fails, the [E2E] title prefix lets the
    // test-content cleanup workflow GC them on the next nightly.
    for (const runId of createdRunIds) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('evolution_runs') as any).delete().eq('id', runId);
    }
  });

  test('form → submit → run row inserted with run_source=public_edit + browser navigates to /edit/runs/<id>', async ({ page }) => {
    await page.goto('/edit');

    const form = page.getByTestId('edit-form');
    const empty = page.getByTestId('edit-form-no-strategies');
    await expect(form.or(empty)).toBeVisible();

    if ((await form.count()) === 0) {
      // No public_visible strategy in test DB → can't exercise submit. Self-skip
      // (the picker-population path is covered by edit-flow.spec.ts).
      // eslint-disable-next-line flakiness/no-test-skip -- environmental: needs a seeded public_visible strategy
      test.skip(true, 'no seeded public_visible strategy in test DB');
    }

    const articleText = `[E2E submit-flow] A short article for the smoke test. Run at ${Date.now()}. It contains a few sentences so the validator sees something to chew on.`;
    await page.getByTestId('edit-textarea').fill(articleText);

    // Click the first available strategy option.
    const firstOption = page.locator('[data-testid^="strategy-option-"]').first();
    await firstOption.click();

    await page.getByTestId('edit-submit').click();

    // The page should navigate to /edit/runs/<runId>. Wait for the URL to flip.
    await page.waitForURL(/\/edit\/runs\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const url = page.url();
    const runId = url.match(/\/edit\/runs\/([0-9a-f-]{36})/)?.[1];
    expect(runId).toBeTruthy();
    createdRunIds.push(runId!);

    // Verify the run was actually created in the DB with the right shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: run, error } = await (supabase.from('evolution_runs') as any)
      .select('id, run_source, status, explanation_id, budget_cap_usd')
      .eq('id', runId)
      .single();
    expect(error).toBeNull();
    expect(run.run_source).toBe('public_edit');
    expect(run.status).toMatch(/^(pending|claimed|running|completed|failed)$/);
    expect(run.explanation_id).toBeTruthy();
    expect(Number(run.budget_cap_usd)).toBeLessThanOrEqual(0.10);

    // Cleanup: cancel the run if still pending so we don't burn minicomputer
    // budget on the test article. The pipeline may already have claimed it;
    // that's fine, we just leave it (the row will be GC'd by the test-content
    // cleanup workflow on the [E2E] title prefix).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('evolution_runs') as any)
      .update({ status: 'cancelled', error_message: 'cancelled by E2E submit-flow spec' })
      .eq('id', runId)
      .eq('status', 'pending');
  });
});
