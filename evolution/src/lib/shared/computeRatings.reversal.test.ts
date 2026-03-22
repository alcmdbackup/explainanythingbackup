// Unit tests for the generic 2-pass reversal runner extracted from comparison.ts and diffComparison.ts.

import { run2PassReversal } from './computeRatings';

describe('run2PassReversal', () => {
  it('calls callLLM exactly twice with forward and reverse prompts', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('RESULT_FWD')
      .mockResolvedValueOnce('RESULT_REV');

    await run2PassReversal({
      buildPrompts: () => ({ forward: 'prompt-fwd', reverse: 'prompt-rev' }),
      callLLM,
      parseResponse: (r) => r,
      aggregate: () => ({ label: 'done' }),
    });

    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(callLLM).toHaveBeenCalledWith('prompt-fwd');
    expect(callLLM).toHaveBeenCalledWith('prompt-rev');
  });

  it('passes parsed responses to aggregate', async () => {
    const aggregateFn = jest.fn().mockReturnValue({ winner: 'A' });

    await run2PassReversal({
      buildPrompts: () => ({ forward: 'p1', reverse: 'p2' }),
      callLLM: async () => 'raw',
      parseResponse: (r) => `parsed-${r}`,
      aggregate: aggregateFn,
    });

    expect(aggregateFn).toHaveBeenCalledWith('parsed-raw', 'parsed-raw');
  });

  it('returns the aggregate result unchanged', async () => {
    const expected = { verdict: 'ACCEPT', confidence: 1.0 };

    const result = await run2PassReversal({
      buildPrompts: () => ({ forward: 'p1', reverse: 'p2' }),
      callLLM: async () => 'X',
      parseResponse: () => 'X',
      aggregate: () => expected,
    });

    expect(result).toBe(expected);
  });

  it('propagates LLM errors without catching', async () => {
    await expect(
      run2PassReversal({
        buildPrompts: () => ({ forward: 'p1', reverse: 'p2' }),
        callLLM: async () => { throw new Error('API timeout'); },
        parseResponse: (r) => r,
        aggregate: () => ({}),
      }),
    ).rejects.toThrow('API timeout');
  });

  it('propagates errors from buildPrompts', async () => {
    await expect(
      run2PassReversal({
        buildPrompts: () => { throw new Error('prompt build failed'); },
        callLLM: async () => 'ok',
        parseResponse: (r) => r,
        aggregate: () => ({}),
      }),
    ).rejects.toThrow('prompt build failed');
  });

  it('works with different parsed/result types', async () => {
    interface MyResult { score: number; label: string }

    const result = await run2PassReversal<number, MyResult>({
      buildPrompts: () => ({ forward: 'fwd', reverse: 'rev' }),
      callLLM: async () => '42',
      parseResponse: (r) => parseInt(r, 10),
      aggregate: (fwd, rev) => ({ score: fwd + rev, label: 'combined' }),
    });

    expect(result).toEqual({ score: 84, label: 'combined' });
  });

  it('handles different forward and reverse LLM responses', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('ACCEPT')
      .mockResolvedValueOnce('REJECT');

    const calls: Array<[string, string]> = [];

    await run2PassReversal({
      buildPrompts: () => ({ forward: 'fwd-prompt', reverse: 'rev-prompt' }),
      callLLM,
      parseResponse: (r) => r.toLowerCase(),
      aggregate: (fwd, rev) => {
        calls.push([fwd, rev]);
        return { fwd, rev };
      },
    });

    expect(calls).toEqual([['accept', 'reject']]);
  });
});
