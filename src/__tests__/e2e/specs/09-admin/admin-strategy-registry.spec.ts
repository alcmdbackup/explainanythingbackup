/**
 * Admin Strategy Registry E2E tests.
 * Tests the Origin (created_by) filter dropdown on the strategy registry page.
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

interface SeededStrategies {
  adminId: string;
  experimentId: string;
}

async function seedStrategies(): Promise<SeededStrategies> {
  const supabase = getServiceClient();
  const ts = Date.now();

  const { data: admin, error: e1 } = await supabase
    .from('evolution_strategy_configs')
    .insert({
      config_hash: `e2e-admin-${ts}`,
      name: `[TEST] Admin Strategy ${ts}`,
      label: 'Gen: test | Judge: test',
      config: { generationModel: 'test', judgeModel: 'test', iterations: 1 },
      created_by: 'admin',
      is_predefined: true,
    })
    .select('id')
    .single();

  if (e1 || !admin) throw new Error(`Failed to seed admin strategy: ${e1?.message}`);

  const { data: experiment, error: e2 } = await supabase
    .from('evolution_strategy_configs')
    .insert({
      config_hash: `e2e-experiment-${ts}`,
      name: `[TEST] Experiment Strategy ${ts}`,
      label: 'Gen: test-exp | Judge: test-exp',
      config: { generationModel: 'test-exp', judgeModel: 'test-exp', iterations: 3 },
      created_by: 'experiment',
    })
    .select('id')
    .single();

  if (e2 || !experiment) throw new Error(`Failed to seed experiment strategy: ${e2?.message}`);

  return { adminId: admin.id, experimentId: experiment.id };
}

async function cleanupStrategies(data: SeededStrategies | undefined) {
  if (!data) return;
  const supabase = getServiceClient();
  await supabase.from('evolution_strategy_configs').delete().in('id', [data.adminId, data.experimentId]);
}

adminTest.describe('Admin Strategy Registry - Origin Filter', () => {
  let seeded: SeededStrategies;

  adminTest.beforeAll(async () => {
    seeded = await seedStrategies();
  });

  adminTest.afterAll(async () => {
    await cleanupStrategies(seeded);
  });

  adminTest(
    'page shows Origin filter dropdown',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/strategies');
      await adminPage.waitForLoadState('domcontentloaded');

      const originFilter = adminPage.locator('[data-testid="created-by-filter"]');
      await expect(originFilter).toBeVisible();

      // Should have All, Admin, System, Experiment, Batch options
      const options = originFilter.locator('option');
      await expect(options).toHaveCount(5);
    },
  );

  adminTest(
    'Origin filter filters strategies by created_by value',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/strategies');
      await adminPage.waitForLoadState('domcontentloaded');

      // Select "Experiment" filter
      await adminPage.locator('[data-testid="created-by-filter"]').selectOption('experiment');

      // Wait for table to reload after filter change
      const table = adminPage.locator('[data-testid="strategies-table"]');
      await table.waitFor({ state: 'visible' });
    },
  );
});
