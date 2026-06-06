// E2E for the Prompt Editor admin page. The backend (POST /api/evolution/prompt-editor) is
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

adminTest.describe('Prompt Editor', { tag: '@evolution' }, () => {
  adminTest('navigates from the sidebar and renders the builder', async ({ adminPage }) => {
    await safeGoto(adminPage, '/admin/evolution-dashboard');
    await adminPage.getByTestId('evolution-sidebar-nav-prompt-editor').click();
    await expect(adminPage).toHaveURL(/\/admin\/evolution\/prompt-editor/);
    // Hydration proof: the source textarea + run button are present and interactive.
    await expect(adminPage.getByTestId('prompt-editor-source')).toBeVisible();
    await expect(adminPage.getByTestId('prompt-editor-run')).toBeVisible();
  });

  adminTest('renders the "Load recent" picker with an originals/rewritten toggle', async ({ adminPage }) => {
    await safeGoto(adminPage, '/admin/evolution/prompt-editor');
    await expect(adminPage.getByTestId('prompt-editor-load-recent')).toBeVisible();
    await expect(adminPage.getByTestId('prompt-editor-load-mode-rewritten')).toBeVisible();
    await expect(adminPage.getByTestId('prompt-editor-load-mode-original')).toBeVisible();
    await expect(adminPage.getByTestId('prompt-editor-recent-select')).toBeVisible();
    // Toggling the mode re-queries without error and keeps the picker present.
    await adminPage.getByTestId('prompt-editor-load-mode-original').click();
    await expect(adminPage.getByTestId('prompt-editor-recent-select')).toBeVisible();
  });

  adminTest('runs configs in parallel and shows side-by-side outputs with cost', async ({ adminPage }) => {
    await adminPage.route('**/api/evolution/prompt-editor', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_RESULT) });
    });

    await safeGoto(adminPage, '/admin/evolution/prompt-editor');
    await expect(adminPage.getByTestId('prompt-editor-source')).toBeVisible();

    await adminPage.getByTestId('prompt-editor-source').fill('# Source\n\nA paragraph with two sentences. And a second.');
    await adminPage.getByTestId('prompt-editor-add-config').click(); // 2 cards

    await adminPage.getByTestId('prompt-editor-run').click();

    // Two result panels render with output + cost.
    const panels = adminPage.getByTestId('prompt-editor-result-panel');
    await expect(panels).toHaveCount(2);
    await expect(adminPage.getByTestId('prompt-editor-output-0')).toContainText('Rewritten A');
    await expect(adminPage.getByTestId('prompt-editor-output-1')).toContainText('Rewritten B');
    await expect(adminPage.getByTestId('prompt-editor-cost-0')).toContainText('$0.0021');
    await expect(adminPage.getByTestId('prompt-editor-total-cost')).toContainText('$0.0032');

    // Display-only validation: the format chip renders while the (invalid) output is STILL shown.
    await expect(adminPage.getByTestId('prompt-editor-format-chip-1')).toContainText('would-drop');
    await expect(adminPage.getByTestId('prompt-editor-output-1')).toContainText('- a bullet');

    // The parent diff is ALWAYS shown inline in each result card (Parent | This output),
    // no click needed — patterned after the variant-detail diff tab.
    const diff0 = adminPage.getByTestId('prompt-editor-diff-0');
    await expect(diff0).toBeVisible();
    await expect(diff0.getByTestId('sxs-parent')).toContainText('Source'); // parent = shared source
    await expect(diff0.getByTestId('sxs-variant')).toContainText('Rewritten A');
    // Both cards have their own inline diff.
    await expect(adminPage.getByTestId('prompt-editor-diff-1')).toBeVisible();
  });

  adminTest('disables the temperature input for a null-maxTemperature model (o3-mini)', async ({ adminPage }) => {
    await safeGoto(adminPage, '/admin/evolution/prompt-editor');
    await expect(adminPage.getByTestId('prompt-editor-source')).toBeVisible();

    const temp = adminPage.getByTestId('prompt-editor-temp-0');
    await expect(temp).toBeEnabled(); // default model supports temperature
    await adminPage.getByTestId('prompt-editor-model-0').selectOption('o3-mini');
    await expect(temp).toBeDisabled();
  });
});
