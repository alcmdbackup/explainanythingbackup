/**
 * @evolution
 * Admin Strategy Registry E2E tests.
 * Tests create strategy with preset and agent selection.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// NOTE: tag the formerly-@critical test below at the TEST level (not the describe),
// so the untagged `paragraph_recombine` tests (#1116, currently failing in the evolution
// E2E job — page crash on selectOption) are NOT enrolled here. Those are a separate,
// pre-existing concern tracked outside this broken-nightly fix.
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

  adminTest('create strategy with wizard', { tag: '@evolution' }, async ({ adminPage }) => {
    // Navigate to strategies page
    await adminPage.goto('/admin/evolution/strategies', { timeout: 30000 });
    await expect(adminPage.locator('main').getByRole('heading', { name: 'Strategies' })).toBeVisible({ timeout: 15000 });

    // Click "New Strategy" — navigates to /strategies/new wizard
    await adminPage.locator('[data-testid="header-action"]').click();
    await expect(adminPage).toHaveURL(/\/strategies\/new/, { timeout: 15000 });

    // Step 1: Fill strategy config — use specific selectors matching wizard-tactics.spec.ts
    // (placeholder="Strategy name" + #generation-model + #judge-model) to avoid fuzzy-match flake
    await adminPage.fill('input[placeholder="Strategy name"]', testStrategyName);
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('#judge-model').selectOption({ index: 1 });

    // Set budget (specific id)
    const budgetInput = adminPage.locator('#budget-usd');
    await budgetInput.fill('1.00');

    // Click Next to go to Step 2 (Iterations)
    await adminPage.click('button:has-text("Next: Configure Iterations")');

    // Step 2: wait for an iteration row to render (matches wizard-tactics.spec.ts pattern)
    await adminPage.waitForSelector('[data-testid="tactic-guidance-btn-0"]', { timeout: 30000 });

    // Click Create Strategy submit
    await adminPage.click('button:has-text("Create Strategy")');

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

  // investigate_sequential_paragraph_recombine_performance_20260615 Phase 1d (Fix 5b):
  // The strategy wizard exposes TWO independent rubric dropdowns — Judge Rubric
  // (article-level) and the new Paragraph Judge Rubric (slot-level for
  // paragraph_recombine). Strategy authors must be able to set them distinctly.
  adminTest('wizard exposes paragraph-judge-rubric dropdown distinct from judge-rubric (Phase 1d)', { tag: '@evolution' }, async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new', { timeout: 30000 });

    // Wait for the form to render — generation-model is the first select on Step 1.
    await adminPage.waitForSelector('#generation-model', { timeout: 15000 });

    // Both rubric pickers must be present and BE DISTINCT elements.
    const judgeRubric = adminPage.locator('[data-testid="judge-rubric-select"]');
    const paragraphJudgeRubric = adminPage.locator('[data-testid="paragraph-judge-rubric-select"]');
    await expect(judgeRubric).toBeVisible({ timeout: 15000 });
    await expect(paragraphJudgeRubric).toBeVisible({ timeout: 15000 });

    // The two dropdowns are independent — they're different DOM elements with
    // different ids. Counting matches must give exactly one of each.
    await expect(judgeRubric).toHaveCount(1);
    await expect(paragraphJudgeRubric).toHaveCount(1);

    // The paragraph picker's default option telegraphs the hardcoded fallback rubric
    // (Phase 1c-iii criteria — Coherence + Conciseness in particular), steering
    // custom-rubric authors toward similar paragraph-shaped dimensions.
    await expect(paragraphJudgeRubric).toContainText('Default paragraph rubric');
    await expect(paragraphJudgeRubric).toContainText('Conciseness');
    await expect(paragraphJudgeRubric).toContainText('Coherence');
  });

  adminTest('model dropdown includes gpt-oss-20b without slash', async ({ adminPage }) => {
    // Strategy creation moved from dialog to wizard page (/strategies/new)
    await adminPage.goto('/admin/evolution/strategies/new', { timeout: 30000 });

    // Generation model select on Step 1 of wizard
    const genModelSelect = adminPage.locator('select').first();
    await expect(genModelSelect).toBeVisible({ timeout: 15000 });

    // Inspect option values (model IDs, not display names like "GPT-OSS 20B")
    const optionValues = await genModelSelect.locator('option').evaluateAll(
      (opts) => opts.map((o) => (o as HTMLOptionElement).value),
    );
    const joined = optionValues.join('\n');
    expect(joined).toContain('gpt-oss-20b');
    expect(joined).not.toContain('openai/gpt-oss-20b');
  });

  adminTest('model dropdown includes DeepSeek V4 models', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new', { timeout: 30000 });

    const genModelSelect = adminPage.locator('select').first();
    await expect(genModelSelect).toBeVisible({ timeout: 15000 });

    const optionValues = await genModelSelect.locator('option').evaluateAll(
      (opts) => opts.map((o) => (o as HTMLOptionElement).value),
    );
    expect(optionValues).toContain('deepseek-v4-pro');
    expect(optionValues).toContain('deepseek-v4-flash');
  });

  // rank_individual_paragraphs_evolution_20260525 Phase 6 — paragraph_recombine wizard controls.
  adminTest('paragraph_recombine wizard controls appear only for paragraph_recombine iterations', { tag: '@evolution' }, async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    // The wizard starts on Step 1 (Strategy Config); per-iteration controls only render on
    // Step 2 (Iterations). Fill the minimum required on Step 1 and advance, mirroring the
    // pattern used by the 'create strategy with wizard' test above.
    await adminPage.fill('input[placeholder="Strategy name"]', '[E2E] paragraph_recombine wizard appear');
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('#judge-model').selectOption({ index: 1 });
    await adminPage.locator('#budget-usd').fill('1.00');
    await adminPage.click('button:has-text("Next: Configure Iterations")');

    // Per-iteration agent-type select for iteration 0. Initially defaults to 'generate'
    // (no paragraph controls visible).
    expect(await adminPage.locator('[data-testid="iteration-paragraph-controls-0"]').count()).toBe(0);

    // Switch the iteration's agent type to paragraph_recombine.
    const iter0AgentSelect = adminPage.locator('select').filter({ hasText: /generate|paragraph/i }).first();
    await iter0AgentSelect.selectOption('paragraph_recombine');

    // Controls become visible with default values populated.
    await expect(adminPage.locator('[data-testid="iteration-paragraph-controls-0"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="rewrites-per-paragraph-0"]')).toHaveValue('3');
    await expect(adminPage.locator('[data-testid="max-comparisons-per-paragraph-0"]')).toHaveValue('8');
    await expect(adminPage.locator('[data-testid="max-paragraphs-per-invocation-0"]')).toHaveValue('12');
  });

  adminTest('paragraph_recombine wizard controls clear when agent type switches away', { tag: '@evolution' }, async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new', { timeout: 30000 });
    await adminPage.waitForLoadState('domcontentloaded');

    // Advance to Step 2 (Iterations) — see the appear-test above for rationale.
    await adminPage.fill('input[placeholder="Strategy name"]', '[E2E] paragraph_recombine wizard clear');
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('#judge-model').selectOption({ index: 1 });
    await adminPage.locator('#budget-usd').fill('1.00');
    await adminPage.click('button:has-text("Next: Configure Iterations")');

    const iter0AgentSelect = adminPage.locator('select').filter({ hasText: /generate|paragraph/i }).first();
    await iter0AgentSelect.selectOption('paragraph_recombine');
    await expect(adminPage.locator('[data-testid="iteration-paragraph-controls-0"]')).toBeVisible();

    // Switch back to generate — controls should disappear.
    await iter0AgentSelect.selectOption('generate');
    expect(await adminPage.locator('[data-testid="iteration-paragraph-controls-0"]').count()).toBe(0);
  });
});
