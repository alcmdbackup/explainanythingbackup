// Integration test for getStrategyDispatchPreviewAction — verifies the wizard preview
// server action threads env flags through to projectDispatchPlan correctly and returns
// the top-up-aware projection fields end-to-end through the client mirror serialization.
//
// investigate_issues_latest_evolution_reflection_agent_20260501

// Supabase mock: routes per table.
//  - evolution_variants: arenaCount query (chain ends in .is() with thenable result)
//  - evolution_prompts: prompt name query (chain ends in .maybeSingle() with thenable result)
function makeSupabase() {
  const variantsBuilder = {
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockResolvedValue({ count: 50, data: null, error: null }),
  };
  const promptsBuilder = {
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: { name: 'Test Prompt' }, error: null }),
  };
  return {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'evolution_variants') {
        return { select: jest.fn().mockReturnValue(variantsBuilder) };
      }
      if (table === 'evolution_prompts') {
        return { select: jest.fn().mockReturnValue(promptsBuilder) };
      }
      throw new Error(`unmocked table: ${table}`);
    }),
  };
}

const fakeAdminCtx = {
  supabase: makeSupabase(),
  adminUserId: 'test-admin',
};

jest.mock('@evolution/services/adminAction', () => ({
  adminAction: (_name: string, handler: (input: unknown, ctx: typeof fakeAdminCtx) => Promise<unknown>) =>
    (input: unknown) => handler(input, fakeAdminCtx),
}));

import { getStrategyDispatchPreviewAction } from '@evolution/services/strategyPreviewActions';
import type { DispatchPreviewResult } from '@evolution/services/strategyPreviewActions';

// Mocked adminAction returns the handler result directly (not wrapped in ActionResult).
const callPreview = (input: Parameters<typeof getStrategyDispatchPreviewAction>[0]) =>
  (getStrategyDispatchPreviewAction as unknown as (
    input: Parameters<typeof getStrategyDispatchPreviewAction>[0],
  ) => Promise<DispatchPreviewResult>)(input);

// Reproduces strategy d75c9dfc-f9d3-4d32-9bb2-964fa9a96977 — the user-reported strategy.
function d75c9dfcConfig() {
  return {
    generationModel: 'google/gemini-2.5-flash-lite',
    judgeModel: 'qwen-2.5-7b-instruct',
    budgetUsd: 0.05,
    maxComparisonsPerVariant: 5,
    minBudgetAfterParallelAgentMultiple: 2,
    iterationConfigs: [
      { agentType: 'generate' as const, sourceMode: 'seed' as const, budgetPercent: 25 },
      { agentType: 'reflect_and_generate' as const, sourceMode: 'pool' as const, budgetPercent: 25,
        qualityCutoff: { mode: 'topN' as const, value: 5 }, reflectionTopN: 3 },
      { agentType: 'reflect_and_generate' as const, sourceMode: 'pool' as const, budgetPercent: 25,
        qualityCutoff: { mode: 'topN' as const, value: 5 }, reflectionTopN: 3 },
      { agentType: 'reflect_and_generate' as const, sourceMode: 'pool' as const, budgetPercent: 25,
        qualityCutoff: { mode: 'topN' as const, value: 5 }, reflectionTopN: 3 },
    ],
  };
}

describe('getStrategyDispatchPreviewAction (integration)', () => {
  // Snapshot env so test mutations don't leak.
  const originalTopUp = process.env.EVOLUTION_TOPUP_ENABLED;
  const originalReflection = process.env.EVOLUTION_REFLECTION_ENABLED;

  afterEach(() => {
    if (originalTopUp === undefined) delete process.env.EVOLUTION_TOPUP_ENABLED;
    else process.env.EVOLUTION_TOPUP_ENABLED = originalTopUp;
    if (originalReflection === undefined) delete process.env.EVOLUTION_REFLECTION_ENABLED;
    else process.env.EVOLUTION_REFLECTION_ENABLED = originalReflection;
  });

  it('returns plan entries with new top-up projection fields populated', async () => {
    delete process.env.EVOLUTION_TOPUP_ENABLED;
    delete process.env.EVOLUTION_REFLECTION_ENABLED;

    const result = await callPreview({
      config: d75c9dfcConfig(),
      // Pass a promptId so the mock returns arenaCount=50 (matches real-world arena-loaded scenario).
      promptId: '00000000-0000-0000-0000-000000000001',
    });
    const plan = result.plan;
    expect(plan).toHaveLength(4);

    for (const entry of plan) {
      expect(entry).toHaveProperty('expectedTotalDispatch');
      expect(entry).toHaveProperty('expectedTopUpDispatch');
      expect(entry.expectedTotalDispatch).toBeGreaterThanOrEqual(entry.dispatchCount);
      expect(entry.expectedTopUpDispatch).toBe(entry.expectedTotalDispatch - entry.dispatchCount);
    }

    // Iter 0 (generate) — d75c9dfc reproduction with arena pool size 50; without the fix
    // this was 2, now should project meaningfully more agents thanks to top-up sim. Band
    // allows for heuristic recalibration.
    expect(plan[0]!.expectedTotalDispatch).toBeGreaterThanOrEqual(3);
    expect(plan[0]!.expectedTotalDispatch).toBeLessThanOrEqual(8);
  });

  it('EVOLUTION_TOPUP_ENABLED=false collapses expectedTotalDispatch to dispatchCount', async () => {
    process.env.EVOLUTION_TOPUP_ENABLED = 'false';
    delete process.env.EVOLUTION_REFLECTION_ENABLED;

    const result = await callPreview({ config: d75c9dfcConfig() });
    const plan = result.plan;

    for (const entry of plan) {
      expect(entry.expectedTotalDispatch).toBe(entry.dispatchCount);
      expect(entry.expectedTopUpDispatch).toBe(0);
    }
  });

  it('EVOLUTION_REFLECTION_ENABLED=false zeroes reflection cost on reflect_and_generate iters', async () => {
    process.env.EVOLUTION_REFLECTION_ENABLED = 'false';
    delete process.env.EVOLUTION_TOPUP_ENABLED;

    const result = await callPreview({ config: d75c9dfcConfig() });
    const plan = result.plan;

    // Iter 1-3 are reflect_and_generate. With kill-switch off, reflection cost = 0 (matches
    // runtime fallback to vanilla GFPA).
    expect(plan[1]!.estPerAgent.upperBound.reflection).toBe(0);
    expect(plan[1]!.estPerAgent.expected.reflection).toBe(0);
    expect(plan[2]!.estPerAgent.upperBound.reflection).toBe(0);
    expect(plan[3]!.estPerAgent.upperBound.reflection).toBe(0);
  });

  it('client mirror estPerAgent shape includes reflection + editing (regression — both fields were missing pre-fix)', async () => {
    delete process.env.EVOLUTION_TOPUP_ENABLED;
    delete process.env.EVOLUTION_REFLECTION_ENABLED;

    const result = await callPreview({ config: d75c9dfcConfig() });
    const plan = result.plan;

    // Pre-fix bugs: IterationPlanEntryClient was missing the `reflection` field
    // (PR #1017 backfill), the `editing` field (bring_back_editing_agents), and the
    // `evaluation` field (criteria-driven branch). All three are backfilled to mirror
    // the server's EstPerAgentValue. Guards against manual-mirror drift.
    const expectedKeys = Object.keys(plan[0]!.estPerAgent.expected).sort();
    expect(expectedKeys).toEqual(['editing', 'evaluation', 'gen', 'rank', 'reflection', 'total']);
    const upperKeys = Object.keys(plan[0]!.estPerAgent.upperBound).sort();
    expect(upperKeys).toEqual(['editing', 'evaluation', 'gen', 'rank', 'reflection', 'total']);
  });
});
