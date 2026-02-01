// Unit tests for content quality comparison service.
// Tests independent scoring and pairwise comparison with position bias detection.

import { compareArticlesIndependent, compareArticles } from './contentQualityCompare';

// Mock callLLM
jest.mock('./llms', () => ({
  callLLM: jest.fn(),
  LIGHTER_MODEL: 'gpt-4.1-nano',
}));

import { callLLM } from './llms';

const mockCallOpenAI = callLLM as jest.MockedFunction<typeof callLLM>;

// ─── Independent scoring tests ───────────────────────────────────

describe('compareArticlesIndependent', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  function mockScore(clarity: number, structure: number, conciseness: number, engagement: number, overall: number) {
    return JSON.stringify({
      clarity, structure, conciseness, engagement, overall,
      reasoning: 'Test reasoning for this score.',
    });
  }

  it('declares A winner when A scores higher', async () => {
    mockCallOpenAI
      .mockResolvedValueOnce(mockScore(8, 8, 7, 8, 8))  // Article A
      .mockResolvedValueOnce(mockScore(5, 5, 5, 5, 5));  // Article B

    const result = await compareArticlesIndependent('Article A text', 'Article B text', 'user');

    expect(result.winner).toBe('A');
    expect(result.margin).toBe(3); // 8 - 5
    expect(result.scoreA.overall).toBe(8);
    expect(result.scoreB.overall).toBe(5);
  });

  it('declares B winner when B scores higher', async () => {
    mockCallOpenAI
      .mockResolvedValueOnce(mockScore(4, 4, 4, 4, 4))  // Article A
      .mockResolvedValueOnce(mockScore(9, 9, 9, 9, 9));  // Article B

    const result = await compareArticlesIndependent('Article A', 'Article B', 'user');

    expect(result.winner).toBe('B');
    expect(result.margin).toBe(-5); // 4 - 9
  });

  it('declares tie when scores within margin', async () => {
    mockCallOpenAI
      .mockResolvedValueOnce(mockScore(7, 7, 7, 7, 7))  // Article A
      .mockResolvedValueOnce(mockScore(7, 7, 7, 7, 7));  // Article B

    const result = await compareArticlesIndependent('A', 'B', 'user');

    expect(result.winner).toBeNull();
    expect(result.margin).toBe(0);
  });

  it('respects custom minMargin parameter', async () => {
    mockCallOpenAI
      .mockResolvedValueOnce(mockScore(8, 8, 8, 8, 8))  // Article A
      .mockResolvedValueOnce(mockScore(7, 7, 7, 7, 7));  // Article B

    // With minMargin=2, a difference of 1 should be a tie
    const result = await compareArticlesIndependent('A', 'B', 'user', 2);

    expect(result.winner).toBeNull();
  });
});

// ─── Pairwise comparison tests ───────────────────────────────────

describe('compareArticles', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  function mockComparison(winner: 'first' | 'second' | 'tie') {
    return JSON.stringify({
      winner,
      reasoning: 'Test reasoning for this comparison decision.',
      first_strengths: ['strength 1'],
      second_strengths: ['strength 2'],
    });
  }

  it('confident A win: A wins in both orderings', async () => {
    // F(A,B): first wins (= A)
    // F(B,A): second wins (= A)
    mockCallOpenAI
      .mockResolvedValueOnce(mockComparison('first'))
      .mockResolvedValueOnce(mockComparison('second'));

    const result = await compareArticles('Article A', 'Article B', 'user');

    expect(result.winner).toBe('A');
    expect(result.confident).toBe(true);
  });

  it('confident B win: B wins in both orderings', async () => {
    // F(A,B): second wins (= B)
    // F(B,A): first wins (= B)
    mockCallOpenAI
      .mockResolvedValueOnce(mockComparison('second'))
      .mockResolvedValueOnce(mockComparison('first'));

    const result = await compareArticles('Article A', 'Article B', 'user');

    expect(result.winner).toBe('B');
    expect(result.confident).toBe(true);
  });

  it('consistent tie: tie in both orderings', async () => {
    mockCallOpenAI
      .mockResolvedValueOnce(mockComparison('tie'))
      .mockResolvedValueOnce(mockComparison('tie'));

    const result = await compareArticles('A', 'B', 'user');

    expect(result.winner).toBeNull();
    expect(result.confident).toBe(true);
    expect(result.reasoning).toContain('tie');
  });

  it('inconclusive: first wins in both orderings (position bias)', async () => {
    // F(A,B): first wins (= A), F(B,A): first wins (= B) — contradicts
    mockCallOpenAI
      .mockResolvedValueOnce(mockComparison('first'))
      .mockResolvedValueOnce(mockComparison('first'));

    const result = await compareArticles('A', 'B', 'user');

    expect(result.winner).toBeNull();
    expect(result.confident).toBe(false);
    expect(result.reasoning).toContain('Position bias');
  });

  it('inconclusive: second wins in both orderings (position bias)', async () => {
    // F(A,B): second wins (= B), F(B,A): second wins (= A) — contradicts
    mockCallOpenAI
      .mockResolvedValueOnce(mockComparison('second'))
      .mockResolvedValueOnce(mockComparison('second'));

    const result = await compareArticles('A', 'B', 'user');

    expect(result.winner).toBeNull();
    expect(result.confident).toBe(false);
  });

  it('inconclusive: mixed tie+winner results', async () => {
    // F(A,B): tie, F(B,A): first wins (= B)
    mockCallOpenAI
      .mockResolvedValueOnce(mockComparison('tie'))
      .mockResolvedValueOnce(mockComparison('first'));

    const result = await compareArticles('A', 'B', 'user');

    expect(result.winner).toBeNull();
    expect(result.confident).toBe(false);
  });

  it('preserves result details from both orderings', async () => {
    mockCallOpenAI
      .mockResolvedValueOnce(mockComparison('first'))
      .mockResolvedValueOnce(mockComparison('second'));

    const result = await compareArticles('A', 'B', 'user');

    expect(result.resultAB.winner).toBe('first');
    expect(result.resultBA.winner).toBe('second');
    expect(result.resultAB.first_strengths).toEqual(['strength 1']);
    expect(result.resultBA.second_strengths).toEqual(['strength 2']);
  });
});

// ─── Schema validation tests ─────────────────────────────────────

describe('schema validation', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('throws on empty LLM response in independent scoring', async () => {
    mockCallOpenAI.mockResolvedValue('');

    await expect(
      compareArticlesIndependent('A', 'B', 'user'),
    ).rejects.toThrow('Empty response');
  });

  it('throws on malformed JSON in comparison', async () => {
    mockCallOpenAI.mockResolvedValue('not json at all');

    await expect(
      compareArticles('A', 'B', 'user'),
    ).rejects.toThrow();
  });
});
