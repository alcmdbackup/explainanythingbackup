/**
 * @critical
 * Admin Strategy Registry E2E tests.
 * Tests create strategy with preset and agent selection.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

adminTest.describe('Strategy Registry CRUD', () => {
  const testStrategyName = `[E2E] Test Strategy ${Date.now()}`;

  adminTest.afterAll(async () => {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data } = await supabase
      .from('evolution_strategies')
      .select('id')
      .ilike('name', '[E2E] Test Strategy%');
    if (data && data.length > 0) {
      const ids = data.map(s => s.id as string);
      // Delete runs referencing these strategies first
      const { data: runs } = await supabase.from('evolution_runs').select('id').in('strategy_id', ids);
      const runIds = (runs ?? []).map(r => r.id as string);
      if (runIds.length > 0) {
        await supabase.from('evolution_arena_comparisons').delete().in('run_id', runIds);
        await supabase.from('evolution_logs').delete().in('run_id', runIds);
        await supabase.from('evolution_agent_invocations').delete().in('run_id', runIds);
        await supabase.from('evolution_variants').delete().in('run_id', runIds);
        await supabase.from('evolution_runs').delete().in('id', runIds);
      }
      await supabase.from('evolution_strategies').delete().in('id', ids);
    }
  });

  adminTest('create strategy with wizard @critical', async ({ adminPage }) => {
    // Navigate to strategies page
    await adminPage.goto('/admin/evolution/strategies', { timeout: 30000 });
    await expect(adminPage.locator('main').getByRole('heading', { name: 'Strategies' })).toBeVisible({ timeout: 15000 });

    // Click "New Strategy" — navigates to /strategies/new wizard
    await adminPage.locator('[data-testid="header-action"]').click();
    await expect(adminPage).toHaveURL(/\/strategies\/new/, { timeout: 15000 });

    // Step 1: Fill strategy config
    await adminPage.getByPlaceholder(/name/i).fill(testStrategyName);

    // Select generation model (required)
    const genModelSelect = adminPage.locator('select').first();
    const genOptions = await genModelSelect.locator('option').allTextContents();
    const validModel = genOptions.find(o => o !== 'Select a model...' && o.trim() !== '');
    if (validModel) await genModelSelect.selectOption({ label: validModel });

    // Select judge model (required)
    const judgeModelSelect = adminPage.locator('select').nth(1);
    const judgeOptions = await judgeModelSelect.locator('option').allTextContents();
    const validJudge = judgeOptions.find(o => o !== 'Select a model...' && o.trim() !== '');
    if (validJudge) await judgeModelSelect.selectOption({ label: validJudge });

    // Set budget
    const budgetInput = adminPage.getByLabel(/total budget/i);
    await budgetInput.clear();
    await budgetInput.fill('1.00');

    // Click Next to go to Step 2 (Iterations)
    await adminPage.getByRole('button', { name: /next.*iterations/i }).click();

    // Step 2: Wait for iteration list to appear (use exact match to avoid step indicator conflict)
    await expect(adminPage.getByText('Iterations', { exact: true })).toBeVisible({ timeout: 10000 });
    await adminPage.getByRole('button', { name: /create strategy/i }).click();

    // Should redirect to strategy detail page
    await expect(adminPage).toHaveURL(/\/strategies\/[a-f0-9-]+/, { timeout: 30000 });

    // Navigate back to strategies list and verify
    await adminPage.goto('/admin/evolution/strategies', { timeout: 30000 });

    // Uncheck "Hide test content" to see [E2E] prefixed strategies
    const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    // eslint-disable-next-line flakiness/no-point-in-time-checks -- control flow, not assertion
    if (await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.click();
    }

    // Verify strategy appears in table (wait for reload after filter change)
    await expect(adminPage.locator('[data-testid="entity-list-table"]').getByText(testStrategyName)).toBeVisible({ timeout: 15000 });
  });

  adminTest('model dropdown includes gpt-oss-20b without slash', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies', { timeout: 30000 });
    await expect(adminPage.locator('main').getByRole('heading', { name: 'Strategies' })).toBeVisible({ timeout: 15000 });

    // Open create dialog
    await adminPage.locator('[data-testid="header-action"]').click();
    const dialog = adminPage.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible();

    // The model dropdown should contain gpt-oss-20b (not openai/gpt-oss-20b)
    const dialogContent = await dialog.innerHTML();
    expect(dialogContent).toContain('gpt-oss-20b');
    expect(dialogContent).not.toContain('openai/gpt-oss-20b');
  });
});
