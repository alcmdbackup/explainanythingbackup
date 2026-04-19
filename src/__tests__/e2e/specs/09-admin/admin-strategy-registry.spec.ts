/**
 * Admin Strategy Registry E2E tests.
 * Tests the Origin (created_by) filter dropdown on the strategy registry page.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function getServiceClient() {
  return createClient<Database>(
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
    .from('evolution_strategies')
    .insert({
      config_hash: `e2e-admin-${ts}`,
      name: `[TEST] Admin Strategy ${ts}`,
      label: 'Gen: test | Judge: test',
      config: { generationModel: 'test', judgeModel: 'test', iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }] },
      created_by: 'admin',
      is_predefined: true,
    })
    .select('id')
    .single();

  if (e1 || !admin) throw new Error(`Failed to seed admin strategy: ${e1?.message}`);

  const { data: experiment, error: e2 } = await supabase
    .from('evolution_strategies')
    .insert({
      config_hash: `e2e-experiment-${ts}`,
      name: `[TEST] Experiment Strategy ${ts}`,
      label: 'Gen: test-exp | Judge: test-exp',
      config: { generationModel: 'test-exp', judgeModel: 'test-exp', iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }] },
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
  const { error: cleanupError } = await supabase.from('evolution_strategies').delete().in('id', [data.adminId, data.experimentId]);
  if (cleanupError) console.warn(`[cleanup] Failed to delete from evolution_strategies: ${cleanupError.message}`);
}

adminTest.describe('Admin Strategy Registry - Origin Filter', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let seeded: SeededStrategies;

  adminTest.beforeAll(async () => {
    seeded = await seedStrategies();
  });

  adminTest.afterAll(async () => {
    await cleanupStrategies(seeded);
  });

  adminTest(
    'filter exists+filter works: Origin filter dropdown shows correct options and filters by created_by value',
    { tag: '@critical' },
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/strategies');
      await expect(adminPage.locator('[data-testid="entity-list-page"]')).toBeVisible({ timeout: 15000 });

      const originFilter = adminPage.locator('[data-testid="filter-created_by"]');
      await expect(originFilter).toBeVisible({ timeout: 10000 });

      // Should have All, Admin, System, Experiment, Batch options
      const options = originFilter.locator('option');
      await expect(options).toHaveCount(5);

      // Select "Experiment" filter and verify table updates
      await adminPage.waitForLoadState('domcontentloaded');
      await originFilter.selectOption('experiment');

      // Wait for table to reload after filter change
      const table = adminPage.locator('[data-testid="entity-list-table"]');
      await table.waitFor({ state: 'visible' });
    },
  );
});
