// Unit tests for standalone bias-mitigated comparison: mock LLM, 2-pass reversal,
// cache behavior, tie handling, partial failures, and parseWinner edge cases.

import {
  buildComparisonPrompt,
  parseWinner,
  compareWithBiasMitigation,
  ComparisonResult,
} from './comparison';

describe('buildComparisonPrompt', () => {
  it('includes both texts in correct order', () => {
    const prompt = buildComparisonPrompt('Text one', 'Text two');
    expect(prompt).toContain('## Text A\nText one');
    expect(prompt).toContain('## Text B\nText two');
  });

  it('includes evaluation criteria', () => {
    const prompt = buildComparisonPrompt('A', 'B');
    expect(prompt).toContain('Clarity and readability');
    expect(prompt).toContain('Your answer:');
  });
});

describe('parseWinner', () => {
  it('parses clean A/B/TIE', () => {
    expect(parseWinner('A')).toBe('A');
    expect(parseWinner('B')).toBe('B');
    expect(parseWinner('TIE')).toBe('TIE');
  });

  it('handles case insensitivity', () => {
    expect(parseWinner('a')).toBe('A');
    expect(parseWinner('b')).toBe('B');
    expect(parseWinner('tie')).toBe('TIE');
  });

  it('parses when winner starts the response', () => {
    expect(parseWinner('A is better')).toBe('A');
    expect(parseWinner('B wins')).toBe('B');
  });

  it('parses TEXT A / TEXT B mentions', () => {
    expect(parseWinner('Text A is the winner')).toBe('A');
    expect(parseWinner('I prefer Text B')).toBe('B');
  });

  it('returns null for unparseable', () => {
    expect(parseWinner('Neither is better')).toBeNull();
    expect(parseWinner('')).toBeNull();
    expect(parseWinner('maybe')).toBeNull();
  });

  it('handles whitespace', () => {
    expect(parseWinner('  A  ')).toBe('A');
    expect(parseWinner('\nB\n')).toBe('B');
  });
});

describe('compareWithBiasMitigation', () => {
  function mockCallLLM(responses: string[]): (prompt: string) => Promise<string> {
    let idx = 0;
    return jest.fn(async () => {
      const resp = responses[idx % responses.length];
      idx++;
      return resp;
    });
  }

  it('full agreement on A → confidence 1.0', async () => {
    // Round 1: A wins, Round 2 (reversed): B wins (= A in original frame)
    const callLLM = mockCallLLM(['A', 'B']);
    const result = await compareWithBiasMitigation('text1', 'text2', callLLM);
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(1.0);
    expect(result.turns).toBe(2);
  });

  it('full agreement on B → confidence 1.0', async () => {
    // Round 1: B wins, Round 2 (reversed): A wins (= B in original frame)
    const callLLM = mockCallLLM(['B', 'A']);
    const result = await compareWithBiasMitigation('text1', 'text2', callLLM);
    expect(result.winner).toBe('B');
    expect(result.confidence).toBe(1.0);
  });

  it('full agreement on TIE → confidence 1.0', async () => {
    const callLLM = mockCallLLM(['TIE', 'TIE']);
    const result = await compareWithBiasMitigation('text1', 'text2', callLLM);
    expect(result.winner).toBe('TIE');
    expect(result.confidence).toBe(1.0);
  });

  it('one TIE + one winner → confidence 0.7', async () => {
    // Round 1: A, Round 2 (reversed): TIE → partial agreement favoring A
    const callLLM = mockCallLLM(['A', 'TIE']);
    const result = await compareWithBiasMitigation('text1', 'text2', callLLM);
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(0.7);
  });

  it('complete disagreement → TIE with confidence 0.5', async () => {
    // Round 1: A, Round 2 (reversed): A (= B in original frame) → complete disagreement
    const callLLM = mockCallLLM(['A', 'A']);
    const result = await compareWithBiasMitigation('text1', 'text2', callLLM);
    expect(result.winner).toBe('TIE');
    expect(result.confidence).toBe(0.5);
  });

  it('partial failure (one unparseable) → confidence 0.3', async () => {
    const callLLM = mockCallLLM(['A', 'gibberish']);
    const result = await compareWithBiasMitigation('text1', 'text2', callLLM);
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(0.3);
  });

  it('both unparseable → TIE with confidence 0.0', async () => {
    const callLLM = mockCallLLM(['neither', 'unknown']);
    const result = await compareWithBiasMitigation('text1', 'text2', callLLM);
    expect(result.winner).toBe('TIE');
    expect(result.confidence).toBe(0.0);
  });

  it('propagates errors from callLLM', async () => {
    const callLLM = jest.fn(async () => {
      throw new Error('API down');
    });
    await expect(
      compareWithBiasMitigation('text1', 'text2', callLLM),
    ).rejects.toThrow('API down');
  });

  describe('caching', () => {
    it('caches successful results', async () => {
      const cache = new Map<string, ComparisonResult>();
      const callLLM = mockCallLLM(['A', 'B']);
      await compareWithBiasMitigation('text1', 'text2', callLLM, cache);
      expect(cache.size).toBe(1);
    });

    it('returns cached result on second call (zero LLM calls)', async () => {
      const cache = new Map<string, ComparisonResult>();
      const callLLM = mockCallLLM(['A', 'B']);

      const result1 = await compareWithBiasMitigation('text1', 'text2', callLLM, cache);
      expect(callLLM).toHaveBeenCalledTimes(2);

      const result2 = await compareWithBiasMitigation('text1', 'text2', callLLM, cache);
      expect(callLLM).toHaveBeenCalledTimes(2); // no new calls
      expect(result2).toEqual(result1);
    });

    it('cache key is order-invariant', async () => {
      const cache = new Map<string, ComparisonResult>();
      const callLLM = mockCallLLM(['A', 'B']);

      await compareWithBiasMitigation('text1', 'text2', callLLM, cache);
      expect(callLLM).toHaveBeenCalledTimes(2);

      // Same texts in reversed order should hit cache
      const result = await compareWithBiasMitigation('text2', 'text1', callLLM, cache);
      expect(callLLM).toHaveBeenCalledTimes(2); // still 2, cache hit
      expect(result).toBeDefined();
    });

    it('does NOT cache partial failures', async () => {
      const cache = new Map<string, ComparisonResult>();
      const callLLM = mockCallLLM(['A', 'gibberish']);
      await compareWithBiasMitigation('text1', 'text2', callLLM, cache);
      expect(cache.size).toBe(0);
    });

    it('does NOT cache total failures', async () => {
      const cache = new Map<string, ComparisonResult>();
      const callLLM = mockCallLLM(['neither', 'unknown']);
      await compareWithBiasMitigation('text1', 'text2', callLLM, cache);
      expect(cache.size).toBe(0);
    });
  });

  it('calls callLLM exactly twice', async () => {
    const callLLM = mockCallLLM(['A', 'B']);
    await compareWithBiasMitigation('text1', 'text2', callLLM);
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('passes different prompts for forward and reverse', async () => {
    const calls: string[] = [];
    const callLLM = jest.fn(async (prompt: string) => {
      calls.push(prompt);
      return 'A';
    });
    await compareWithBiasMitigation('TEXT_ONE', 'TEXT_TWO', callLLM);

    expect(calls[0]).toContain('## Text A\nTEXT_ONE');
    expect(calls[0]).toContain('## Text B\nTEXT_TWO');
    expect(calls[1]).toContain('## Text A\nTEXT_TWO');
    expect(calls[1]).toContain('## Text B\nTEXT_ONE');
  });
});
