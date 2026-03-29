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

  adminTest('create strategy with preset selection @critical', async ({ adminPage }) => {
    // Navigate to strategies page
    await adminPage.goto('/admin/evolution/strategies');
    await expect(adminPage.getByText('Strategy Registry')).toBeVisible();

    // Open create dialog
    await adminPage.getByText('Create Strategy').click();
    await expect(adminPage.getByText('Create Strategy').first()).toBeVisible();

    // Fill in name
    await adminPage.getByTestId('strategy-name-input').fill(testStrategyName);

    // Verify agent selection is visible
    await expect(adminPage.getByText('Agent Selection')).toBeVisible();
    await expect(adminPage.getByText('Required (always enabled)')).toBeVisible();
    await expect(adminPage.getByText('Optional')).toBeVisible();

    // Toggle an optional agent
    const reflectionToggle = adminPage.getByTestId('agent-toggle-reflection');
    if (await reflectionToggle.isVisible()) {
      const isChecked = await reflectionToggle.isChecked();
      await reflectionToggle.click();
      // Verify toggle changed
      const newState = await reflectionToggle.isChecked();
      expect(newState).not.toBe(isChecked);
    }

    // Submit
    await adminPage.getByText('Create', { exact: true }).last().click();

    // Verify strategy appears in table
    await expect(adminPage.getByText(testStrategyName)).toBeVisible({ timeout: 10000 });
  });

  adminTest('model dropdown includes gpt-oss-20b without slash', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies');
    await expect(adminPage.getByText('Strategy Registry')).toBeVisible();

    // Open create dialog
    await adminPage.getByText('Create Strategy').click();
    await expect(adminPage.getByText('Create Strategy').first()).toBeVisible();

    // The model dropdown should contain gpt-oss-20b (not openai/gpt-oss-20b)
    const pageContent = await adminPage.content();
    expect(pageContent).toContain('gpt-oss-20b');
    expect(pageContent).not.toContain('openai/gpt-oss-20b');
  });
});
