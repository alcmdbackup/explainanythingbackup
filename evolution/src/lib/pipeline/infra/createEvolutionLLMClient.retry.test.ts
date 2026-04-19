// Tests that LLM call timeout errors are retried using the REAL isTransientError function.
// This file is intentionally separate from createLLMClient.test.ts because that file mocks
// classifyErrors module-wide (jest.mock() is hoisted), which would prevent testing the real
// isTransientError implementation. Here we import the real function with no mocking.

import { createEvolutionLLMClient } from './createEvolutionLLMClient';
import { createCostTracker } from './trackBudget';

// Mock only writeMetric — classifyErrors is intentionally NOT mocked here
jest.mock('../../metrics/writeMetrics', () => ({
  writeMetric: jest.fn(async () => {}),
}));

describe('V2 LLM Client — timeout retry (real isTransientError)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries on LLM call timeout error and succeeds on second attempt', async () => {
    const ct = createCostTracker(10);
    let callCount = 0;
    const provider = {
      complete: jest.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error('LLM call timeout (20s)');
        return 'success response';
      }),
    };
    const llm = createEvolutionLLMClient(provider, ct, 'gpt-4.1-nano');

    const promise = llm.complete('test prompt', 'generation');
    // Advance past the 1s backoff between attempt 1 and attempt 2
    await jest.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe('success response');
    expect(callCount).toBe(2); // attempt 1 failed with timeout, attempt 2 succeeded
  });
});
