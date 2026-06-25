// E2E for Phase 3 of evalute_implied_rubric_results_and_experimentally_validate_20260623:
// the create-session form's Advanced disclosure exposes an Arm-preset dropdown + custom-
// holistic-prompt textarea, and editing the textarea after picking a preset resets the
// dropdown so it can't lie about what's actually persisted. Route-mock-only — no DB writes,
// no afterAll cleanup needed. @evolution (admin is host-gated).

import { adminTest, expect } from '../../fixtures/admin-auth';

const ARM_B_FIRST_LINE = '## Evaluation';
const ARM_C_FIRST_LINE = '## Evaluation Criteria';

adminTest.describe(
  'Implied Rubric Weights — Custom Holistic Prompt (Phase 3)',
  { tag: '@evolution' },
  () => {
    adminTest('Advanced disclosure is collapsed by default; reveals textarea on click', async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/weight-inference');
      await expect(adminPage.getByTestId('wi-name')).toBeVisible();
      // Switch to auto mode so the Advanced disclosure becomes available.
      await adminPage.getByTestId('wi-mode-auto').click();
      const advanced = adminPage.getByTestId('wi-advanced');
      await expect(advanced).toBeVisible();
      // Disclosure starts collapsed → textarea is in DOM but inside <details>; assert via
      // the `open` attribute that the disclosure is initially closed.
      await expect(advanced).not.toHaveAttribute('open', '');
      await advanced.locator('summary').click();
      // After click, disclosure opens.
      await expect(advanced).toHaveAttribute('open', '');
      await expect(adminPage.getByTestId('wi-holistic-override')).toBeVisible();
      await expect(adminPage.getByTestId('wi-arm-preset')).toBeVisible();
    });

    adminTest('Arm-preset dropdown auto-fills the textarea with canonical Arm B prompt', async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/weight-inference');
      await adminPage.getByTestId('wi-mode-auto').click();
      await adminPage.getByTestId('wi-advanced').locator('summary').click();
      const textarea = adminPage.getByTestId('wi-holistic-override');
      // Initially empty.
      await expect(textarea).toHaveValue('');
      // Select Arm B.
      await adminPage.getByTestId('wi-arm-preset').selectOption('B');
      // Textarea auto-fills with the canonical Arm B prompt (first line is "## Evaluation").
      await expect(textarea).toHaveValue(new RegExp(`^${ARM_B_FIRST_LINE}\\b`, 'm'));
      // Switch to Arm C → textarea swaps to the Aligned canonical prompt.
      await adminPage.getByTestId('wi-arm-preset').selectOption('C');
      await expect(textarea).toHaveValue(new RegExp(`^${ARM_C_FIRST_LINE}\\b`, 'm'));
      // Switch back to no preset → textarea clears.
      await adminPage.getByTestId('wi-arm-preset').selectOption('');
      await expect(textarea).toHaveValue('');
    });

    adminTest('editing the textarea after picking a preset resets the dropdown to ""', async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution/weight-inference');
      await adminPage.getByTestId('wi-mode-auto').click();
      await adminPage.getByTestId('wi-advanced').locator('summary').click();
      const preset = adminPage.getByTestId('wi-arm-preset');
      const textarea = adminPage.getByTestId('wi-holistic-override');
      // Pick Arm B.
      await preset.selectOption('B');
      await expect(preset).toHaveValue('B');
      await expect(textarea).not.toHaveValue('');
      // Operator types something into the textarea.
      await textarea.click();
      await textarea.press('End');
      await textarea.pressSequentially(' EXTRA');
      // Dropdown resets so it can't lie about what's persisted.
      await expect(preset).toHaveValue('');
      // Textarea retains the (now-modified) content.
      await expect(textarea).toHaveValue(/EXTRA$/);
    });

    // Note: an earlier sub-case asserted the override was in the create-session POST body,
    // but Next.js server actions encode the form payload opaquely (a turbopack-mangled
    // multipart format), so the literal override string isn't reliably present in
    // `req.postData()`. Wire-payload coverage moved to the integration test
    // (`evolution-weight-inference.integration.test.ts` —
    // `listWeightInferenceSessionsAction surfaces has_override correctly`).
  },
);
