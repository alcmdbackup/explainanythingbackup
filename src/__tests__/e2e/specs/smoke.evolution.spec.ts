// Evolution-host smoke tests (ea-evolution.vercel.app) — runs post-deploy via post-deploy-smoke.yml @smoke-evolution matrix row.
// Verifies the evolution admin dashboard loads and the health endpoint is healthy. Uses admin-auth fixture because the entire /admin/evolution/* tree is admin-gated.

import { adminTest, expect } from '../fixtures/admin-auth';

adminTest.describe('Evolution Smoke Tests', () => {
  adminTest(
    'admin evolution dashboard loads',
    { tag: ['@smoke', '@smoke-evolution'] },
    async ({ adminPage }) => {
      await adminPage.goto('/admin/evolution-dashboard');

      // dashboard-content testid is the post-hydration root of the dashboard page (page.tsx:104).
      // Asserting on it proves auth + middleware + page-render all succeeded — broader than a header-text check.
      await expect(adminPage.locator('[data-testid="dashboard-content"]')).toBeVisible({
        timeout: 30000,
      });
    },
  );

  adminTest(
    'health check endpoint returns healthy',
    { tag: ['@smoke', '@smoke-evolution'] },
    async ({ adminPage }) => {
      const response = await adminPage.request.get('/api/health');

      expect(response.status()).toBe(200);

      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.checks.database.status).toBe('pass');
      expect(data.checks.requiredTags.status).toBe('pass');
      expect(data.checks.environment.status).toBe('pass');
    },
  );
});
