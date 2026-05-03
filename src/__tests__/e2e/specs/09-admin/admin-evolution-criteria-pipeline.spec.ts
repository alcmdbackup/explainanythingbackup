// E2E smoke: criteria-driven invocation detail renders 5 tabs + emerald evaluate-and-suggest
// timeline segment. Seeds a synthetic invocation directly so this can run on every PR
// without a real LLM round-trip.
// evaluateCriteriaThenGenerateFromPreviousArticle_20260501

import { adminTest, expect } from '../../fixtures/admin-auth';
import {
  getEvolutionServiceClient,
  createTestStrategy,
  createTestPrompt,
  createTestRun,
} from '../../helpers/evolution-test-data-factory';

adminTest.describe('Criteria-driven invocation detail', { tag: ['@evolution', '@critical'] }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let invocationId = '';
  let runId = '';
  const seededCriteriaIds: string[] = [];

  adminTest.beforeAll(async () => {
    const supabase = getEvolutionServiceClient();

    const baseName = `[E2E_PIPE_${Date.now()}_${Math.floor(Math.random() * 9999)}]`;
    for (const i of [1, 2]) {
      const { data, error } = await supabase
        .from('evolution_criteria')
        .insert({ name: `${baseName}c${i}`, description: `seeded ${i}`, min_rating: 1, max_rating: 5 })
        .select('id')
        .single();
      if (error) throw error;
      seededCriteriaIds.push(data.id as string);
    }

    const prompt = await createTestPrompt();
    const strategy = await createTestStrategy();
    const run = await createTestRun({ promptId: prompt.id, strategyId: strategy.id });
    runId = run.id;

    const { data: inv, error: invErr } = await supabase
      .from('evolution_agent_invocations')
      .insert({
        run_id: run.id,
        agent_name: 'evaluate_criteria_then_generate_from_previous_article',
        iteration: 1,
        execution_order: 1,
        cost_usd: 0.01,
        duration_ms: 5000,
        success: true,
        execution_detail: {
          detailType: 'evaluate_criteria_then_generate_from_previous_article',
          tactic: 'criteria_driven',
          weakestCriteriaIds: [seededCriteriaIds[0]],
          weakestCriteriaNames: ['c1'],
          evaluateAndSuggest: {
            criteriaScored: [
              { criteriaId: seededCriteriaIds[0], criteriaName: 'c1', score: 2, minRating: 1, maxRating: 5 },
              { criteriaId: seededCriteriaIds[1], criteriaName: 'c2', score: 4, minRating: 1, maxRating: 5 },
            ],
            suggestions: [
              { criteriaName: 'c1', examplePassage: 'foo', whatNeedsAddressing: 'too vague', suggestedFix: 'add context' },
            ],
            durationMs: 1000,
            cost: 0.001,
          },
          generation: { cost: 0.005, promptLength: 1000, formatValid: true, durationMs: 1500 },
          ranking: {
            cost: 0.003, durationMs: 2500, stopReason: 'converged', totalComparisons: 3,
            finalLocalElo: 1280, finalLocalUncertainty: 50, finalLocalTop15Cutoff: 1240,
            localPoolSize: 4, localPoolVariantIds: [], initialTop15Cutoff: 1240, comparisons: [],
            variantId: '00000000-0000-4000-8000-000000000abc',
          },
          totalCost: 0.009,
          surfaced: true,
        },
      })
      .select('id')
      .single();
    if (invErr) throw invErr;
    invocationId = inv.id as string;
  });

  adminTest.afterAll(async () => {
    const supabase = getEvolutionServiceClient();
    if (invocationId) await supabase.from('evolution_agent_invocations').delete().eq('id', invocationId);
    if (runId) await supabase.from('evolution_runs').delete().eq('id', runId);
    for (const id of seededCriteriaIds) {
      await supabase.from('evolution_criteria').delete().eq('id', id);
    }
  });

  adminTest('invocation page renders 5 tabs (Eval & Suggest / Generation / Metrics / Timeline / Logs)', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}`);
    for (const tab of ['Eval & Suggest', 'Generation', 'Metrics', 'Timeline', 'Logs']) {
      await expect(adminPage.locator(`role=tab[name="${tab}"]`).first()).toBeVisible();
    }
  });

  adminTest('Timeline tab shows the emerald evaluate-and-suggest segment', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${invocationId}?tab=timeline`);
    await expect(adminPage.getByTestId('timeline-evaluate-and-suggest-bar')).toBeVisible();
    await expect(adminPage.getByTestId('timeline-generation-bar')).toBeVisible();
    await expect(adminPage.getByTestId('timeline-ranking-bar')).toBeVisible();
  });
});
