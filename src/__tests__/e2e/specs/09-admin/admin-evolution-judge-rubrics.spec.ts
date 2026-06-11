// E2E for the Judge Rubrics admin page: the builder picks evolution_criteria as weighted
// dimensions, validates that weights sum to 100% (Save disabled + error until they do), and
// persists a new rubric that then appears in the list. (structured_judging_evolution_20260610)

import { randomUUID } from 'crypto';
import { adminTest, expect } from '../../fixtures/admin-auth';
import {
  createTestCriteria,
  getEvolutionServiceClient,
  cleanupAllTrackedEvolutionData,
} from '../../helpers/evolution-test-data-factory';

adminTest.describe('Evolution Judge Rubrics admin', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial', retries: 2 });

  const critNames: string[] = [];
  const createdRubricName = `[TEST_EVO] e2e rubric ${randomUUID()}`;

  adminTest.beforeAll(async () => {
    // Seed two criteria (factory-generated, format-valid names) as builder dimensions.
    for (let i = 0; i < 2; i++) {
      const c = await createTestCriteria();
      critNames.push(c.name);
    }
  });

  adminTest.afterAll(async () => {
    // The UI-created rubric isn't auto-tracked; delete it by name first (cascades its
    // dimensions) so the tracked criteria can then be removed (FK ON DELETE RESTRICT).
    const db = getEvolutionServiceClient() as unknown as {
      from: (t: string) => { delete: () => { eq: (c: string, v: string) => Promise<unknown> } };
    };
    await db.from('evolution_judge_rubrics').delete().eq('name', createdRubricName);
    await cleanupAllTrackedEvolutionData();
  });

  adminTest('builds and persists a new rubric with weights summing to 100%', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/judge-rubrics');
    await expect(adminPage.locator('[data-testid="judge-rubrics-page"]')).toBeVisible({ timeout: 30000 });

    await adminPage.getByTestId('new-rubric-btn').click();
    await expect(adminPage.getByTestId('rubric-builder')).toBeVisible();

    await adminPage.getByTestId('rubric-name').fill(createdRubricName);
    // Toggling each dimension re-balances to an even split → two dims sum to exactly 100%.
    await adminPage.getByTestId(`dim-toggle-${critNames[0]}`).check();
    await adminPage.getByTestId(`dim-toggle-${critNames[1]}`).check();

    await expect(adminPage.getByTestId('weight-sum')).toContainText('✓ 100%');
    const save = adminPage.getByTestId('rubric-save');
    await expect(save).toBeEnabled();
    await save.click();

    // After save the list reloads; the new rubric appears as a row.
    await expect(adminPage.getByText(createdRubricName)).toBeVisible({ timeout: 15000 });
  });

  adminTest('shows a weight-sum error and disables Save until weights total 100%', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/judge-rubrics');
    await expect(adminPage.locator('[data-testid="judge-rubrics-page"]')).toBeVisible({ timeout: 30000 });

    await adminPage.getByTestId('new-rubric-btn').click();
    await expect(adminPage.getByTestId('rubric-builder')).toBeVisible();
    await adminPage.getByTestId('rubric-name').fill(`[TEST_EVO] invalid weights ${randomUUID()}`);

    await adminPage.getByTestId(`dim-toggle-${critNames[0]}`).check();
    await adminPage.getByTestId(`dim-toggle-${critNames[1]}`).check();
    // Even split makes it valid; now break it by under-weighting one dimension.
    await adminPage.getByTestId(`dim-weight-${critNames[0]}`).fill('30');

    await expect(adminPage.getByTestId('weight-error')).toBeVisible();
    await expect(adminPage.getByTestId('weight-sum')).toContainText('80% / 100%');
    await expect(adminPage.getByTestId('rubric-save')).toBeDisabled();

    // "Even split" restores a valid 50/50 → error clears, Save re-enables.
    await adminPage.getByRole('button', { name: 'Even split' }).click();
    await expect(adminPage.getByTestId('weight-sum')).toContainText('✓ 100%');
    await expect(adminPage.getByTestId('rubric-save')).toBeEnabled();
  });
});
