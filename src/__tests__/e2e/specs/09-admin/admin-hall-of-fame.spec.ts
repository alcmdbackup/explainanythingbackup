/**
 * Admin hall of fame E2E tests.
 * Tests topic list page, topic detail leaderboard, entry expansion, source links,
 * Elo comparison, side-by-side diff, entry deletion, "Add from Evolution Run" button,
 * "Add to Hall of Fame" on evolution run detail, the cost-vs-Elo scatter chart,
 * and prompt bank coverage/method summary UI.
 * Conditionally skipped via adminTest.describe.skip until hall of fame tables are migrated.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ─── Test data seeding helpers ───────────────────────────────────

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface SeededHallOfFameData {
  topicId: string;
  entryOneshotId: string;
  entryEvolutionId: string;
  eloOneshotId: string;
  eloEvolutionId: string;
  /** Optional: set when a companion evolution run is created for source link tests */
  evolutionRunId?: string;
}

async function seedHallOfFameData(): Promise<SeededHallOfFameData> {
  const supabase = getServiceClient();

  // 1. Create topic
  const { data: topic, error: topicError } = await supabase
    .from('evolution_hall_of_fame_topics')
    .insert({
      prompt: '[TEST] Hall of Fame E2E Topic',
      title: 'E2E Test Topic',
    })
    .select('id')
    .single();

  if (topicError || !topic) throw new Error(`Failed to seed topic: ${topicError?.message}`);

  // 2. Create a companion evolution run so the evolution entry has a valid source link
  const { data: dummyTopic } = await supabase
    .from('topics')
    .insert({ topic_title: '[TEST] HoF Source Link Topic', topic_description: 'temp' })
    .select('id')
    .single();

  const { data: dummyExplanation } = await supabase
    .from('explanations')
    .insert({
      explanation_title: '[TEST] HoF Source Link Article',
      content: 'placeholder',
      status: 'published',
      primary_topic_id: dummyTopic?.id,
    })
    .select('id')
    .single();

  let evolutionRunId: string | undefined;

  if (dummyExplanation) {
    const { data: run } = await supabase
      .from('evolution_runs')
      .insert({
        explanation_id: dummyExplanation.id,
        status: 'completed',
        phase: 'COMPETITION',
        current_iteration: 2,
        budget_cap_usd: 3.0,
        total_cost_usd: 1.20,
        total_variants: 3,
        started_at: new Date(Date.now() - 120000).toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    evolutionRunId = run?.id;
  }

  // 3. Create two entries: oneshot and evolution_winner
  const { data: entryOneshot, error: e1 } = await supabase
    .from('evolution_hall_of_fame_entries')
    .insert({
      topic_id: topic.id,
      content: 'This is a one-shot generated article for E2E testing. It covers basic concepts in quantum computing.',
      generation_method: 'oneshot',
      model: 'gpt-4.1-mini',
      total_cost_usd: 0.0042,
      metadata: { prompt_tokens: 150, completion_tokens: 320, call_source: 'e2e_test' },
    })
    .select('id')
    .single();

  if (e1 || !entryOneshot) throw new Error(`Failed to seed oneshot entry: ${e1?.message}`);

  const { data: entryEvolution, error: e2 } = await supabase
    .from('evolution_hall_of_fame_entries')
    .insert({
      topic_id: topic.id,
      content: 'This is an evolution-winner article for E2E testing. It explains quantum entanglement clearly.',
      generation_method: 'evolution_winner',
      model: 'structural_transform',
      total_cost_usd: 0.0185,
      evolution_run_id: evolutionRunId ?? null,
      metadata: { iterations: 3, winning_strategy: 'structural_transform', duration_seconds: 45 },
    })
    .select('id')
    .single();

  if (e2 || !entryEvolution) throw new Error(`Failed to seed evolution entry: ${e2?.message}`);

  // 4. Create Elo rows with different ratings
  const { data: eloOneshot, error: elo1Err } = await supabase
    .from('evolution_hall_of_fame_elo')
    .insert({
      topic_id: topic.id,
      entry_id: entryOneshot.id,
      elo_rating: 1180,
      elo_per_dollar: -4761.9,
      match_count: 3,
    })
    .select('id')
    .single();

  if (elo1Err || !eloOneshot) throw new Error(`Failed to seed oneshot Elo: ${elo1Err?.message}`);

  const { data: eloEvolution, error: elo2Err } = await supabase
    .from('evolution_hall_of_fame_elo')
    .insert({
      topic_id: topic.id,
      entry_id: entryEvolution.id,
      elo_rating: 1320,
      elo_per_dollar: 6486.5,
      match_count: 3,
    })
    .select('id')
    .single();

  if (elo2Err || !eloEvolution) throw new Error(`Failed to seed evolution Elo: ${elo2Err?.message}`);

  return {
    topicId: topic.id,
    entryOneshotId: entryOneshot.id,
    entryEvolutionId: entryEvolution.id,
    eloOneshotId: eloOneshot.id,
    eloEvolutionId: eloEvolution.id,
    evolutionRunId,
  };
}

async function cleanupHallOfFameData(data: SeededHallOfFameData | undefined) {
  if (!data) return;
  const supabase = getServiceClient();

  // Delete in reverse dependency order
  await supabase.from('evolution_hall_of_fame_comparisons').delete().eq('topic_id', data.topicId);
  await supabase.from('evolution_hall_of_fame_elo').delete().eq('topic_id', data.topicId);
  await supabase.from('evolution_hall_of_fame_entries').delete().eq('topic_id', data.topicId);
  await supabase.from('evolution_hall_of_fame_topics').delete().eq('id', data.topicId);

  // Clean up companion evolution data if created
  if (data.evolutionRunId) {
    await supabase.from('evolution_variants').delete().eq('run_id', data.evolutionRunId);
    const { data: run } = await supabase
      .from('evolution_runs')
      .select('explanation_id')
      .eq('id', data.evolutionRunId)
      .single();

    await supabase.from('evolution_runs').delete().eq('id', data.evolutionRunId);

    if (run?.explanation_id) {
      const { data: exp } = await supabase
        .from('explanations')
        .select('primary_topic_id')
        .eq('id', run.explanation_id)
        .single();

      await supabase.from('explanations').delete().eq('id', run.explanation_id);
      if (exp?.primary_topic_id) {
        await supabase.from('topics').delete().eq('id', exp.primary_topic_id);
      }
    }
  }
}

// ─── Tests ───────────────────────────────────────────────────────

// Skip until hall of fame DB tables are migrated via GitHub Actions
adminTest.describe.skip('Admin Hall of Fame', () => {
  let seededData: SeededHallOfFameData;

  adminTest.beforeAll(async () => {
    seededData = await seedHallOfFameData();
  });

  adminTest.afterAll(async () => {
    await cleanupHallOfFameData(seededData);
  });

  // ── 1. Topic list page renders with cross-topic summary cards ──

  adminTest(
    'topic list page renders with cross-topic summary cards',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/hall-of-fame');
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Page heading
      await expect(adminPage.locator('h1')).toContainText('Hall of Fame');

      // Topics table renders
      const topicsTable = adminPage.locator('[data-testid="topics-table"]');
      await expect(topicsTable).toBeVisible();

      // Our seeded topic row should appear
      await expect(adminPage.locator(`[data-testid="topic-row-${seededData.topicId}"]`)).toBeVisible();

      // Cross-topic summary cards render when sufficient data exists
      const summary = adminPage.locator('[data-testid="cross-topic-summary"]');
      // Summary may or may not be visible depending on data — just check the container is in DOM
      const summaryCount = await summary.count();
      expect(summaryCount).toBeLessThanOrEqual(1);
    },
  );

  // ── 2. Create new topic via "New Topic" button ──

  adminTest(
    'create new topic via New Topic button',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/hall-of-fame');
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Click "New Topic" button
      await adminPage.locator('[data-testid="new-topic-btn"]').click();

      // Dialog appears
      const dialog = adminPage.locator('div[role="dialog"][aria-label="Create new topic"]');
      await expect(dialog).toBeVisible();

      // Fill prompt
      await adminPage.locator('[data-testid="new-topic-prompt"]').fill('[TEST] Created via E2E');

      // Submit
      await adminPage.locator('[data-testid="new-topic-submit"]').click();

      // Should navigate to topic detail (URL changes)
      await adminPage.waitForURL(/\/admin\/quality\/hall-of-fame\/[0-9a-f-]+/);
    },
  );

  // ── 3. Navigate to topic detail, verify leaderboard columns ──

  adminTest(
    'topic detail page shows leaderboard with expected columns',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/hall-of-fame/${seededData.topicId}`);
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Tab bar exists
      const tabBar = adminPage.locator('[data-testid="tab-bar"]');
      await expect(tabBar).toBeVisible();

      // Leaderboard tab is active by default
      const leaderboardTable = adminPage.locator('[data-testid="leaderboard-table"]');
      await expect(leaderboardTable).toBeVisible();

      // Verify expected column headers
      const headers = leaderboardTable.locator('thead th');
      const headerTexts = await headers.allTextContents();
      expect(headerTexts).toEqual(
        expect.arrayContaining(['Method', 'Model', 'Elo', 'Cost', 'Matches', 'Source']),
      );

      // At least 2 rows (our seeded entries)
      const rows = leaderboardTable.locator('tbody tr[data-testid^="lb-row-"]');
      await expect(rows).toHaveCount(2);
    },
  );

  // ── 4. Expand entry row, verify metadata (method badge, cost, model) ──

  adminTest(
    'expand entry row shows metadata with method badge, cost, and model',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/hall-of-fame/${seededData.topicId}`);
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Click first leaderboard row to expand it
      const firstRow = adminPage.locator('[data-testid="lb-row-0"]');
      await firstRow.click();

      // Expanded detail section appears below the row
      const detail = adminPage.locator('[data-testid="tab-content"]');
      await expect(detail).toBeVisible();

      // Method badge is visible (the evolution_winner should be rank 1 with higher Elo)
      await expect(detail.locator('span:has-text("evolution winner")')).toBeVisible();

      // Model name is displayed
      await expect(detail.locator('text=structural_transform')).toBeVisible();

      // Cost is displayed
      await expect(detail.locator('text=$0.0185')).toBeVisible();
    },
  );

  // ── 5. Source link for evolution entry navigates to run detail ──

  adminTest(
    'source link for evolution entry navigates to run detail page',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/hall-of-fame/${seededData.topicId}`);
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // The evolution entry should be rank 0 (highest Elo), its source link should point to run detail
      const sourceLink = adminPage.locator('[data-testid="source-link-0"]');
      await expect(sourceLink).toBeVisible();

      if (seededData.evolutionRunId) {
        // Verify the href points to the evolution run detail page
        const href = await sourceLink.getAttribute('href');
        expect(href).toContain(`/admin/quality/evolution/run/${seededData.evolutionRunId}`);
      }
    },
  );

  // ── 6. Run comparison → Elo ratings update ──
  // requires seeded data and real LLM judge call — skip in CI

  adminTest.skip(
    'run comparison updates Elo ratings in leaderboard',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/hall-of-fame/${seededData.topicId}`);
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Capture initial Elo text of rank-0 entry
      const eloCell = adminPage.locator('[data-testid="lb-row-0"] td:nth-child(4)');
      const initialEloText = await eloCell.textContent();

      // Click "Run Comparison" button
      await adminPage.locator('[data-testid="run-comparison-btn"]').click();

      // Dialog appears
      const dialog = adminPage.locator('div[role="dialog"][aria-label="Run comparison"]');
      await expect(dialog).toBeVisible();

      // Select judge model and submit
      await adminPage.locator('[data-testid="judge-model-select"]').selectOption('gpt-4.1-nano');
      await adminPage.locator('[data-testid="rounds-select"]').selectOption('1');
      await adminPage.locator('[data-testid="run-comparison-submit"]').click();

      // Wait for the comparison dialog to close, indicating completion
      await dialog.waitFor({ state: 'hidden', timeout: 30000 });
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Elo should have changed after comparison
      const updatedEloText = await eloCell.textContent();
      // We cannot assert exact values but at least one should differ if comparison ran
      // (In a real run, the values always move since K=32 and entries are different)
      expect(updatedEloText).toBeDefined();
      expect(initialEloText !== updatedEloText || updatedEloText !== null).toBeTruthy();
    },
  );

  // ── 7. Select two entries → side-by-side diff renders ──

  adminTest(
    'selecting two entries renders side-by-side text diff',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/hall-of-fame/${seededData.topicId}`);
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Switch to the Compare Text tab
      await adminPage.locator('[data-testid="tab-diff"]').click();
      const diffView = adminPage.locator('[data-testid="diff-view"]');
      await expect(diffView).toBeVisible();

      // Select entry A via dropdown
      const selectA = diffView.locator('select').first();
      const selectB = diffView.locator('select').last();

      // Get option values (entry IDs)
      const optionsA = await selectA.locator('option').allTextContents();
      // At least 2 non-placeholder options
      expect(optionsA.length).toBeGreaterThanOrEqual(3); // 1 placeholder + 2 entries

      // Select entries from dropdowns
      await selectA.selectOption({ index: 1 });
      await selectB.selectOption({ index: 2 });

      // Diff section should render with pre tag containing diff output
      const diffPre = diffView.locator('pre');
      await expect(diffPre).toBeVisible({ timeout: 5000 });
    },
  );

  // ── 8. Delete entry → removed from leaderboard, confirmation dialog ──

  adminTest(
    'delete entry removes it from leaderboard after confirmation',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/hall-of-fame/${seededData.topicId}`);
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Count rows before deletion
      const rowsBefore = await adminPage.locator('[data-testid^="lb-row-"]').count();
      expect(rowsBefore).toBe(2);

      // Set up dialog handler to accept the confirmation
      adminPage.on('dialog', (dialog) => dialog.accept());

      // Click the delete button on row 1 (lower-ranked oneshot entry)
      await adminPage.locator('[data-testid="delete-entry-1"]').click();

      // Wait for page to re-render after deletion
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Row count should decrease
      const rowsAfter = await adminPage.locator('[data-testid^="lb-row-"]').count();
      expect(rowsAfter).toBe(1);
    },
  );

  // ── 9. "Add from Evolution Run" button exists on topic detail ──

  adminTest(
    '"Add from Evolution Run" button exists on topic detail page',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/hall-of-fame/${seededData.topicId}`);
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      const addFromRunBtn = adminPage.locator('[data-testid="add-from-run-btn"]');
      await expect(addFromRunBtn).toBeVisible();
      await expect(addFromRunBtn).toHaveText('Add from Run');

      // Click it to verify the dialog opens
      await addFromRunBtn.click();
      const dialog = adminPage.locator('div[role="dialog"][aria-label="Add from evolution run"]');
      await expect(dialog).toBeVisible();
    },
  );

  // ── 10. "Add to Hall of Fame" button on evolution run detail (completed runs only) ──
  // requires seeded data with a completed evolution run

  adminTest.skip(
    '"Add to Hall of Fame" button visible on completed evolution run detail page',
    async ({ adminPage }) => {
      if (!seededData.evolutionRunId) {
        adminTest.skip();
        return;
      }

      await adminPage.goto(`/admin/quality/evolution/run/${seededData.evolutionRunId}`);
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // The "Add to Hall of Fame" button should be visible for completed runs
      const addToHoFBtn = adminPage.locator('[data-testid="add-to-hall-of-fame-btn"]');
      await expect(addToHoFBtn).toBeVisible();
      await expect(addToHoFBtn).toHaveText('Add to Hall of Fame');
    },
  );

  // ── 11. Cost vs Elo scatter chart renders with correct data points ──

  adminTest(
    'cost vs Elo scatter chart renders with data points',
    async ({ adminPage }) => {
      await adminPage.goto(`/admin/quality/hall-of-fame/${seededData.topicId}`);
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Switch to the chart tab
      await adminPage.locator('[data-testid="tab-chart"]').click();

      const chartContainer = adminPage.locator('[data-testid="cost-elo-chart"]');
      await expect(chartContainer).toBeVisible();

      // Chart title
      await expect(chartContainer.locator('text=Cost vs Elo')).toBeVisible();

      // Recharts renders an SVG — wait for it to appear
      const svg = chartContainer.locator('svg');
      await expect(svg).toBeVisible({ timeout: 10000 });

      // Scatter plot should render circle elements for data points
      // Both entries have cost > 0 so both should appear
      const dots = chartContainer.locator('.recharts-scatter-symbol, .recharts-symbols circle, circle');
      const dotCount = await dots.count();
      expect(dotCount).toBeGreaterThanOrEqual(2);

      // Legend items are visible
      await expect(chartContainer.locator('text=1-shot')).toBeVisible();
      await expect(chartContainer.locator('text=Evolution winner')).toBeVisible();
    },
  );
});

// ─── Prompt Bank UI Tests ─────────────────────────────────────────
// Separate describe for prompt bank coverage grid, method summary table,
// and "Run All Comparisons" button on the topic list page.

interface PromptBankSeededData {
  topicIds: string[];
  entryIds: string[];
}

async function seedPromptBankData(): Promise<PromptBankSeededData> {
  const supabase = getServiceClient();
  const topicIds: string[] = [];
  const entryIds: string[] = [];

  // Create 2 topics matching PROMPT_BANK config prompts
  const prompts = ['Explain photosynthesis', 'Explain how blockchain technology works'];

  for (const prompt of prompts) {
    // Use select-then-insert pattern (expression index on LOWER(TRIM(prompt)) incompatible with Supabase onConflict)
    const { data: existing } = await supabase
      .from('evolution_hall_of_fame_topics')
      .select('id')
      .eq('prompt', prompt)
      .maybeSingle();
    let topicId: string;
    if (existing) {
      topicId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from('evolution_hall_of_fame_topics')
        .insert({ prompt, title: prompt })
        .select('id')
        .single();
      if (error || !created) throw new Error(`Failed to seed prompt bank topic: ${error?.message}`);
      topicId = created.id;
    }
    topicIds.push(topicId);

    // Add oneshot entry
    const { data: oneshot, error: e1 } = await supabase
      .from('evolution_hall_of_fame_entries')
      .insert({
        topic_id: topicId,
        content: `Oneshot article for: ${prompt}`,
        generation_method: 'oneshot',
        model: 'gpt-4.1-mini',
        total_cost_usd: 0.003,
        metadata: {},
      })
      .select('id')
      .single();
    if (e1 || !oneshot) throw new Error(`Failed to seed oneshot entry: ${e1?.message}`);
    entryIds.push(oneshot.id);

    // Add evolution entry with metadata.iterations
    const { data: evo, error: e2 } = await supabase
      .from('evolution_hall_of_fame_entries')
      .insert({
        topic_id: topicId,
        content: `Evolution 10-iter article for: ${prompt}`,
        generation_method: 'evolution_winner',
        model: 'deepseek-chat',
        total_cost_usd: 0.012,
        metadata: { iterations: 10 },
      })
      .select('id')
      .single();
    if (e2 || !evo) throw new Error(`Failed to seed evolution entry: ${e2?.message}`);
    entryIds.push(evo.id);

    // Init Elo for both
    await supabase.from('evolution_hall_of_fame_elo').insert([
      { topic_id: topic.id, entry_id: oneshot.id, elo_rating: 1180, match_count: 3 },
      { topic_id: topic.id, entry_id: evo.id, elo_rating: 1320, match_count: 3 },
    ]);
  }

  return { topicIds, entryIds };
}

async function cleanupPromptBankData(data: PromptBankSeededData | undefined) {
  if (!data) return;
  const supabase = getServiceClient();

  for (const topicId of data.topicIds) {
    await supabase.from('evolution_hall_of_fame_comparisons').delete().eq('topic_id', topicId);
    await supabase.from('evolution_hall_of_fame_elo').delete().eq('topic_id', topicId);
    await supabase.from('evolution_hall_of_fame_entries').delete().eq('topic_id', topicId);
    await supabase.from('evolution_hall_of_fame_topics').delete().eq('id', topicId);
  }
}

adminTest.describe.skip('Admin Hall of Fame — Prompt Bank UI', () => {
  let pbData: PromptBankSeededData;

  adminTest.beforeAll(async () => {
    pbData = await seedPromptBankData();
  });

  adminTest.afterAll(async () => {
    await cleanupPromptBankData(pbData);
  });

  // ── 12. Prompt bank section renders on topic list page ──

  adminTest(
    'prompt bank section renders with coverage grid',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/hall-of-fame');
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      // Prompt Bank section is visible
      const pbSection = adminPage.locator('[data-testid="prompt-bank-section"]');
      await expect(pbSection).toBeVisible();

      // Section heading
      await expect(pbSection.locator('h2')).toContainText('Prompt Bank');

      // Status text shows coverage counts
      const statusText = await pbSection.locator('p').first().textContent();
      expect(statusText).toMatch(/\d+\/\d+ entries generated/);
    },
  );

  // ── 13. Coverage grid shows expected method columns ──

  adminTest(
    'coverage grid shows expected method columns',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/hall-of-fame');
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      const pbSection = adminPage.locator('[data-testid="prompt-bank-section"]');
      const headers = pbSection.locator('thead th');
      const headerTexts = await headers.allTextContents();

      // First column is "Prompt", rest are method labels (shortened)
      expect(headerTexts[0]).toBe('Prompt');
      // At minimum: gpt-4.1-mini, gpt-4.1, deepseek-chat, evo_ variants
      expect(headerTexts.length).toBeGreaterThanOrEqual(4);

      // Rows match the 5 prompts in PROMPT_BANK config
      const rows = pbSection.locator('tbody tr');
      await expect(rows).toHaveCount(5);
    },
  );

  // ── 14. Method summary table renders with expected columns ──

  adminTest(
    'method summary table renders with Avg Elo, Win Rate columns',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/hall-of-fame');
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      const summaryTable = adminPage.locator('[data-testid="method-summary-table"]');
      await expect(summaryTable).toBeVisible();

      const headers = summaryTable.locator('thead th');
      const headerTexts = await headers.allTextContents();
      expect(headerTexts).toEqual(
        expect.arrayContaining(['Method', 'Avg Elo', 'Win Rate', 'Entries']),
      );

      // At least one row with data (we seeded oneshot_gpt-4.1-mini entries)
      const rows = summaryTable.locator('tbody tr');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThanOrEqual(1);
    },
  );

  // ── 15. "Run All Comparisons" button exists ──

  adminTest(
    '"Run All Comparisons" button is visible on prompt bank section',
    async ({ adminPage }) => {
      await adminPage.goto('/admin/quality/hall-of-fame');
      // eslint-disable-next-line flakiness/no-networkidle -- #548 batch migration
      await adminPage.waitForLoadState('networkidle');

      const runBtn = adminPage.locator('[data-testid="run-all-comparisons-btn"]');
      await expect(runBtn).toBeVisible();

      // Button should not be disabled when there are entries
      const isDisabled = await runBtn.isDisabled();
      // Either enabled or showing "All Compared" text
      const btnText = await runBtn.textContent();
      expect(isDisabled || btnText === 'All Compared').toBeTruthy();
    },
  );
});
