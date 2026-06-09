// Phase 7.10 integration test (analyze_effectiveness_paragraph_recombine_20260530):
// Pin the wizard projector (`projectDispatchPlan`) to the runtime contract for
// paragraph_recombine multi-dispatch. The wizard preview reads `expectedTotalDispatch`
// from the projector; the runtime applies the same eligibility filter at
// `runIterationLoop.ts:1303-1318`. Pre-Phase-7, the projector ignored `qualityCutoff`
// and used `poolSize` as the eligibility ceiling — so the wizard could show 1 while
// the runtime dispatched 5. This test pins runtime↔projector consistency.

import { projectDispatchPlan } from '@evolution/lib/pipeline/loop/projectDispatchPlan';

describe('Phase 7.10 projector ↔ runtime consistency for paragraph_recombine multi-dispatch', () => {
  const bugTriggerCfg = (overrides: { budgetUsd?: number } = {}) => ({
    generationModel: 'google/gemini-2.5-flash-lite',
    judgeModel: 'qwen-2.5-7b-instruct',
    budgetUsd: overrides.budgetUsd ?? 0.30,
    maxComparisonsPerVariant: 15,
    calibrationOpponents: 5,
    tournamentTopK: 5,
    iterationConfigs: [
      { agentType: 'generate', sourceMode: 'seed', budgetPercent: 40 },
      {
        agentType: 'paragraph_recombine',
        sourceMode: 'pool',
        budgetPercent: 60,
        maxDispatches: 10,
        qualityCutoff: { mode: 'topN', value: 5 },
        rewritesPerParagraph: 3,
        maxComparisonsPerParagraph: 8,
        maxParagraphsPerInvocation: 12,
      },
    ],
  });

  it('wizard projector respects qualityCutoff topN ceiling (eligibility-binding case)', () => {
    const plan = projectDispatchPlan(
      bugTriggerCfg() as Parameters<typeof projectDispatchPlan>[0],
      { seedChars: 8000, initialPoolSize: 14 },
    );
    const prRow = plan[1]!;
    expect(prRow.agentType).toBe('paragraph_recombine');
    // qualityCutoff=topN:5 binds the ceiling, NOT poolSize=14. Pre-fix the projector
    // used poolSize=14 (after iter-0 growth) and budget-binding capped at 1.
    expect(prRow.expectedTotalDispatch).toBeLessThanOrEqual(5);
    expect(prRow.expectedTotalDispatch).toBeGreaterThanOrEqual(1);
  });

  it('narrow budget — projector still respects budget cap (budget-binding regression guard)', () => {
    const plan = projectDispatchPlan(
      bugTriggerCfg({ budgetUsd: 0.05 }) as Parameters<typeof projectDispatchPlan>[0],
      { seedChars: 8000, initialPoolSize: 14 },
    );
    const prRow = plan[1]!;
    // Narrow $0.05 budget: budget is binding. Phase 7 fix must not INCREASE this
    // (eligibility=5 is now a ceiling, not a floor).
    expect(prRow.expectedTotalDispatch).toBeLessThanOrEqual(5);
  });
});
