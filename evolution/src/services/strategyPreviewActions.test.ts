// Tests for strategyPreviewActions — verifies estimateAgentCostPreviewAction:
//   - Wraps the pure estimateAgentCost() (not a reimplementation)
//   - Validates input via Zod (admin can't pass garbage)
//   - Returns representative assumptions for the UI to display
//
// The adminAction factory is mocked to extract the handler for direct testing.

// Mock adminAction to match the real factory's arity-detection semantics.
// A 1-arg handler is treated as ctx-only; the real factory passes `ctx` as the
// first arg. Our handler is 2-arg (input, _ctx) so it gets (input, ctx).
// This mock simulates that behavior so regressions in the arity of the action
// handler are caught at test time.
const fakeAdminCtx = { supabase: {}, adminUserId: 'test-admin' };
jest.mock('./adminAction', () => ({
  adminAction: (_name: string, handler: Function) => {
    if (handler.length <= 1) {
      // Simulate the real factory: ctx-only call when arity is 1.
      // If our action accidentally has this shape, input lands in ctx and Zod fails.
      return (input: unknown) => handler(fakeAdminCtx); // intentionally swallow `input`
    }
    return (input: unknown) => handler(input, fakeAdminCtx);
  },
}));

import { estimateAgentCostPreviewAction } from './strategyPreviewActions';
import * as estimateCosts from '../lib/pipeline/infra/estimateCosts';

describe('estimateAgentCostPreviewAction', () => {
  it('wraps estimateAgentCost with 15 representative comparisons', async () => {
    const spy = jest.spyOn(estimateCosts, 'estimateAgentCost');

    const result = await (estimateAgentCostPreviewAction as unknown as (
      input: Parameters<typeof estimateAgentCostPreviewAction>[0],
    ) => Promise<{ estimatedAgentCostUsd: number; assumptions: { seedArticleChars: number; tactic: string; comparisonsUsed: number } }>)({
      generationModel: 'qwen-2.5-7b-instruct',
      judgeModel: 'qwen-2.5-7b-instruct',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      5000,                    // seedArticleChars default
      'grounding_enhance',     // representative strategy (most expensive of 3 core)
      'qwen-2.5-7b-instruct',  // generationModel pass-through
      'qwen-2.5-7b-instruct',  // judgeModel pass-through
      16,                      // poolSize = comparisons+1, so min(15, 15)=15 comparisons
      15,                      // maxComparisonsPerVariant = REPRESENTATIVE_COMPARISONS
    );
    expect(result.estimatedAgentCostUsd).toBeGreaterThan(0);
    expect(result.assumptions).toEqual({
      seedArticleChars: 5000,
      tactic: 'grounding_enhance',
      comparisonsUsed: 15,
    });

    spy.mockRestore();
  });

  it('defaults seedArticleChars to 5000 when omitted', async () => {
    const spy = jest.spyOn(estimateCosts, 'estimateAgentCost');
    await (estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<unknown>)({
      generationModel: 'qwen-2.5-7b-instruct',
      judgeModel: 'qwen-2.5-7b-instruct',
    });
    expect(spy).toHaveBeenCalledWith(5000, expect.any(String), expect.any(String), expect.any(String), expect.any(Number), expect.any(Number));
    spy.mockRestore();
  });

  it('rejects invalid model IDs (not in allowedLLMModelSchema)', async () => {
    await expect((estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<unknown>)({
      generationModel: 'not-a-real-model',
      judgeModel: 'qwen-2.5-7b-instruct',
    })).rejects.toThrow();
  });

  it('rejects out-of-range seedArticleChars (<100)', async () => {
    await expect((estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<unknown>)({
      generationModel: 'qwen-2.5-7b-instruct',
      judgeModel: 'qwen-2.5-7b-instruct',
      seedArticleChars: 50,
    })).rejects.toThrow();
  });

  // Regression test for the arity bug that made the cost preview silently
  // fail on production. If someone changes the handler to `async (input) => ...`
  // (dropping the `_ctx` param), the mock above would route input into ctx and
  // this test will fail with a Zod error.
  it('handler has 2-arg shape so adminAction dispatches input correctly (REGRESSION)', async () => {
    const result = await (estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<{ estimatedAgentCostUsd: number }>)({
      generationModel: 'qwen-2.5-7b-instruct',
      judgeModel: 'qwen-2.5-7b-instruct',
    });
    // If the arity is wrong, Zod throws on empty input before this line.
    expect(result.estimatedAgentCostUsd).toBeGreaterThan(0);
  });

  // cost_estimate_accuracy_analysis_20260414: when COST_CALIBRATION_ENABLED is
  // 'true', estimateAgentCost consults the calibration loader before falling
  // back to EMPIRICAL_OUTPUT_CHARS. This test guards the integration so a
  // future refactor doesn't accidentally bypass the loader.
  it('consults costCalibrationLoader when COST_CALIBRATION_ENABLED=true', async () => {
    const loader = await import('../lib/pipeline/infra/costCalibrationLoader');
    const spy = jest.spyOn(loader, 'getCalibrationRow');
    const original = process.env.COST_CALIBRATION_ENABLED;
    process.env.COST_CALIBRATION_ENABLED = 'true';
    try {
      loader._resetForTesting();
      await (estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<unknown>)({
        generationModel: 'qwen-2.5-7b-instruct',
        judgeModel: 'qwen-2.5-7b-instruct',
      });
      // estimateAgentCost calls getCalibrationRow at least once for ranking-variant chars
      // and via estimateGenerationCost. We assert ≥1 call.
      expect(spy).toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.COST_CALIBRATION_ENABLED;
      else process.env.COST_CALIBRATION_ENABLED = original;
      spy.mockRestore();
      loader._resetForTesting();
    }
  });

  it('returns different cost estimates for different generation models (sanity check)', async () => {
    // poolSize=1 means ranking cost = 0 (no opponents), so only generationModel affects cost.
    // A cheap gen model should yield a lower estimate than an expensive one.
    const cheap = await (estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<{ estimatedAgentCostUsd: number }>)({
      generationModel: 'qwen-2.5-7b-instruct', // $0.04/$0.10
      judgeModel: 'qwen-2.5-7b-instruct',
    });
    const expensive = await (estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<{ estimatedAgentCostUsd: number }>)({
      generationModel: 'gpt-4.1-mini', // $0.40/$1.60
      judgeModel: 'qwen-2.5-7b-instruct',
    });
    expect(expensive.estimatedAgentCostUsd).toBeGreaterThan(cheap.estimatedAgentCostUsd);
  });
});

// ─── Phase 3: getLastUsedPromptAction ──────────────────────────────

describe('getLastUsedPromptAction', () => {
  // Build a Supabase chain that resolves to `{ data, error }` at the final .maybeSingle() call.
  interface Chain {
    select: jest.Mock; not: jest.Mock; eq: jest.Mock; is: jest.Mock;
    order: jest.Mock; limit: jest.Mock; maybeSingle: jest.Mock;
  }
  function makeSupabase(resolved: { data: unknown; error: unknown }) {
    const chain: Chain = {
      select: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => resolved),
    };
    const builder = { from: jest.fn(() => chain) };
    return { supabase: builder, chain };
  }

  // Override the adminAction mock ctx for these tests so we can inject different supabase
  // responses per test.
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns null when no qualifying run exists', async () => {
    const { supabase } = makeSupabase({ data: null, error: null });
    jest.doMock('./adminAction', () => ({
      adminAction: (_name: string, handler: Function) => (input: unknown) =>
        handler(input, { supabase, adminUserId: 'test-admin' }),
    }));
    // Re-import after re-mocking
    const mod = await import('./strategyPreviewActions');
    const result = await (mod.getLastUsedPromptAction as unknown as (input?: unknown) => Promise<unknown>)();
    expect(result).toBeNull();
  });

  it('returns { id, name, promptText } for a non-test active prompt', async () => {
    const promptRow = { id: 'p-1', name: 'Federal Reserve', prompt: 'What is the Fed?', status: 'active', deleted_at: null };
    const { supabase } = makeSupabase({
      data: { prompt_id: 'p-1', evolution_strategies: { is_test_content: false }, evolution_prompts: promptRow },
      error: null,
    });
    jest.doMock('./adminAction', () => ({
      adminAction: (_name: string, handler: Function) => (input: unknown) =>
        handler(input, { supabase, adminUserId: 'test-admin' }),
    }));
    const mod = await import('./strategyPreviewActions');
    const result = await (mod.getLastUsedPromptAction as unknown as (input?: unknown) => Promise<unknown>)();
    expect(result).toEqual({ id: 'p-1', name: 'Federal Reserve', promptText: 'What is the Fed?' });
  });

  it('returns null on DB error', async () => {
    const { supabase } = makeSupabase({ data: null, error: { message: 'boom' } });
    jest.doMock('./adminAction', () => ({
      adminAction: (_name: string, handler: Function) => (input: unknown) =>
        handler(input, { supabase, adminUserId: 'test-admin' }),
    }));
    const mod = await import('./strategyPreviewActions');
    const result = await (mod.getLastUsedPromptAction as unknown as (input?: unknown) => Promise<unknown>)();
    expect(result).toBeNull();
  });

  it('handles Supabase returning the joined prompt as an array (type variance)', async () => {
    // Generated Supabase types sometimes express single-row !inner joins as arrays.
    const promptRow = { id: 'p-2', name: 'Climate', prompt: 'Climate change?', status: 'active', deleted_at: null };
    const { supabase } = makeSupabase({
      data: { prompt_id: 'p-2', evolution_strategies: { is_test_content: false }, evolution_prompts: [promptRow] },
      error: null,
    });
    jest.doMock('./adminAction', () => ({
      adminAction: (_name: string, handler: Function) => (input: unknown) =>
        handler(input, { supabase, adminUserId: 'test-admin' }),
    }));
    const mod = await import('./strategyPreviewActions');
    const result = await (mod.getLastUsedPromptAction as unknown as (input?: unknown) => Promise<unknown>)();
    expect(result).toEqual({ id: 'p-2', name: 'Climate', promptText: 'Climate change?' });
  });

  it('applies Supabase filters: is_test_content=false, status=active, deleted_at=null', async () => {
    const { supabase, chain } = makeSupabase({ data: null, error: null });
    jest.doMock('./adminAction', () => ({
      adminAction: (_name: string, handler: Function) => (input: unknown) =>
        handler(input, { supabase, adminUserId: 'test-admin' }),
    }));
    const mod = await import('./strategyPreviewActions');
    await (mod.getLastUsedPromptAction as unknown as (input?: unknown) => Promise<unknown>)();
    // .eq called for is_test_content=false + status='active'
    expect(chain.eq).toHaveBeenCalledWith('evolution_strategies.is_test_content', false);
    expect(chain.eq).toHaveBeenCalledWith('evolution_prompts.status', 'active');
    // .is called for deleted_at IS NULL
    expect(chain.is).toHaveBeenCalledWith('evolution_prompts.deleted_at', null);
    // .not called for prompt_id NOT NULL
    expect(chain.not).toHaveBeenCalledWith('prompt_id', 'is', null);
    // Ordered by created_at desc, limit 1
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });
});
