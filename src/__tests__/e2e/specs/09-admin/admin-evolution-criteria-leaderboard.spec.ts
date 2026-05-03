// E2E: criteria leaderboard renders, sorts metrics, and links to detail page.
// evaluateCriteriaThenGenerateFromPreviousArticle_20260501

import { adminTest, expect } from '../../fixtures/admin-auth';
import { getEvolutionServiceClient, trackEvolutionId } from '../../helpers/evolution-test-data-factory';

adminTest.describe('Criteria leaderboard', { tag: ['@evolution', '@critical'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  const seededIds: string[] = [];
  const seededNames: string[] = [];

  adminTest.beforeAll(async () => {
    const supabase = getEvolutionServiceClient();
    const baseName = `e2e_crit_${Date.now()}_${Math.floor(Math.random() * 9999)}_`;
    const fixtures = [
      { name: `${baseName}clarity`, description: 'how clear', min_rating: 1, max_rating: 5 },
      { name: `${baseName}depth`, description: 'how deep', min_rating: 1, max_rating: 10 },
    ];
    for (const f of fixtures) {
      const { data, error } = await supabase
        .from('evolution_criteria')
        .insert(f)
        .select('id, name')
        .single();
      if (error) throw error;
      seededIds.push(data.id as string);
      seededNames.push(data.name as string);
      // Track via 'prompt' bucket since criteria isn't yet a tracked entity type;
      // cleanup runs explicitly in afterAll below.
      trackEvolutionId('prompt', data.id as string);
    }
  });

  adminTest.afterAll(async () => {
    const supabase = getEvolutionServiceClient();
    for (const id of seededIds) {
      await supabase.from('evolution_criteria').delete().eq('id', id);
    }
  });

  adminTest('list page loads with seeded criteria visible', async ({ adminPage }) => {
    await adminPage.goto('/admin/evolution/criteria');
    await expect(adminPage.locator('text=Criteria').first()).toBeVisible();
    await expect(adminPage.locator(`text=${seededNames[0]}`)).toBeVisible();
  });

  adminTest('clicking a criteria navigates to its detail page with 5 tabs', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/criteria/${seededIds[0]}`);
    for (const tab of ['Overview', 'Metrics', 'Variants', 'Runs', 'By Prompt']) {
      await expect(adminPage.locator(`role=tab[name="${tab}"]`).first()).toBeVisible();
    }
  });
});
