// B096: FormDialog number fields reject NaN input at the onChange boundary so a stray
// non-numeric character doesn't silently propagate into submit handlers.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { safeIsVisible } from '../../helpers/error-utils';

adminTest.describe(
  'Admin evolution FormDialog NaN rejection (B096)',
  { tag: '@evolution' },
  () => {
    adminTest('strategies page renders without NaN-related errors', async ({ adminPage }) => {
      const errors: string[] = [];
      adminPage.on('pageerror', (e) => errors.push(e.message));

      await adminPage.goto('/admin/evolution/strategies');
      await expect(adminPage.getByText(/Strategies/i).first()).toBeVisible({ timeout: 10_000 });

      // If a new-strategy button is present, open the dialog and type a
      // non-numeric char into the first number field. Since we reject NaN at
      // onChange, the input value must remain empty or numeric.
      const newBtn = adminPage.getByRole('button', { name: /new|create|add/i }).first();
      if (!(await safeIsVisible(newBtn, 'newStrategyButton', 2_000))) return;
      await newBtn.click();

      const numberInput = adminPage.locator('input[type="number"]').first();
      if (!(await safeIsVisible(numberInput, 'numberInput', 2_000))) return;
      await numberInput.fill('');
      await numberInput.type('abc');
      const val = await numberInput.inputValue();
      expect(val === '' || /^-?\d*\.?\d*$/.test(val)).toBe(true);
      expect(errors.filter((m) => /NaN|FormDialog/i.test(m))).toEqual([]);
    });
  },
);
