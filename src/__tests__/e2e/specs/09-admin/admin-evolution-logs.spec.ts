/**
 * Admin Evolution LogsTab E2E tests.
 * Verifies the LogsTab filter UI renders correctly on a run detail page.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface SeededData {
  runId: string;
  strategyId: string;
  promptId: string;
}

async function seedRunWithLogs(): Promise<SeededData> {
  const supabase = getServiceClient();
  const ts = Date.now();

  const { data: strategy, error: e1 } = await supabase
    .from('evolution_strategies')
    .insert({
      config_hash: `e2e-logs-${ts}`,
      name: `[TEST] Logs Strategy ${ts}`,
      label: 'Gen: test | Judge: test',
      config: { generationModel: 'test', judgeModel: 'test', iterations: 1 },
      created_by: 'admin',
    })
    .select('id')
    .single();

  if (e1 || !strategy) throw new Error(`Failed to seed strategy: ${e1?.message}`);

  const { data: prompt, error: e2 } = await supabase
    .from('evolution_prompts')
    .insert({ prompt: `[TEST] Logs prompt ${ts}`, title: `[TEST] Logs ${ts}` })
    .select('id')
    .single();

  if (e2 || !prompt) throw new Error(`Failed to seed prompt: ${e2?.message}`);

  const { data: run, error: e3 } = await supabase
    .from('evolution_runs')
    .insert({
      strategy_id: strategy.id,
      prompt_id: prompt.id,
      budget_cap_usd: 1.0,
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (e3 || !run) throw new Error(`Failed to seed run: ${e3?.message}`);

  // Insert a log entry so the logs tab has data
  await supabase.from('evolution_logs').insert({
    entity_type: 'run',
    entity_id: run.id,
    run_id: run.id,
    strategy_id: strategy.id,
    level: 'info',
    message: '[TEST] E2E log entry',
    agent_name: 'setup',
    iteration: 1,
  });

  return { runId: run.id, strategyId: strategy.id, promptId: prompt.id };
}

async function cleanup(data: SeededData | undefined) {
  if (!data) return;
  const supabase = getServiceClient();
  await supabase.from('evolution_logs').delete().eq('run_id', data.runId);
  await supabase.from('evolution_variants').delete().eq('run_id', data.runId);
  await supabase.from('evolution_runs').delete().eq('id', data.runId);
  await supabase.from('evolution_strategies').delete().eq('id', data.strategyId);
  await supabase.from('evolution_prompts').delete().eq('id', data.promptId);
}

adminTest.describe('Admin Evolution LogsTab Filters', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let seeded: SeededData;

  adminTest.beforeAll(async () => {
    seeded = await seedRunWithLogs();
  });

  adminTest.afterAll(async () => {
    await cleanup(seeded);
  });

  adminTest(
    'LogsTab renders with iteration, message search, and variant ID filters',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/evolution/runs/${seeded.runId}`);
      await adminPage.waitForLoadState('domcontentloaded');

      // Click logs tab
      const logsTab = adminPage.locator('button:has-text("Logs"), [role="tab"]:has-text("Logs")');
      if (await logsTab.isVisible()) {
        await logsTab.click();
      }

      const logsContainer = adminPage.locator('[data-testid="logs-tab"]');
      await logsContainer.waitFor({ state: 'visible', timeout: 10_000 });

      // Verify level filter
      const levelFilter = logsContainer.locator('select[aria-label="Filter by level"]');
      await expect(levelFilter).toBeVisible();

      // Verify iteration filter
      const iterationFilter = logsContainer.locator('select[aria-label="Filter by iteration"]');
      await expect(iterationFilter).toBeVisible();

      // Verify message search
      const messageSearch = logsContainer.locator('input[aria-label="Search messages"]');
      await expect(messageSearch).toBeVisible();

      // Verify variant ID filter
      const variantIdFilter = logsContainer.locator('input[aria-label="Filter by variant ID"]');
      await expect(variantIdFilter).toBeVisible();
    },
  );
});
