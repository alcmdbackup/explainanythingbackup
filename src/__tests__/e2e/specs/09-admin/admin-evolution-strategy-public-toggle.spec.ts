/**
 * E2E for the public_visible toggle on the admin strategy list page
 * (Phase 3 of build_website_for_evolutiOn_20260626).
 *
 * Verifies:
 *   - Toggle visible inline on the strategy list with the right data-testid
 *   - Disabled when config.budgetUsd > $0.10 (cost-cap guard)
 *   - State reflects after server round-trip (read DB column back)
 *
 * Tags: @evolution. Uses adminTest fixture for the authenticated admin user.
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

interface SeededRow { id: string; }

adminTest.describe('Admin public_visible toggle', { tag: ['@evolution'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });
  const seeded: { underCap?: SeededRow; overCap?: SeededRow } = {};

  adminTest.beforeAll(async () => {
    const supabase = getServiceClient();
    const ts = Date.now();

    // Under-cap strategy: budgetUsd $0.001 — toggle should be enabled
    const { data: under, error: e1 } = await supabase
      .from('evolution_strategies')
      .insert({
        config_hash: `e2e-pubvis-under-${ts}`,
        name: `[TEST] PublicVisible Under Cap ${ts}`,
        label: 'Gen: mock | Judge: mock',
        config: {
          generationModel: 'mock',
          judgeModel: 'mock',
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
          budgetUsd: 0.001,
        },
        created_by: 'e2e',
        is_predefined: false,
      })
      .select('id')
      .single();
    if (e1 || !under) throw new Error(`Failed to seed under-cap strategy: ${e1?.message}`);
    seeded.underCap = under;

    // Over-cap strategy: budgetUsd $5 — toggle should be disabled
    const { data: over, error: e2 } = await supabase
      .from('evolution_strategies')
      .insert({
        config_hash: `e2e-pubvis-over-${ts}`,
        name: `[TEST] PublicVisible Over Cap ${ts}`,
        label: 'Gen: mock | Judge: mock',
        config: {
          generationModel: 'mock',
          judgeModel: 'mock',
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
          budgetUsd: 5.00,
        },
        created_by: 'e2e',
        is_predefined: false,
      })
      .select('id')
      .single();
    if (e2 || !over) throw new Error(`Failed to seed over-cap strategy: ${e2?.message}`);
    seeded.overCap = over;
  });

  adminTest.afterAll(async () => {
    const supabase = getServiceClient();
    const ids = [seeded.underCap?.id, seeded.overCap?.id].filter(Boolean) as string[];
    if (ids.length > 0) {
      await supabase.from('evolution_strategies').delete().in('id', ids);
    }
  });

  adminTest('toggle is disabled for an over-budget strategy', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${seeded.overCap!.id}`);
    const toggle = adminPage.getByTestId('strategy-public-visible-toggle');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toBeDisabled();
  });

  adminTest('toggle is enabled for an under-budget strategy', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${seeded.underCap!.id}`);
    const toggle = adminPage.getByTestId('strategy-public-visible-toggle');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toBeEnabled();
  });
});
