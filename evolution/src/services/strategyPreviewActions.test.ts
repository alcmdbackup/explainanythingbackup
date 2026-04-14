// Tests for strategyPreviewActions — verifies estimateAgentCostPreviewAction:
//   - Wraps the pure estimateAgentCost() (not a reimplementation)
//   - Validates input via Zod (admin can't pass garbage)
//   - Returns representative assumptions for the UI to display
//
// The adminAction factory is mocked to extract the handler for direct testing.

jest.mock('./adminAction', () => ({
  adminAction: (_name: string, handler: Function) => handler,
}));

import { estimateAgentCostPreviewAction } from './strategyPreviewActions';
import * as estimateCosts from '../lib/pipeline/infra/estimateCosts';

describe('estimateAgentCostPreviewAction', () => {
  it('wraps estimateAgentCost with representative defaults', async () => {
    const spy = jest.spyOn(estimateCosts, 'estimateAgentCost');

    const result = await (estimateAgentCostPreviewAction as unknown as (
      input: Parameters<typeof estimateAgentCostPreviewAction>[0],
    ) => Promise<{ estimatedAgentCostUsd: number; assumptions: { seedArticleChars: number; strategy: string; poolSize: number; maxComparisonsPerVariant: number } }>)({
      generationModel: 'qwen-2.5-7b-instruct',
      judgeModel: 'qwen-2.5-7b-instruct',
      maxComparisonsPerVariant: 15,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      5000,                    // seedArticleChars default
      'grounding_enhance',     // representative strategy (most expensive of 3 core)
      'qwen-2.5-7b-instruct',  // generationModel pass-through
      'qwen-2.5-7b-instruct',  // judgeModel pass-through
      1,                       // poolSize default (only baseline at parallel dispatch time)
      15,                      // maxComparisonsPerVariant pass-through
    );
    expect(result.estimatedAgentCostUsd).toBeGreaterThan(0);
    expect(result.assumptions).toEqual({
      seedArticleChars: 5000,
      strategy: 'grounding_enhance',
      poolSize: 1,
      maxComparisonsPerVariant: 15,
    });

    spy.mockRestore();
  });

  it('defaults maxComparisonsPerVariant to 15 when omitted', async () => {
    const spy = jest.spyOn(estimateCosts, 'estimateAgentCost');
    await (estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<{ assumptions: { maxComparisonsPerVariant: number } }>)({
      generationModel: 'qwen-2.5-7b-instruct',
      judgeModel: 'qwen-2.5-7b-instruct',
    });
    expect(spy).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      15,
    );
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

  it('rejects out-of-range maxComparisonsPerVariant (>50)', async () => {
    await expect((estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<unknown>)({
      generationModel: 'qwen-2.5-7b-instruct',
      judgeModel: 'qwen-2.5-7b-instruct',
      maxComparisonsPerVariant: 100,
    })).rejects.toThrow();
  });

  it('rejects out-of-range seedArticleChars (<100)', async () => {
    await expect((estimateAgentCostPreviewAction as unknown as (input: unknown) => Promise<unknown>)({
      generationModel: 'qwen-2.5-7b-instruct',
      judgeModel: 'qwen-2.5-7b-instruct',
      seedArticleChars: 50,
    })).rejects.toThrow();
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
