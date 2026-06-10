// E2E for the Match Viewer: list (run-id filter + test-content reset), match detail (both
// texts), and the display-only re-judge sandbox (exercised via the E2E_TEST_MODE server stub
// in rejudgeComparisonAction — the LLM call cannot be browser-mocked since it runs in a
// Server Action). (match_viewer_with_experimentation_procedures_20260605)

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

adminTest.describe('Evolution Match Viewer', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial', retries: 2 });

  let runId: string;
  let comparisonId: string;

  adminTest.beforeAll(async () => {
    // Unique prompt text — evolution_prompts has a unique constraint (uq_arena_topic_prompt),
    // and createTestPrompt()'s default text is a fixed string that collides across runs.
    const prompt = await createTestPrompt({ prompt: `[TEST_EVO] match viewer prompt ${randomUUID()}` });
    const run = await createTestRun({ promptId: prompt.id });
    runId = run.id;
    const a = await createTestVariant({ runId, promptId: prompt.id, variant_content: '[TEST_EVO] Photosynthesis text A' });
    const b = await createTestVariant({ runId, promptId: prompt.id, variant_content: '[TEST_EVO] Photosynthesis text B' });
    const cmp = await createTestArenaComparison({
      promptId: prompt.id, entryA: a.id, entryB: b.id, winner: 'a', confidence: 0.9, runId,
    });
    comparisonId = cmp.id;
  });

  adminTest.afterAll(async () => {
    await cleanupAllTrackedEvolutionData();
  });

  adminTest('lists the match (after reset filters) and filters by run id', async ({ adminPage }) => {
    const list = new EvolutionListPage(adminPage);
    await adminPage.goto('/admin/evolution/matches');
    // Seeded rows are [TEST_EVO] → hidden by the default-on filter; reset to reveal them.
    await list.resetFilters();

    const detailLink = adminPage.locator(`a[href="/admin/evolution/matches/${comparisonId}"]`);
    await expect(detailLink.first()).toBeVisible({ timeout: 15000 });

    // Filter by run id and confirm the row is still present (isolation). For a text filter,
    // EntityListPage puts the testid on the <input> itself (only checkboxes wrap a label).
    await adminPage.locator('[data-testid="filter-runId"]').fill(runId);
    await expect(detailLink.first()).toBeVisible({ timeout: 15000 });
  });

  adminTest('opens detail and runs a display-only re-judge', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/matches/${comparisonId}`);
    // Hydration proof: wait for the detail container + both texts before interacting.
    await expect(adminPage.locator('[data-testid="match-detail"]')).toBeVisible({ timeout: 30000 });
    await expect(adminPage.locator('[data-testid="match-texts"]')).toBeVisible();

    await adminPage.locator('[data-testid="rejudge-run-button"]').click();

    // E2E_TEST_MODE stub → deterministic canned verdict; assert the card + not-persisted marker.
    await expect(adminPage.locator('[data-testid="rejudge-result-card"]').first()).toBeVisible({ timeout: 15000 });
    await expect(adminPage.locator('[data-testid="rejudge-not-persisted"]')).toBeVisible();
  });

  adminTest('prefills the custom prompt with the mode-appropriate default rubric', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/matches/${comparisonId}`);
    await expect(adminPage.locator('[data-testid="match-detail"]')).toBeVisible({ timeout: 30000 });

    // Open the custom-prompt box; default rubric mode is article → article rubric is pre-filled.
    await adminPage.getByTestId('rejudge-toggle-custom').click();
    const box = adminPage.getByTestId('rejudge-custom-prompt');
    await expect(box).toHaveValue(/Compare the two text variations/, { timeout: 15000 });

    // Flipping the rubric to paragraph swaps the (unedited) box to the paragraph rubric.
    await adminPage.getByTestId('rejudge-rubric-select').selectOption('paragraph');
    await expect(box).toHaveValue(/stronger paragraph/, { timeout: 15000 });
  });
});
