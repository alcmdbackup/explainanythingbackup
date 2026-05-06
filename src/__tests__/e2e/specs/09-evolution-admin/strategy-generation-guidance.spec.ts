// Verify the per-iteration tactic guidance UI appears on the strategy creation
// wizard's iterations step, and that the editor's preset/Apply controls work.
//
// Note: the legacy "generationGuidance" form-level dialog field (with
// guidance-add/guidance-total/guidance-strategy-N testids) was refactored in
// PR #990 (multi_iteration_strategy_support_evolution_20260415) into a
// per-iteration tactic guidance editor on the new wizard at /strategies/new.
import { adminTest as test, expect } from '../../fixtures/admin-auth';

test.describe('Strategy creation tactic guidance UI', () => {
  test.describe.configure({ mode: 'serial' });

  test('iteration row exposes tactic guidance editor with preset controls', async ({ adminPage: page }) => {
    await page.goto('/admin/evolution/strategies/new');

    // Wait for the wizard to hydrate before interacting — visible !== interactive.
    // The Next button is rendered client-side based on `step === 'config'`, so its
    // visibility is hydration proof per testing_overview.md Rule 18.
    const nextBtn = page.getByRole('button', { name: /Next: Configure Iterations/i });
    await expect(nextBtn).toBeVisible({ timeout: 15000 });

    // Step 1: fill required config fields so the Next button advances.
    const nameInput = page.locator('#strategy-name');
    await nameInput.fill(`[E2E] tactic-guidance-${Date.now()}`);
    await expect(nameInput).not.toHaveValue('');
    await page.locator('#generation-model').selectOption('deepseek-chat');
    await page.locator('#judge-model').selectOption('deepseek-chat');

    // Advance to step 2 (iterations). Default first iteration is 'generate', so
    // the tactic guidance button should appear at index 0.
    await nextBtn.click();

    const guidanceBtn = page.getByTestId('tactic-guidance-btn-0');
    await expect(guidanceBtn).toBeVisible({ timeout: 15000 });

    // Open the inline editor.
    await guidanceBtn.click();
    const editor = page.getByTestId('tactic-guidance-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(editor.getByText('Configure Tactics')).toBeVisible();
    await expect(editor.getByText(/Total: 0%/)).toBeVisible();

    // Apply button is disabled when total != 100%.
    const applyBtn = editor.getByRole('button', { name: /^Apply$/ });
    await expect(applyBtn).toBeDisabled();

    // 'Even' preset distributes weights so the sum reaches exactly 100%.
    await editor.getByRole('button', { name: /^Even$/ }).click();
    await expect(editor.getByText(/Total: 100%/)).toBeVisible();
    await expect(applyBtn).toBeEnabled();

    // 'Clear' closes the editor and resets guidance.
    await editor.getByRole('button', { name: /^Clear$/ }).click();
    await expect(editor).not.toBeVisible();
  });
});
