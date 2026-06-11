// E2E for rubric-judged matches in the Match Viewer: the detail page renders the full
// two-pass per-dimension breakdown (weights + forward/reverse verdicts + overall winner),
// and a holistic match (null breakdown) renders with NO breakdown section. The list also
// flags rubric matches with a "yes" indicator. (structured_judging_evolution_20260610)

import { randomUUID } from 'crypto';
import { adminTest, expect } from '../../fixtures/admin-auth';
import { EvolutionListPage } from '../../helpers/pages/admin/EvolutionListPage';
import {
  createTestPrompt,
  createTestRun,
  createTestVariant,
  createTestArenaComparison,
  cleanupAllTrackedEvolutionData,
} from '../../helpers/evolution-test-data-factory';

adminTest.describe('Evolution Match Viewer — rubric breakdown', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial', retries: 2 });

  let runId: string;
  let rubricComparisonId: string;
  let holisticComparisonId: string;

  adminTest.beforeAll(async () => {
    const prompt = await createTestPrompt({ prompt: `[TEST_EVO] rubric breakdown prompt ${randomUUID()}` });
    const run = await createTestRun({ promptId: prompt.id });
    runId = run.id;
    const a = await createTestVariant({ runId, promptId: prompt.id, variant_content: '[TEST_EVO] Rubric text A' });
    const b = await createTestVariant({ runId, promptId: prompt.id, variant_content: '[TEST_EVO] Rubric text B' });

    // The detail breakdown + the list "rubric" indicator both render from the rubric_breakdown
    // JSONB snapshot alone (has_rubric = judge_rubric_id != null OR rubric_breakdown != null),
    // so a synthetic snapshot exercises the full rendering contract without a real rubric FK.
    const rubricCmp = await createTestArenaComparison({
      promptId: prompt.id, entryA: a.id, entryB: b.id, winner: 'a', confidence: 1, runId,
      rubricBreakdown: {
        rubricId: randomUUID(),
        dimensions: [
          { criteriaId: 'c-1', name: 'conciseness', weight: 0.3, forwardVerdict: 'A', reverseVerdict: 'A' },
          { criteriaId: 'c-2', name: 'structure', weight: 0.4, forwardVerdict: 'A', reverseVerdict: 'A' },
          { criteriaId: 'c-3', name: 'style', weight: 0.3, forwardVerdict: 'B', reverseVerdict: 'B' },
        ],
        forwardPass: { scoreA: 0.7, scoreB: 0.3, winner: 'A' },
        reversePass: { scoreA: 0.7, scoreB: 0.3, winner: 'A' },
        overall: { winner: 'A', confidence: 1 },
      },
    });
    rubricComparisonId = rubricCmp.id;

    const holisticCmp = await createTestArenaComparison({
      promptId: prompt.id, entryA: a.id, entryB: b.id, winner: 'b', confidence: 0.7, runId,
    });
    holisticComparisonId = holisticCmp.id;
  });

  adminTest.afterAll(async () => {
    await cleanupAllTrackedEvolutionData();
  });

  adminTest('detail renders the full two-pass per-dimension breakdown', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/matches/${rubricComparisonId}`);
    await expect(adminPage.locator('[data-testid="match-detail"]')).toBeVisible({ timeout: 30000 });

    const breakdown = adminPage.locator('[data-testid="rubric-breakdown"]');
    await expect(breakdown).toBeVisible();
    await expect(breakdown).toContainText('WINNER A');
    // One row per dimension (conciseness / structure / style).
    await expect(adminPage.locator('[data-testid="rubric-dim-row"]')).toHaveCount(3);
    await expect(breakdown).toContainText('conciseness');
    await expect(breakdown).toContainText('structure');
    await expect(breakdown).toContainText('style');
  });

  adminTest('a holistic match (null breakdown) renders with no breakdown section', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/matches/${holisticComparisonId}`);
    await expect(adminPage.locator('[data-testid="match-detail"]')).toBeVisible({ timeout: 30000 });
    await expect(adminPage.locator('[data-testid="rubric-breakdown"]')).toHaveCount(0);
  });

  adminTest('the match list flags the rubric-judged match with a "yes" indicator', async ({ adminPage }) => {
    const list = new EvolutionListPage(adminPage);
    await adminPage.goto('/admin/evolution/matches');
    await list.resetFilters();
    // Isolate to our run so the rubric row is the only one in view.
    await adminPage.locator('[data-testid="filter-runId"]').fill(runId);

    const rubricRowLink = adminPage.locator(`a[href="/admin/evolution/matches/${rubricComparisonId}"]`);
    await expect(rubricRowLink.first()).toBeVisible({ timeout: 15000 });
    // The rubric indicator column shows "yes" for this match.
    await expect(adminPage.getByText('yes', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  });
});
