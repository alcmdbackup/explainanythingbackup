// Tests for V2 LLM client wrapper with retry and cost tracking.

import { createEvolutionLLMClient } from './createEvolutionLLMClient';
import { createCostTracker } from './trackBudget';
import { BudgetExceededError } from '../../types';

// Mock writeMetricMax for cost write tests (createLLMClient now uses race-fixed GREATEST upsert)
jest.mock('../../metrics/writeMetrics', () => ({
  writeMetricMax: jest.fn(async () => {}),
}));

// Mock error classification to control transient detection
jest.mock('../../shared/classifyErrors', () => ({
  isTransientError: (err: unknown) => {
    if (err instanceof Error && err.message.includes('transient')) return true;
    return false;
  },
}));

function makeProvider(impl?: (prompt: string) => Promise<string>) {
  return {
    complete: jest.fn(impl ?? (async () => 'response text')),
  };
}

describe('V2 LLM Client', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('successful call records spend', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider();
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    await llm.complete('test prompt', 'generation');
    expect(ct.getTotalSpent()).toBeGreaterThan(0);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('transient error retried with backoff', async () => {
    const ct = createCostTracker(10);
    let callCount = 0;
    const provider = makeProvider(async () => {
      callCount++;
      if (callCount <= 2) throw new Error('transient error');
      return 'success';
    });
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    const promise = llm.complete('test', 'generation');
    // Advance past backoff timers
    await jest.advanceTimersByTimeAsync(1000); // 1st retry
    await jest.advanceTimersByTimeAsync(2000); // 2nd retry
    const result = await promise;
    expect(result).toBe('success');
    expect(callCount).toBe(3);
  });

  it('non-transient error propagates immediately', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => {
      throw new Error('fatal error');
    });
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.complete('test', 'generation')).rejects.toThrow('fatal error');
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('BudgetExceededError NOT retried', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => {
      throw new BudgetExceededError('gen', 9, 1, 10);
    });
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.complete('test', 'generation')).rejects.toThrow(BudgetExceededError);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('max 3 retries then propagate', async () => {
    jest.useRealTimers();
    const ct = createCostTracker(10);
    let callCount = 0;
    const provider = {
      complete: jest.fn(async () => {
        callCount++;
        throw new Error('transient error');
      }),
    };
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.complete('x', 'generation')).rejects.toThrow('transient error');
    expect(callCount).toBe(4); // 1 initial + 3 retries
  }, 15000);

  it('release called on failure (budget not leaked)', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => {
      throw new Error('fatal error');
    });
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.complete('test', 'generation')).rejects.toThrow();
    // Available budget should be restored (release called)
    expect(ct.getAvailableBudget()).toBeCloseTo(10);
  });

  it('rejects empty string LLM response', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => '');
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.complete('test', 'generation')).rejects.toThrow('Empty LLM response');
  });

  it('rejects whitespace-only LLM response', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => '   \n  ');
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.complete('test', 'generation')).rejects.toThrow('Empty LLM response');
  });

  it('unknown model uses fallback pricing from shared config', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider();
    const llm = createEvolutionLLMClient(provider, ct, 'unknown-model-xyz');

    await llm.complete('test', 'generation');
    // Should still track cost using default fallback pricing
    expect(ct.getTotalSpent()).toBeGreaterThan(0);
  });

  it('completeStructured throws not supported', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider();
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.completeStructured('test', {} as never, 'schema', 'generation')).rejects.toThrow(
      'completeStructured not supported in V2',
    );
  });

  it('per-call timeout fires after 60s and rejects', async () => {
    jest.useRealTimers(); // Need real timers for Promise.race timeout
    const ct = createCostTracker(10);
    // Provider that never resolves
    const provider = {
      complete: jest.fn(() => new Promise<string>(() => {
        // Intentionally never resolves
      })),
    };
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    // The timeout is 20s, but we mock setTimeout to make it instant
    // Use fake timers just for the timeout advancement
    const promise = llm.complete('test', 'generation');

    await expect(promise).rejects.toThrow('LLM call timeout (20s)');
    // Budget should be released (not leaked)
    expect(ct.getAvailableBudget()).toBeCloseTo(10);
  }, 30000);

  it('cost estimation formula: inputTokens * inputRate + outputTokens * outputRate', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => 'x'.repeat(400)); // 400 chars = ~100 output tokens
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    const prompt = 'y'.repeat(4000); // 4000 chars = ~1000 input tokens
    await llm.complete(prompt, 'generation');

    // gpt-4.1-nano pricing: input $0.10/1M, output $0.40/1M
    // Input tokens: ceil(4000/4) = 1000, Output tokens: ceil(400/4) = 100
    // Cost = (1000 * 0.10 + 100 * 0.40) / 1_000_000 = (100 + 40) / 1_000_000 = 0.00014
    const spent = ct.getTotalSpent();
    expect(spent).toBeCloseTo(0.00014, 5);
  });

  it('Bug #5: pipeline pricing matches shared config for deepseek-chat', async () => {
    // Shared config: deepseek-chat input=$0.28/1M, output=$0.42/1M (V3.2 pricing)
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => 'x'.repeat(400)); // ~100 output tokens
    const llm = createEvolutionLLMClient(provider, ct, 'deepseek-chat');

    const prompt = 'y'.repeat(4000); // ~1000 input tokens
    await llm.complete(prompt, 'generation');

    // Correct: (1000 * 0.28 + 100 * 0.42) / 1_000_000 = (280 + 42) / 1_000_000 = 0.000322
    const spent = ct.getTotalSpent();
    expect(spent).toBeCloseTo(0.000322, 5);
  });

  it('Bug A regression: uses token-based cost from provider usage, not response.length', async () => {
    // Provider returns a 50KB string but reports only 100 completion tokens — the string-length
    // heuristic would compute ~$0.005 (deepseek-chat output @ 0.42/1M × 12500 tokens), while the
    // token-based path computes only $0.000042 (100 tokens × 0.42/1M).
    const ct = createCostTracker(10);
    const provider = {
      complete: jest.fn(async () => ({
        text: 'x'.repeat(50_000),
        usage: { promptTokens: 100, completionTokens: 100 },
      })),
    };
    const llm = createEvolutionLLMClient(provider, ct, 'deepseek-chat');

    await llm.complete('prompt', 'generation');

    // Token-based: (100 * 0.28 + 100 * 0.42) / 1M = 0.00007
    // String-based (bug path): would be orders of magnitude higher
    const spent = ct.getTotalSpent();
    expect(spent).toBeCloseTo(0.00007, 6);
    // Sanity: far lower than the string-length heuristic would produce
    expect(spent).toBeLessThan(0.001);
  });

  it('Bug A fallback: legacy bare-string provider still uses chars/4 path', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => 'x'.repeat(400)); // legacy bare string
    const llm = createEvolutionLLMClient(provider, ct, 'deepseek-chat');

    const prompt = 'y'.repeat(4000);
    await llm.complete(prompt, 'generation');

    // Chars-based fallback unchanged: 0.000322 (same as the Bug #5 test above).
    expect(ct.getTotalSpent()).toBeCloseTo(0.000322, 5);
  });

  it('writes cost metric to DB after each successful LLM call when db/runId provided', async () => {
    jest.useRealTimers();
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => 'response text');
    const mockDb = {} as never;

    const { writeMetricMax: mockWriteMetricMax } = require('../../metrics/writeMetrics') as { writeMetricMax: jest.Mock };
    mockWriteMetricMax.mockClear();

    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano', undefined, mockDb, 'run-abc');
    await llm.complete('test prompt', 'generation');

    // Should write cost (always) + generation_cost (because agentName='generation' is in COST_METRIC_BY_AGENT)
    const metricNames = mockWriteMetricMax.mock.calls.map((c: unknown[]) => c[3]);
    expect(metricNames).toContain('cost');
    expect(metricNames).toContain('generation_cost');
  });

  it('suppresses errors from cost writes (non-fatal)', async () => {
    jest.useRealTimers();
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => 'response text');

    const { writeMetricMax: mockWriteMetricMax } = require('../../metrics/writeMetrics') as { writeMetricMax: jest.Mock };
    mockWriteMetricMax.mockRejectedValue(new Error('DB connection lost'));

    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano', undefined, {} as never, 'run-abc');

    // Should not throw despite writeMetric rejecting
    const result = await llm.complete('test prompt', 'generation');
    expect(result).toBe('response text');

    await new Promise(resolve => setTimeout(resolve, 10));
    mockWriteMetricMax.mockResolvedValue(undefined); // Reset for other tests
  });

  it('Bug #5: pricing for all common models matches shared config', async () => {
    const { getModelPricing } = await import('@/config/llmPricing');
    const models = ['gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'deepseek-chat', 'claude-sonnet-4-20250514'];

    for (const model of models) {
      const ct = createCostTracker(100);
      const provider = makeProvider(async () => 'x'.repeat(400));
      const llm = createEvolutionLLMClient(provider, ct, model);
      await llm.complete('y'.repeat(4000), 'generation');

      // Verify cost matches shared pricing
      const pricing = getModelPricing(model);
      const expectedCost = Math.round(
        (1000 * pricing.inputPer1M + 100 * pricing.outputPer1M) / 1_000_000 * 1_000_000
      ) / 1_000_000;
      expect(ct.getTotalSpent()).toBeCloseTo(expectedCost, 5);
    }
  });
});
