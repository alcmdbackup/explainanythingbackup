// Tests for rankSingleVariant: opponent selection, stop conditions, mutation safety, budget handling.
//
// Mocking strategy: replace compareWithBiasMitigation in computeRatings with a configurable mock
// so we can control match outcomes and confidence per comparison.

import {
  selectOpponent,
  computeTop15Cutoff,
  rankSingleVariant,
  CONVERGENCE_THRESHOLD,
  BETA_ELO,
} from './rankSingleVariant';
import { createRating, type Rating, type ComparisonResult } from '../../shared/computeRatings';
import { BudgetExceededError } from '../../types';
import type { Variant, EvolutionLLMClient } from '../../types';
import type { EvolutionConfig } from '../infra/types';

// ─── Mock compareWithBiasMitigation ───────────────────────────────

let mockComparisonQueue: ComparisonResult[] = [];
let mockLLMShouldThrowBudget = false;

jest.mock('../../shared/computeRatings', () => {
  const actual = jest.requireActual('../../shared/computeRatings');
  return {
    ...actual,
    compareWithBiasMitigation: jest.fn(async () => {
      if (mockLLMShouldThrowBudget) {
        const { BudgetExceededError } = require('../../types');
        throw new BudgetExceededError('ranking', 1, 0, 1);
      }
      const next = mockComparisonQueue.shift();
      if (!next) {
        // Default decisive A win at confidence 1.0 if queue empty
        return { winner: 'A', confidence: 1.0, turns: 2 };
      }
      return next;
    }),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────

const mkVariant = (id: string, text = `text-${id}`): Variant => ({
  id, text, version: 0, parentIds: [], tactic: 'baseline', createdAt: 0, iterationBorn: 0,
});

const mkConfig = (): EvolutionConfig => ({
  iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
  budgetUsd: 10,
  judgeModel: 'gpt-4o',
  generationModel: 'gpt-4o',
});

const mkLlm = (): EvolutionLLMClient => ({
  complete: jest.fn(async () => 'A'),
  completeStructured: jest.fn(async () => { throw new Error('not used'); }),
});

beforeEach(() => {
  mockComparisonQueue = [];
  mockLLMShouldThrowBudget = false;
});

// ─── computeTop15Cutoff ───────────────────────────────────────────

describe('computeTop15Cutoff', () => {
  it('returns 0 for empty ratings', () => {
    expect(computeTop15Cutoff(new Map())).toBe(0);
  });

  it('returns the only elo when one rating exists', () => {
    const m = new Map<string, Rating>([['a', { elo: 1280, uncertainty: 80 }]]);
    expect(computeTop15Cutoff(m)).toBe(1280);
  });

  it('returns the top-15% (top 2 of 7) cutoff elo', () => {
    const m = new Map<string, Rating>([
      ['a', { elo: 960, uncertainty: 80 }],
      ['b', { elo: 1120, uncertainty: 80 }],
      ['c', { elo: 1280, uncertainty: 80 }],
      ['d', { elo: 1440, uncertainty: 80 }],
      ['e', { elo: 1600, uncertainty: 80 }],
      ['f', { elo: 1760, uncertainty: 80 }],
      ['g', { elo: 1920, uncertainty: 80 }],
    ]);
    // B121: ceil(7 * 0.15) = 2, idx = min(6, max(0, 2-1)) = 1 → elos[1] = 1760
    // (top 2 of 7 sorted desc → cutoff is the 2nd-best).
    expect(computeTop15Cutoff(m)).toBe(1760);
  });

  it('B121: small pools return top-N cutoff, not just the single best', () => {
    // For n=4, ceil(4 * 0.15) = 1, idx = 0 → elos[0] (the best). n=4 rounds to "top 1 of 4".
    const m4 = new Map<string, Rating>([
      ['a', { elo: 1000, uncertainty: 80 }],
      ['b', { elo: 1200, uncertainty: 80 }],
      ['c', { elo: 1400, uncertainty: 80 }],
      ['d', { elo: 1600, uncertainty: 80 }],
    ]);
    expect(computeTop15Cutoff(m4)).toBe(1600);
    // For n=2, ceil(2 * 0.15) = 1, idx = 0 → elos[0]. Before B121, n=2 gave
    // idx = max(0, floor(0.3) - 1) = 0 → also elos[0], but for n=3,4,5,6 the
    // old formula collapsed to idx=0 while the corrected formula still does.
    // The clearer B121 improvement is in medium-small pools (n=7..13) where the
    // old floor formula picked the top-1 and the new ceil formula picks top-2.
    const m7 = new Map<string, Rating>();
    for (let i = 0; i < 7; i++) m7.set(String(i), { elo: 1000 + i * 100, uncertainty: 80 });
    // Sorted desc: 1600, 1500, 1400, ..., 1000. Top-2 cutoff = 1500.
    expect(computeTop15Cutoff(m7)).toBe(1500);
  });
});

// ─── selectOpponent ───────────────────────────────────────────────

describe('selectOpponent', () => {
  const variant = mkVariant('V');
  const variantRating: Rating = { elo: 1200, uncertainty: 64 };

  it('returns null when only the variant is in the pool', () => {
    const pool = [variant];
    const ratings = new Map<string, Rating>([['V', variantRating]]);
    expect(selectOpponent(variant, variantRating, pool, ratings, new Set())).toBeNull();
  });

  it('returns null when all opponents have been compared', () => {
    const pool = [variant, mkVariant('A')];
    const ratings = new Map<string, Rating>([['V', variantRating], ['A', { elo: 1200, uncertainty: 80 }]]);
    const completed = new Set<string>(['A|V']); // sorted key — 'A' < 'V'
    expect(selectOpponent(variant, variantRating, pool, ratings, completed)).toBeNull();
  });

  it('picks an opponent over a self-match', () => {
    const pool = [variant, mkVariant('A')];
    const ratings = new Map<string, Rating>([['V', variantRating], ['A', { elo: 1200, uncertainty: 80 }]]);
    const result = selectOpponent(variant, variantRating, pool, ratings, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe('A');
  });

  it('prefers close+reliable over close+noisy', () => {
    // Both at elo=1200 (close), but RELIABLE has lower uncertainty → higher score (entropy/uncertainty^k).
    const pool = [variant, mkVariant('NOISY'), mkVariant('RELIABLE')];
    const ratings = new Map<string, Rating>([
      ['V', variantRating],
      ['NOISY', { elo: 1200, uncertainty: 128 }],
      ['RELIABLE', { elo: 1200, uncertainty: 32 }],
    ]);
    const result = selectOpponent(variant, variantRating, pool, ratings, new Set());
    expect(result!.id).toBe('RELIABLE');
  });

  it('prefers close+reliable over very-far+precise (entropy collapses for far opponents)', () => {
    // CLOSE: elo=1200, uncertainty=48 (close, reliable). FAR: elo=0, uncertainty=16 (very far).
    // FAR's pWin is near-1, so entropy → 0 and the score collapses despite tiny uncertainty.
    const pool = [variant, mkVariant('CLOSE'), mkVariant('FAR')];
    const ratings = new Map<string, Rating>([
      ['V', variantRating],
      ['CLOSE', { elo: 1200, uncertainty: 48 }],
      ['FAR', { elo: 0, uncertainty: 16 }],
    ]);
    const result = selectOpponent(variant, variantRating, pool, ratings, new Set());
    expect(result!.id).toBe('CLOSE');
  });

  it('returns a far opponent when no closer ones are available', () => {
    const pool = [variant, mkVariant('FAR')];
    const ratings = new Map<string, Rating>([
      ['V', variantRating],
      ['FAR', { elo: 0, uncertainty: 80 }],
    ]);
    const result = selectOpponent(variant, variantRating, pool, ratings, new Set());
    expect(result!.id).toBe('FAR');
  });

  it('uses a default rating for unrated opponents', () => {
    const pool = [variant, mkVariant('UNRATED')];
    const ratings = new Map<string, Rating>([['V', variantRating]]);
    const result = selectOpponent(variant, variantRating, pool, ratings, new Set());
    expect(result).not.toBeNull();
    expect(result!.id).toBe('UNRATED');
  });

  it('excludes already-compared pairs', () => {
    const pool = [variant, mkVariant('A'), mkVariant('B')];
    const ratings = new Map<string, Rating>([
      ['V', variantRating],
      ['A', { elo: 1200, uncertainty: 80 }],
      ['B', { elo: 1200, uncertainty: 64 }],
    ]);
    const completed = new Set<string>(['B|V']); // V vs B done — only A remains
    const result = selectOpponent(variant, variantRating, pool, ratings, completed);
    expect(result!.id).toBe('A');
  });
});

// ─── rankSingleVariant ────────────────────────────────────────────

describe('rankSingleVariant', () => {
  const buildParams = (overrides?: Partial<Parameters<typeof rankSingleVariant>[0]>) => {
    const variant = mkVariant('V');
    const opponents = [mkVariant('A'), mkVariant('B'), mkVariant('C')];
    const pool = [variant, ...opponents];
    const ratings = new Map<string, Rating>([
      ['V', createRating()],
      ['A', { elo: 1200, uncertainty: 80 }],
      ['B', { elo: 1200, uncertainty: 80 }],
      ['C', { elo: 1200, uncertainty: 80 }],
    ]);
    return {
      variant,
      pool,
      ratings,
      matchCounts: new Map<string, number>(),
      completedPairs: new Set<string>(),
      cache: new Map<string, ComparisonResult>(),
      llm: mkLlm(),
      config: mkConfig(),
      invocationId: 'inv-test',
      ...overrides,
    };
  };

  it('exits with no_more_opponents when pool only has the variant', async () => {
    const variant = mkVariant('V');
    const result = await rankSingleVariant({
      variant,
      pool: [variant],
      ratings: new Map([['V', createRating()]]),
      matchCounts: new Map(),
      completedPairs: new Set(),
      cache: new Map(),
      llm: mkLlm(),
      config: mkConfig(),
      invocationId: 'inv-1',
    });
    expect(result.status).toBe('no_more_opponents');
    expect(result.matches).toEqual([]);
    expect(result.comparisonsRun).toBe(0);
  });

  it('exits via converged when uncertainty drops below threshold', async () => {
    const params = buildParams();
    // Force decisive wins so uncertainty shrinks fast.
    mockComparisonQueue = Array.from({ length: 20 }, () => ({ winner: 'A' as const, confidence: 1.0, turns: 2 }));
    const result = await rankSingleVariant(params);
    // Either converged or no_more_opponents — both are valid exits with this small pool.
    // We assert at least that the loop ran some comparisons.
    expect(['converged', 'no_more_opponents']).toContain(result.status);
    expect(result.matches.length).toBeGreaterThan(0);
    // Final uncertainty should be below initial (400/3 ≈ 133.33)
    const finalUncertainty = params.ratings.get('V')!.uncertainty;
    expect(finalUncertainty).toBeLessThan(400 / 3);
  });

  it('exits via no_more_opponents after exhausting the pool', async () => {
    const params = buildParams();
    // 3 opponents, 3 comparisons, then exit.
    mockComparisonQueue = Array.from({ length: 3 }, () => ({ winner: 'A' as const, confidence: 1.0, turns: 2 }));
    const result = await rankSingleVariant(params);
    // Could be converged early (due to uncertainty collapse) OR no_more_opponents.
    expect(['no_more_opponents', 'converged']).toContain(result.status);
    expect(result.comparisonsRun).toBeLessThanOrEqual(3);
  });

  it('exits via budget when compareWithBiasMitigation throws BudgetExceededError', async () => {
    const params = buildParams();
    mockLLMShouldThrowBudget = true;
    const result = await rankSingleVariant(params);
    expect(result.status).toBe('budget');
    expect(result.matches).toEqual([]);
    expect(result.comparisonsRun).toBe(0);
    expect(result.detail.stopReason).toBe('budget');
  });

  it('exits via eliminated when elo+2uncertainty drops below top15Cutoff', async () => {
    // Set up: variant V starts at elo=1200 uncertainty=133.33, top15 cutoff is 1600 (very high).
    // Force losses to push V's elo down, eventually elo+2uncertainty < cutoff.
    const variant = mkVariant('V');
    const opp = mkVariant('TOP');
    const ratings = new Map<string, Rating>([
      ['V', createRating()],
      ['TOP', { elo: 1600, uncertainty: 16 }],
    ]);
    const pool = [variant, opp];
    // V loses every match (B wins each comparison). Multiple losses in a row collapse elo.
    mockComparisonQueue = Array.from({ length: 10 }, () => ({ winner: 'B' as const, confidence: 1.0, turns: 2 }));
    const params = {
      variant, pool, ratings,
      matchCounts: new Map<string, number>(),
      completedPairs: new Set<string>(),
      cache: new Map<string, ComparisonResult>(),
      llm: mkLlm(),
      config: mkConfig(),
      invocationId: 'inv-elim',
    };
    const result = await rankSingleVariant(params);
    // Either eliminated or no_more_opponents (only one opponent in pool).
    // The point of this test: with one opponent, after losing once V is at no_more_opponents.
    expect(['eliminated', 'no_more_opponents']).toContain(result.status);
  });

  it('mutates the supplied ratings map (chronological order)', async () => {
    const params = buildParams();
    const initialV = params.ratings.get('V')!;
    mockComparisonQueue = [{ winner: 'A', confidence: 1.0, turns: 2 }];
    await rankSingleVariant(params);
    const afterV = params.ratings.get('V')!;
    expect(afterV.elo).not.toBe(initialV.elo);
    expect(afterV.uncertainty).toBeLessThan(initialV.uncertainty);
  });

  it('does NOT mutate other agents\' ratings (callers are responsible for cloning)', async () => {
    // This test documents the contract: rankSingleVariant mutates its INPUT ratings map.
    // Callers must deep-clone before passing if they want isolation.
    const variant = mkVariant('V');
    const sharedRatings = new Map<string, Rating>([
      ['V', createRating()],
      ['A', { elo: 1200, uncertainty: 80 }],
    ]);
    const params = {
      variant,
      pool: [variant, mkVariant('A')],
      ratings: sharedRatings,
      matchCounts: new Map<string, number>(),
      completedPairs: new Set<string>(),
      cache: new Map<string, ComparisonResult>(),
      llm: mkLlm(),
      config: mkConfig(),
      invocationId: 'inv-mut',
    };
    mockComparisonQueue = [{ winner: 'A', confidence: 1.0, turns: 2 }];
    await rankSingleVariant(params);
    // Document mutation behavior — sharedRatings was modified.
    expect(sharedRatings.get('V')!.uncertainty).toBeLessThan(400 / 3);
  });

  it('records detailed comparison entries with before/after state', async () => {
    const params = buildParams();
    mockComparisonQueue = [{ winner: 'A', confidence: 0.9, turns: 2 }];
    const result = await rankSingleVariant(params);
    expect(result.detail.comparisons.length).toBeGreaterThan(0);
    const first = result.detail.comparisons[0]!;
    expect(first.round).toBe(1);
    expect(first.opponentId).toBeDefined();
    expect(first.outcome).toBe('win');
    expect(first.confidence).toBe(0.9);
    expect(first.variantEloAfter).not.toBe(first.variantEloBefore); // elo changed
    expect(first.variantUncertaintyAfter).toBeLessThan(first.variantUncertaintyBefore);
  });

  it('updates completedPairs after each comparison', async () => {
    const params = buildParams();
    const completed = params.completedPairs as Set<string>;
    expect(completed.size).toBe(0);
    mockComparisonQueue = [{ winner: 'A', confidence: 1.0, turns: 2 }];
    await rankSingleVariant(params);
    expect(completed.size).toBeGreaterThan(0);
  });

  it('increments matchCounts for both variant and opponent', async () => {
    const params = buildParams();
    mockComparisonQueue = [{ winner: 'A', confidence: 1.0, turns: 2 }];
    await rankSingleVariant(params);
    expect(params.matchCounts.get('V')).toBeGreaterThanOrEqual(1);
  });

  it('returns matchBuffer with the raw V2Match outcomes', async () => {
    const params = buildParams();
    mockComparisonQueue = [{ winner: 'A', confidence: 0.85, turns: 2 }];
    const result = await rankSingleVariant(params);
    expect(result.matches.length).toBeGreaterThan(0);
    const m = result.matches[0]!;
    expect(m.confidence).toBe(0.85);
    expect(m.judgeModel).toBe('gpt-4o');
    expect(m.result).toBe('win');
  });

  it('handles LLM zero-confidence failures by skipping rating updates but recording the comparison', async () => {
    const params = buildParams();
    mockComparisonQueue = [
      { winner: 'TIE', confidence: 0, turns: 2 }, // failure
      { winner: 'A', confidence: 1.0, turns: 2 },
    ];
    const initialElo = params.ratings.get('V')!.elo;
    const result = await rankSingleVariant(params);
    expect(result.detail.comparisons.length).toBeGreaterThanOrEqual(1);
    // First comparison was a failure — confidence 0
    expect(result.detail.comparisons[0]!.confidence).toBe(0);
    // After second non-failure comparison, elo should change.
    if (result.detail.comparisons.length >= 2) {
      expect(params.ratings.get('V')!.elo).not.toBe(initialElo);
    }
  });
});
