// E2E for the Prompt Playground admin page. The backend (POST /api/evolution/playground) is
// route-mocked with a deterministic result — real models would be slow/costly/nondeterministic.
// Verifies: navigation from the sidebar, parallel side-by-side results with cost, display-only
// format chips (output still shown), and temperature disabled for a null-maxTemperature model.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { safeGoto } from '@/lib/testing/safe-goto';

const MOCK_RESULT = {
  configs: [
    {
      label: 'config 1', output: '# Rewritten A\n\nFirst sentence. Second sentence.',
      costUsd: 0.0021, model: 'gpt-4.1-nano', temperatureUsed: 0.7, durationMs: 1200,
      status: 'success', formatValid: true,
    },
    {
      label: 'config 2', output: '# Rewritten B\n\n- a bullet\n- another bullet',
      costUsd: 0.0011, model: 'gpt-4.1-nano', temperatureUsed: 1.0, durationMs: 900,
      status: 'success', formatValid: false, formatIssues: ['No bullet points allowed'],
    },
  ],
  totalCostUsd: 0.0032,
};

adminTest.describe('Prompt Playground', { tag: '@evolution' }, () => {
  adminTest('navigates from the sidebar and renders the builder', async ({ adminPage }) => {
    await safeGoto(adminPage, '/admin/evolution-dashboard');
    await adminPage.getByTestId('evolution-sidebar-nav-prompt-playground').click();
    await expect(adminPage).toHaveURL(/\/admin\/evolution\/prompt-playground/);
    // Hydration proof: the source textarea + run button are present and interactive.
    await expect(adminPage.getByTestId('playground-source')).toBeVisible();
    await expect(adminPage.getByTestId('playground-run')).toBeVisible();
  });

  adminTest('runs configs in parallel and shows side-by-side outputs with cost', async ({ adminPage }) => {
    await adminPage.route('**/api/evolution/playground', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RESULT) });
    });

    await safeGoto(adminPage, '/admin/evolution/prompt-playground');
    await expect(adminPage.getByTestId('playground-source')).toBeVisible();

    await adminPage.getByTestId('playground-source').fill('# Source\n\nA paragraph with two sentences. And a second.');
    await adminPage.getByTestId('playground-add-config').click(); // 2 cards

    await adminPage.getByTestId('playground-run').click();

    // Two result panels render with output + cost.
    const panels = adminPage.getByTestId('playground-result-panel');
    await expect(panels).toHaveCount(2);
    await expect(adminPage.getByTestId('playground-output-0')).toContainText('Rewritten A');
    await expect(adminPage.getByTestId('playground-output-1')).toContainText('Rewritten B');
    await expect(adminPage.getByTestId('playground-cost-0')).toContainText('$0.0021');
    await expect(adminPage.getByTestId('playground-total-cost')).toContainText('$0.0032');

    // Display-only validation: the format chip renders while the (invalid) output is STILL shown.
    await expect(adminPage.getByTestId('playground-format-chip-1')).toContainText('would-drop');
    await expect(adminPage.getByTestId('playground-output-1')).toContainText('- a bullet');

    // "Diff vs parent" opens a full-width side-by-side (Parent | This output) patterned after
    // the variant-detail diff tab.
    await adminPage.getByTestId('playground-diff-toggle-0').click();
    const diffPanel = adminPage.getByTestId('playground-diff-panel');
    await expect(diffPanel).toBeVisible();
    await expect(diffPanel).toContainText('Diff vs parent');
    await expect(diffPanel.getByTestId('sxs-parent')).toContainText('Source'); // parent = shared source
    await expect(diffPanel.getByTestId('sxs-variant')).toContainText('Rewritten A');
    await adminPage.getByTestId('playground-diff-close').click();
    await expect(diffPanel).toHaveCount(0);
  });

  adminTest('disables the temperature input for a null-maxTemperature model (o3-mini)', async ({ adminPage }) => {
    await safeGoto(adminPage, '/admin/evolution/prompt-playground');
    await expect(adminPage.getByTestId('playground-source')).toBeVisible();

    const temp = adminPage.getByTestId('playground-temp-0');
    await expect(temp).toBeEnabled(); // default model supports temperature
    await adminPage.getByTestId('playground-model-0').selectOption('o3-mini');
    await expect(temp).toBeDisabled();
  });
});
