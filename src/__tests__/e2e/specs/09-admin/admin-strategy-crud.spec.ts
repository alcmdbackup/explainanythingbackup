/**
 * @critical
 * Admin Strategy Registry E2E tests.
 * Tests create strategy with preset and agent selection.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

adminTest.describe('Strategy Registry CRUD', () => {
  const testStrategyName = `[E2E] Test Strategy ${Date.now()}`;

  adminTest.afterAll(async () => {
    const supabase = createClient(
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

  adminTest('create strategy with form dialog @critical', async ({ adminPage }) => {
    // Navigate to strategies page
    await adminPage.goto('/admin/evolution/strategies');
    await expect(adminPage.locator('main').getByRole('heading', { name: 'Strategies' })).toBeVisible({ timeout: 15000 });

    // Open create dialog via header action button
    await adminPage.locator('[data-testid="header-action"]').click();
    const dialog = adminPage.locator('div[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Fill in name
    await dialog.getByPlaceholder('Strategy name').fill(testStrategyName);

    // Select generation model (required)
    const genModelSelect = dialog.locator('select').first();
    const genOptions = await genModelSelect.locator('option').allTextContents();
    const validModel = genOptions.find(o => o !== 'Select a model...' && o.trim() !== '');
    if (validModel) await genModelSelect.selectOption({ label: validModel });

    // Select judge model (required)
    const judgeModelSelect = dialog.locator('select').nth(1);
    const judgeOptions = await judgeModelSelect.locator('option').allTextContents();
    const validJudge = judgeOptions.find(o => o !== 'Select a model...' && o.trim() !== '');
    if (validJudge) await judgeModelSelect.selectOption({ label: validJudge });

    // Fill iterations
    const iterInput = dialog.getByRole('spinbutton');
    await iterInput.fill('3');

    // Submit via Save button
    await dialog.getByRole('button', { name: /save/i }).click();

    // Wait for dialog to close (save completed)
    await expect(dialog).not.toBeVisible({ timeout: 15000 });

    // Uncheck "Hide test content" to see [E2E] prefixed strategies
    const hideTestCheckbox = adminPage.locator('[data-testid="filter-filterTestContent"] input[type="checkbox"]');
    if (await hideTestCheckbox.isChecked()) {
      await hideTestCheckbox.click();
    }

    // Verify strategy appears in table (wait for reload after filter change)
    await expect(adminPage.locator('[data-testid="entity-list-table"]').getByText(testStrategyName)).toBeVisible({ timeout: 15000 });
  });

  adminTest('model dropdown includes gpt-oss-20b without slash', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies');
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
