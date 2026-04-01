// E2E test for anchor badge display on arena leaderboard.
// Verifies that low-sigma entries show "Anchor" badge and header shows anchor count.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { trackEvolutionId } from '../../helpers/evolution-test-data-factory';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const VALID_VARIANT_TEXT = '# Test Variant\n\n## Introduction\n\nThis is a test variant with enough content to pass validation. It has multiple paragraphs and sections to meet minimum length requirements for the evolution pipeline.';

adminTest.describe('Arena Leaderboard Anchor Badge', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let promptId: string;
  const variantIds: string[] = [];

  adminTest.beforeAll(async () => {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Create test prompt
    const ts = Date.now();
    const { data: prompt, error: promptErr } = await supabase
      .from('evolution_prompts')
      .insert({ prompt: `[E2E] Anchor test prompt ${ts}`, name: `[E2E] Anchor Test ${ts}`, status: 'active' })
      .select('id')
      .single();
    if (promptErr || !prompt) throw new Error(`Failed to seed prompt: ${promptErr?.message ?? 'null data'}`);
    promptId = prompt.id as string;
    trackEvolutionId('prompt', promptId);

    // Create a dummy run for the arena entries
    const { data: strategy } = await supabase
      .from('evolution_strategies')
      .insert({
        name: `[E2E] Anchor Strategy ${Date.now()}`,
        config: { generationModel: 'gpt-4.1-nano', judgeModel: 'gpt-4.1-nano', iterations: 1 },
        config_hash: `anchor-test-${Date.now()}`,
      })
      .select('id')
      .single();
    trackEvolutionId('strategy', strategy!.id as string);

    const { data: run } = await supabase
      .from('evolution_runs')
      .insert({
        prompt_id: promptId,
        strategy_id: strategy!.id,
        status: 'completed',
      })
      .select('id')
      .single();
    trackEvolutionId('run', run!.id as string);

    // Create 8 arena entries with varying sigmas
    // Bottom 25% (2 entries) = anchors: sigma 2.0 and 3.0
    // Rest: sigma 5.0-8.0
    const sigmas = [2.0, 3.0, 5.0, 5.5, 6.0, 6.5, 7.0, 8.0];
    for (let i = 0; i < sigmas.length; i++) {
      const id = crypto.randomUUID();
      variantIds.push(id);
      trackEvolutionId('variant', id);
      await supabase.from('evolution_variants').insert({
        id,
        run_id: run!.id,
        prompt_id: promptId,
        variant_content: `${VALID_VARIANT_TEXT}\n\nVariant ${i + 1}`,
        mu: 25 + i,
        sigma: sigmas[i],
        elo_score: 1200 + i * 50,
        synced_to_arena: true,
        arena_match_count: 10 + i * 5,
        generation_method: 'pipeline',
      });
    }
  });

  adminTest.afterAll(async () => {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    // Cleanup in FK-safe order
    if (variantIds.length > 0) {
      await supabase.from('evolution_variants').delete().in('id', variantIds);
    }
    // Prompts, strategies, runs cleaned up by global teardown via tracking
  });

  adminTest('arena leaderboard shows anchor badges for low-sigma entries', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/arena/${promptId}`);
    await expect(adminPage.getByTestId('leaderboard-table')).toBeVisible({ timeout: 15000 });

    // Verify anchor count badge in header
    const anchorCount = adminPage.getByTestId('anchor-count');
    await expect(anchorCount).toBeVisible();
    await expect(anchorCount).toContainText('anchor');

    // Verify anchor badges exist in table
    const anchorBadges = adminPage.getByTestId('anchor-badge');
    const count = await anchorBadges.count();
    expect(count).toBeGreaterThanOrEqual(2); // At least 2 anchors (bottom 25% of 8 = 2)
  });
});
