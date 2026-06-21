// E2E test for the paragraph_recombine_with_coherence_pass strategy wizard flow.
// Per Verification section of:
// docs/planning/paragraph_recombine_agent_with_coherence_pass_evolution_20260620/
//   paragraph_recombine_agent_with_coherence_pass_evolution_20260620_planning.md
//
// COVERAGE:
//   - Wizard agent-type dropdown exposes 'paragraph_recombine_with_coherence_pass'
//   - Selecting it surfaces the conditional 5-knob coherence-pass field group
//   - Toggling coherencePassEnabled off greys out the sibling 4 inputs (disabled state)
//   - Full submit happy path: strategy row created with the new agentType + all
//     coherence-pass fields persisted into config.iterationConfigs[i]
//
// LLM-free: this spec only exercises the wizard UI + DB write. Runtime dispatch
// + LLM coverage is provided by unit tests (Phase 3-6) and the existing
// real-LLM run-pipeline E2E.
//
// Tagged @evolution so it runs only in the production-only E2E job, not the
// pre-merge gate.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { trackEvolutionId } from '../../helpers/evolution-test-data-factory';

const TEST_PREFIX = '[TEST] CoherencePassWizard';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Paragraph Recombine With Coherence Pass — Strategy Wizard', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let createdStrategyId: string | undefined;

  // Sweep leftover [TEST] CoherencePassWizard rows so Playwright strict-mode
  // locators don't trip on duplicates from prior interrupted runs.
  adminTest.beforeAll(async () => {
    const sb = getServiceClient();
    const { data: leftovers } = await sb
      .from('evolution_strategies')
      .select('id')
      .like('name', `${TEST_PREFIX}%`);
    if (!leftovers || leftovers.length === 0) return;
    const ids = leftovers.map((r) => r.id);
    await sb.from('evolution_metrics').delete().in('entity_id', ids);
    await sb.from('evolution_strategies').delete().in('id', ids);
  });

  adminTest.afterAll(async () => {
    if (!createdStrategyId) return;
    const sb = getServiceClient();
    await sb.from('evolution_metrics').delete().eq('entity_id', createdStrategyId);
    await sb.from('evolution_strategies').delete().eq('id', createdStrategyId);
  });

  /** Fill the step-1 form (name, generation model, budget) and advance to step 2.
   *  Mirrors admin-strategy-wizard.spec.ts:88's flow. */
  async function advanceToStep2(adminPage: import('@playwright/test').Page, name: string) {
    await adminPage.locator('#strategy-name').fill(name);
    await adminPage.locator('#generation-model').selectOption({ index: 1 });
    await adminPage.locator('#budget-usd').fill('1.50');
    await adminPage.locator('button', { hasText: 'Next: Configure Iterations' }).click();
  }

  adminTest('agent-type dropdown exposes paragraph_recombine_with_coherence_pass', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('text=New Strategy')).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    await advanceToStep2(adminPage, `${TEST_PREFIX} Dropdown`);

    const agentTypeSelect = adminPage.locator('[data-testid="agent-type-select-0"]');
    await expect(agentTypeSelect).toBeVisible({ timeout: 10000 });
    await expect(
      agentTypeSelect.locator('option[value="paragraph_recombine_with_coherence_pass"]'),
    ).toHaveCount(1);
  });

  adminTest('selecting the new agent type reveals the 5-knob coherence-pass field group', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    await advanceToStep2(adminPage, `${TEST_PREFIX} FieldGroup`);

    const agentTypeSelect = adminPage.locator('[data-testid="agent-type-select-0"]');
    await expect(agentTypeSelect).toBeVisible({ timeout: 10000 });

    // Default agent is 'generate' — the coherence-pass field group should NOT render.
    await expect(adminPage.locator('[data-testid="iteration-coherence-pass-controls-0"]')).toHaveCount(0);

    // Switch to the new agent type.
    await agentTypeSelect.selectOption('paragraph_recombine_with_coherence_pass');

    // All 5 controls visible.
    await expect(adminPage.locator('[data-testid="iteration-coherence-pass-controls-0"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="coherence-pass-enabled-0"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="coherence-pass-proposer-model-0"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="coherence-pass-approver-model-0"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="coherence-pass-rewrite-temp-floor-0"]')).toBeVisible();
    await expect(adminPage.locator('[data-testid="coherence-pass-rewrite-temp-ceiling-0"]')).toBeVisible();

    // The shared paragraph_recombine field group is ALSO visible (the new agent inherits it).
    await expect(adminPage.locator('[data-testid="iteration-paragraph-controls-0"]')).toBeVisible();
  });

  adminTest('unchecking coherencePassEnabled disables the sibling 4 inputs', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    await advanceToStep2(adminPage, `${TEST_PREFIX} ToggleDisabled`);

    const agentTypeSelect = adminPage.locator('[data-testid="agent-type-select-0"]');
    await expect(agentTypeSelect).toBeVisible({ timeout: 10000 });
    await agentTypeSelect.selectOption('paragraph_recombine_with_coherence_pass');

    const enabledCheckbox = adminPage.locator('[data-testid="coherence-pass-enabled-0"]');
    await expect(enabledCheckbox).toBeChecked();

    // All 4 sibling inputs are enabled (not disabled) initially.
    await expect(adminPage.locator('[data-testid="coherence-pass-proposer-model-0"]')).toBeEnabled();
    await expect(adminPage.locator('[data-testid="coherence-pass-approver-model-0"]')).toBeEnabled();
    await expect(adminPage.locator('[data-testid="coherence-pass-rewrite-temp-floor-0"]')).toBeEnabled();
    await expect(adminPage.locator('[data-testid="coherence-pass-rewrite-temp-ceiling-0"]')).toBeEnabled();

    // Uncheck → the 4 siblings should become disabled.
    await enabledCheckbox.uncheck();
    await expect(adminPage.locator('[data-testid="coherence-pass-proposer-model-0"]')).toBeDisabled();
    await expect(adminPage.locator('[data-testid="coherence-pass-approver-model-0"]')).toBeDisabled();
    await expect(adminPage.locator('[data-testid="coherence-pass-rewrite-temp-floor-0"]')).toBeDisabled();
    await expect(adminPage.locator('[data-testid="coherence-pass-rewrite-temp-ceiling-0"]')).toBeDisabled();

    // Re-check → re-enabled.
    await enabledCheckbox.check();
    await expect(adminPage.locator('[data-testid="coherence-pass-proposer-model-0"]')).toBeEnabled();
  });

  adminTest('full wizard happy path: create strategy with the new agent type + persist coherence-pass fields', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/strategies/new');
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('#strategy-name')).toBeVisible({ timeout: 15000 });

    const strategyName = `${TEST_PREFIX} Happy ${Date.now()}`;
    await advanceToStep2(adminPage, strategyName);

    const agentTypeSelect = adminPage.locator('[data-testid="agent-type-select-0"]');
    await expect(agentTypeSelect).toBeVisible({ timeout: 10000 });
    await agentTypeSelect.selectOption('paragraph_recombine_with_coherence_pass');

    // Override 2 of the 5 knobs to non-default values so we can assert they're
    // serialised into the strategy config (omitted-default fields are stripped
    // by the wizard's toIterationConfigsPayload — that's tested in the
    // integration test; here we exercise the explicit-value path).
    await adminPage.locator('[data-testid="coherence-pass-proposer-model-0"]').fill('gpt-4.1-mini');
    await adminPage.locator('[data-testid="coherence-pass-rewrite-temp-floor-0"]').fill('0.8');

    // Submit.
    const createBtn = adminPage.locator('button', { hasText: 'Create Strategy' });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // The wizard redirects to /admin/evolution/strategies/<id> on success.
    await adminPage.waitForURL(/\/admin\/evolution\/strategies\/[a-f0-9-]{8,}/, { timeout: 15000 });
    const url = adminPage.url();
    const idMatch = url.match(/\/strategies\/([a-f0-9-]{8,})/);
    expect(idMatch).not.toBeNull();
    createdStrategyId = idMatch![1]!;
    trackEvolutionId('strategy', createdStrategyId);

    // Assert the row was persisted with the right shape.
    const sb = getServiceClient();
    const { data: row, error } = await sb
      .from('evolution_strategies')
      .select('config')
      .eq('id', createdStrategyId)
      .single();
    expect(error).toBeNull();
    expect(row).toBeTruthy();

    const cfg = row!.config as { iterationConfigs: Array<Record<string, unknown>> };
    expect(Array.isArray(cfg.iterationConfigs)).toBe(true);
    expect(cfg.iterationConfigs.length).toBeGreaterThanOrEqual(1);
    const it0 = cfg.iterationConfigs[0]!;
    expect(it0.agentType).toBe('paragraph_recombine_with_coherence_pass');
    expect(it0.coherencePassProposerModel).toBe('gpt-4.1-mini');
    expect(it0.coherencePassRewriteTempFloor).toBe(0.8);
  });
});
