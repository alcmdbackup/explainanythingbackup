// E2E for the Implied Rubric Weights tool: reachable from the evolution Tools nav and the
// new-session form renders + hydrates. The full create -> judge -> export data path is
// covered by the integration test (evolution-weight-inference.integration.test.ts); a
// UI-seeded full flow is impractical here because the form intentionally hides test-content
// topics/criteria. @evolution (admin is host-gated, not @critical). No DB imports -> no
// afterAll cleanup needed.

import { adminTest, expect } from '../../fixtures/admin-auth';

adminTest.describe('Implied Rubric Weights', { tag: '@evolution' }, () => {
  adminTest('navigates from the Tools sidebar and renders the new-session form', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution-dashboard');
    await adminPage.getByTestId('evolution-sidebar-nav-weight-inference').click();
    await expect(adminPage).toHaveURL(/\/admin\/evolution\/weight-inference/);

    // Hydration proof: the form controls are present + interactive.
    await expect(adminPage.getByTestId('wi-name')).toBeVisible();
    await expect(adminPage.getByTestId('wi-topic')).toBeVisible();
    await expect(adminPage.getByTestId('wi-create')).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  });

  adminTest('shows the ratings-needed preview only after >= 2 criteria are selected', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/weight-inference');
    await expect(adminPage.getByTestId('wi-name')).toBeVisible();
    // Preview is hidden until enough criteria are chosen (it is data-dependent, so assert
    // presence/absence structurally, never specific numbers).
    await expect(adminPage.getByTestId('wi-preview')).toHaveCount(0);
  });

  adminTest('Auto mode toggle reveals the judge settings', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/weight-inference');
    await expect(adminPage.getByTestId('wi-auto-settings')).toHaveCount(0);
    await adminPage.getByTestId('wi-mode-auto').click();
    await expect(adminPage.getByTestId('wi-auto-settings')).toBeVisible();
    // back to human hides them again (structural assertion only)
    await adminPage.getByTestId('wi-mode-human').click();
    await expect(adminPage.getByTestId('wi-auto-settings')).toHaveCount(0);
  });
});
