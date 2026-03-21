// Tests for V2 LLM client wrapper with retry and cost tracking.

import { createV2LLMClient } from './llm-client';
import { createCostTracker } from './cost-tracker';
import { BudgetExceededError } from '../types';

// Mock error classification to control transient detection
jest.mock('../shared/errorClassification', () => ({
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
    const llm = createV2LLMClient(provider, ct, 'gpt-4.1-nano');

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
    const llm = createV2LLMClient(provider, ct, 'gpt-4.1-nano');

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
    const llm = createV2LLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.complete('test', 'generation')).rejects.toThrow('fatal error');
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('BudgetExceededError NOT retried', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => {
      throw new BudgetExceededError('gen', 9, 1, 10);
    });
    const llm = createV2LLMClient(provider, ct, 'gpt-4.1-nano');

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
    const llm = createV2LLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.complete('x', 'generation')).rejects.toThrow('transient error');
    expect(callCount).toBe(4); // 1 initial + 3 retries
  }, 15000);

  it('release called on failure (budget not leaked)', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider(async () => {
      throw new Error('fatal error');
    });
    const llm = createV2LLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.complete('test', 'generation')).rejects.toThrow();
    // Available budget should be restored (release called)
    expect(ct.getAvailableBudget()).toBeCloseTo(10);
  });

  it('unknown model uses fallback pricing and logs warning', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider();
    const llm = createV2LLMClient(provider, ct, 'unknown-model-xyz');
    const spy = jest.spyOn(console, 'warn').mockImplementation();

    await llm.complete('test', 'generation');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unknown model'));
    spy.mockRestore();
  });

  it('completeStructured throws not supported', async () => {
    const ct = createCostTracker(10);
    const provider = makeProvider();
    const llm = createV2LLMClient(provider, ct, 'gpt-4.1-nano');

    await expect(llm.completeStructured('test', {} as never, 'schema', 'agent')).rejects.toThrow(
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
    const llm = createV2LLMClient(provider, ct, 'gpt-4.1-nano');

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
    const llm = createV2LLMClient(provider, ct, 'gpt-4.1-nano');

    const prompt = 'y'.repeat(4000); // 4000 chars = ~1000 input tokens
    await llm.complete(prompt, 'generation');

    // gpt-4.1-nano pricing: input $0.10/1M, output $0.40/1M
    // Input tokens: ceil(4000/4) = 1000, Output tokens: ceil(400/4) = 100
    // Cost = (1000 * 0.10 + 100 * 0.40) / 1_000_000 = (100 + 40) / 1_000_000 = 0.00014
    const spent = ct.getTotalSpent();
    expect(spent).toBeCloseTo(0.00014, 5);
  });
});
