/**
 * @critical
 * Admin Prompt Registry E2E tests.
 * Tests create, edit, and delete flows on the prompts page.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

adminTest.describe('Prompt Registry CRUD', () => {
  const testPromptTitle = `[E2E] Test Prompt ${Date.now()}`;

  adminTest.afterAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data } = await supabase
      .from('evolution_prompts')
      .select('id')
      .ilike('name', '[E2E] Test Prompt%');
    if (data && data.length > 0) {
      const ids = data.map(p => p.id as string);
      const { data: runs } = await supabase.from('evolution_runs').select('id').in('prompt_id', ids);
      const runIds = (runs ?? []).map(r => r.id as string);
      if (runIds.length > 0) {
        await supabase.from('evolution_arena_comparisons').delete().in('run_id', runIds);
        await supabase.from('evolution_logs').delete().in('run_id', runIds);
        await supabase.from('evolution_agent_invocations').delete().in('run_id', runIds);
        await supabase.from('evolution_variants').delete().in('run_id', runIds);
        await supabase.from('evolution_runs').delete().in('id', runIds);
      }
      await supabase.from('evolution_prompts').delete().in('id', ids);
    }
  });

  adminTest('create, edit, and delete a prompt @critical', async ({ adminPage }) => {
    // Navigate to prompts page
    await adminPage.goto('/admin/evolution/prompts');
    await expect(adminPage.getByText('Prompts')).toBeVisible();

    // Create prompt
    await adminPage.getByTestId('header-action').click();
    await adminPage.getByRole('textbox', { name: /name/i }).first().fill(testPromptTitle);
    await adminPage.getByRole('textbox', { name: /prompt/i }).first().fill('Explain photosynthesis to a 10-year-old');
    await adminPage.getByRole('button', { name: /save|submit|create/i }).click();

    // Verify prompt appears in table
    await expect(adminPage.getByText(testPromptTitle)).toBeVisible({ timeout: 10000 });

    // Edit prompt
    const row = adminPage.locator('tr', { hasText: testPromptTitle });
    await row.getByText('Edit').click();
    await adminPage.getByRole('textbox', { name: /name/i }).first().clear();
    await adminPage.getByRole('textbox', { name: /name/i }).first().fill(`${testPromptTitle} (edited)`);
    await adminPage.getByRole('button', { name: /save|submit/i }).click();

    // Verify edit
    await expect(adminPage.getByText(`${testPromptTitle} (edited)`)).toBeVisible({ timeout: 10000 });

    // Delete prompt
    const editedRow = adminPage.locator('tr', { hasText: `${testPromptTitle} (edited)` });
    await editedRow.getByText('Delete').click();
    await adminPage.getByRole('button', { name: /delete/i }).last().click();

    // Verify deleted (row should disappear)
    await expect(adminPage.getByText(`${testPromptTitle} (edited)`)).not.toBeVisible({ timeout: 5000 });
  });
});
