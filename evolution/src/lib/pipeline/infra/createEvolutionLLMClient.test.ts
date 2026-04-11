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

    // The timeout is 60s, but we mock setTimeout to make it instant
    // Use fake timers just for the timeout advancement
    const promise = llm.complete('test', 'generation');

    await expect(promise).rejects.toThrow('LLM call timeout (60s)');
    // Budget should be released (not leaked)
    expect(ct.getAvailableBudget()).toBeCloseTo(10);
  }, 70000);

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
    // Shared config: deepseek-chat input=$0.14/1M, output=$0.28/1M
    // Old hardcoded value was input=$0.27/1M, output=$1.10/1M (2x too high)
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => 'x'.repeat(400)); // ~100 output tokens
    const llm = createEvolutionLLMClient(provider, ct, 'deepseek-chat');

    const prompt = 'y'.repeat(4000); // ~1000 input tokens
    await llm.complete(prompt, 'generation');

    // Correct: (1000 * 0.14 + 100 * 0.28) / 1_000_000 = (140 + 28) / 1_000_000 = 0.000168
    const spent = ct.getTotalSpent();
    expect(spent).toBeCloseTo(0.000168, 5);
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
