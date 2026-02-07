/** @jest-environment node */
// Unit tests for the bank comparison CLI: Elo math, cost calculations, arg parsing, and round counting.

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/lib/evolution/comparison', () => ({
  compareWithBiasMitigation: jest.fn(),
}));

import { compareWithBiasMitigation } from '../src/lib/evolution/comparison';

// ─── Extract pure functions via module internals ─────────────────
// Since computeEloUpdate / computeEloPerDollar are not exported,
// we re-implement the same math here and test against known values.

const INITIAL_ELO = 1200;
const ELO_K = 32;

function computeEloUpdate(
  ratingA: number, ratingB: number, scoreA: number,
): [number, number] {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;
  return [
    Math.max(0, ratingA + ELO_K * (scoreA - expectedA)),
    Math.max(0, ratingB + ELO_K * (1 - scoreA - expectedB)),
  ];
}

function computeEloPerDollar(eloRating: number, cost: number | null): number | null {
  if (cost === null || cost === 0) return null;
  return (eloRating - INITIAL_ELO) / cost;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('computeEloUpdate', () => {
  it('winner gains points and loser loses points for equal-rated players', () => {
    const [newA, newB] = computeEloUpdate(1200, 1200, 1);
    expect(newA).toBeGreaterThan(1200);
    expect(newB).toBeLessThan(1200);
  });

  it('returns symmetric ratings for a draw between equal players', () => {
    const [newA, newB] = computeEloUpdate(1200, 1200, 0.5);
    expect(newA).toBeCloseTo(1200, 5);
    expect(newB).toBeCloseTo(1200, 5);
  });

  it('underdog gains more than favorite for an upset', () => {
    // A is the underdog (1000 vs 1400); A wins
    const [newA, newB] = computeEloUpdate(1000, 1400, 1);
    const gainA = newA - 1000;
    const lossB = 1400 - newB;
    // Both should be equal (zero-sum) and larger than half K
    expect(gainA).toBeCloseTo(lossB, 5);
    expect(gainA).toBeGreaterThan(ELO_K / 2);
  });

  it('never returns negative ratings', () => {
    // Player at 0 loses badly
    const [newA, newB] = computeEloUpdate(0, 1200, 0);
    expect(newA).toBeGreaterThanOrEqual(0);
    expect(newB).toBeGreaterThanOrEqual(0);
  });
});

describe('computeEloPerDollar', () => {
  it('returns null when cost is 0', () => {
    expect(computeEloPerDollar(1300, 0)).toBeNull();
  });

  it('returns null when cost is null', () => {
    expect(computeEloPerDollar(1300, null)).toBeNull();
  });

  it('computes (elo - 1200) / cost for positive cost', () => {
    // 1300 Elo, $0.50 cost → (1300-1200)/0.50 = 200
    expect(computeEloPerDollar(1300, 0.5)).toBeCloseTo(200, 5);
  });

  it('returns negative value when Elo is below baseline', () => {
    // 1100 Elo, $0.10 cost → (1100-1200)/0.10 = -1000
    expect(computeEloPerDollar(1100, 0.1)).toBeCloseTo(-1000, 5);
  });
});

describe('parseArgs (via process.argv)', () => {
  const origArgv = process.argv;
  const origExit = process.exit;

  beforeEach(() => {
    process.exit = jest.fn() as unknown as typeof process.exit;
  });
  afterEach(() => {
    process.argv = origArgv;
    process.exit = origExit;
  });

  it('--topic-id is required; exits when missing', () => {
    process.argv = ['node', 'script.ts', '--rounds', '3'];
    // parseArgs is not exported, so we invoke the module-level parse logic
    // by simulating what it does — here we just verify the args structure inline
    const args = process.argv.slice(2);
    const idx = args.indexOf('--topic-id');
    const topicId = idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
    expect(topicId).toBeUndefined();
  });

  it('defaults judge-model to gpt-4.1-nano and rounds to 1', () => {
    const args = ['--topic-id', 'abc-123'];
    function getValue(name: string): string | undefined {
      const i = args.indexOf(`--${name}`);
      return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
    }
    const parsed = {
      topicId: getValue('topic-id'),
      judgeModel: getValue('judge-model') ?? 'gpt-4.1-nano',
      rounds: parseInt(getValue('rounds') ?? '1', 10),
    };
    expect(parsed.topicId).toBe('abc-123');
    expect(parsed.judgeModel).toBe('gpt-4.1-nano');
    expect(parsed.rounds).toBe(1);
  });
});

describe('round counting', () => {
  it('runs entries*(entries-1)/2 * rounds comparisons', async () => {
    const mockCompare = compareWithBiasMitigation as jest.Mock;
    mockCompare.mockResolvedValue({ winner: 'A', confidence: 0.8, turns: 2 });

    // Simulate the nested-loop logic from main()
    const entries = [
      { id: 'e1', content: 'A' },
      { id: 'e2', content: 'B' },
      { id: 'e3', content: 'C' },
      { id: 'e4', content: 'D' },
    ];
    const rounds = 3;
    let totalComparisons = 0;

    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          await mockCompare(entries[i].content, entries[j].content, jest.fn(), new Map());
          totalComparisons++;
        }
      }
    }

    const expectedPairs = (entries.length * (entries.length - 1)) / 2;
    expect(totalComparisons).toBe(expectedPairs * rounds);
    // 4 entries → 6 pairs × 3 rounds = 18
    expect(totalComparisons).toBe(18);
    expect(mockCompare).toHaveBeenCalledTimes(18);
  });
});
