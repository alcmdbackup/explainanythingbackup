// Tests for the offline ensemble simulator: synthetic cases for simulate/computeMetrics, plus
// deterministic fixture-backed assertions reproducing the Phase-1 numbers (within tolerance) on
// the committed pinned corpus. No live DB.

import recordedCorpus from './fixtures/recordedCorpus.json';
import { firstDecisive, unanimousAmongDecisive } from './aggregation';
import {
  simulate,
  computeMetrics,
  analyzeChain,
  ARTICLE_SET,
  PARAGRAPH_SET,
  CHAINS,
  type RecordedCall,
} from './offlineReaggregate';
import type { Verdict } from './types';

function mkCall(
  model: string,
  winner: Verdict,
  confidence: number,
  o: Partial<RecordedCall> = {},
): RecordedCall {
  return {
    testSet: 't',
    model,
    pairLabel: o.pairLabel ?? 'p1',
    pairKind: o.pairKind ?? 'article',
    repeatIndex: o.repeatIndex ?? 0,
    winner,
    confidence,
    forwardWinner: o.forwardWinner ?? winner,
    reverseWinner: o.reverseWinner ?? winner,
    expectedWinner: o.expectedWinner ?? null,
    gapKind: o.gapKind ?? null,
    costUsd: o.costUsd ?? 0.001,
  };
}

describe('simulate + computeMetrics (synthetic)', () => {
  it('chain-of-1: a single decisive judge -> decisive match', () => {
    const m = computeMetrics(simulate([mkCall('m1', 'A', 1.0)], ['m1'], firstDecisive));
    expect(m.decisiveRate).toBe(1);
    expect(m.avgDepth).toBe(1);
  });

  it('escalates across abstaining first judges (TIE then A -> depth 2, decisive)', () => {
    const calls = [
      mkCall('m1', 'TIE', 0.5, { pairLabel: 'p1' }),
      mkCall('m2', 'A', 1.0, { pairLabel: 'p1' }),
    ];
    const m = computeMetrics(simulate(calls, ['m1', 'm2'], firstDecisive));
    expect(m.decisiveRate).toBe(1);
    expect(m.avgDepth).toBe(2);
  });

  it('all-abstain pair -> not decisive', () => {
    const m = computeMetrics(simulate([mkCall('m1', 'TIE', 0.5)], ['m1'], firstDecisive));
    expect(m.decisiveRate).toBe(0);
  });

  it('computes large-gap accuracy + lone-decisive-wrong on the ground-truth subset only', () => {
    const calls = [
      mkCall('m1', 'A', 1.0, { pairLabel: 'p1', gapKind: 'large', expectedWinner: 'A' }), // correct
      mkCall('m1', 'B', 1.0, { pairLabel: 'p2', gapKind: 'large', expectedWinner: 'A' }), // wrong
      mkCall('m1', 'A', 1.0, { pairLabel: 'p3', gapKind: 'close', expectedWinner: null }), // excluded
    ];
    const m = computeMetrics(simulate(calls, ['m1'], firstDecisive));
    expect(m.nLargeGap).toBe(2);
    expect(m.accuracyLargeGap).toBe(0.5);
    expect(m.loneDecisiveWrongRate).toBe(0.5);
  });
});

describe('fixture-backed Phase-1 numbers (deterministic; tolerance ±0.02)', () => {
  const TOL = 0.02;
  const corpus = recordedCorpus as RecordedCall[];
  const articleCalls = corpus.filter((r) => r.testSet === ARTICLE_SET && r.pairKind === 'article');
  const paraCalls = corpus.filter((r) => r.testSet === PARAGRAPH_SET && r.pairKind === 'paragraph');

  it('fixture has the expected shape (270 article + 200 paragraph rows)', () => {
    expect(articleCalls.length).toBe(270);
    expect(paraCalls.length).toBe(200);
  });

  it('chain-of-1 reproduces the recorded single-judge decisive rate (gpt-4o-mini = 0.60)', () => {
    expect(analyzeChain(articleCalls, ['gpt-4o-mini'], firstDecisive).decisiveRate).toBeCloseTo(0.6, 2);
  });

  it('ARTICLE chain [gpt-4o-mini, deepseek-chat] first_decisive: ~0.83 decisive, perfect large-gap accuracy, cheap', () => {
    const m = analyzeChain(articleCalls, CHAINS.article, firstDecisive);
    expect(m.decisiveRate).toBeGreaterThanOrEqual(0.83 - TOL);
    expect(m.accuracyLargeGap).toBe(1); // 0 lone-decisive errors on this set
    expect(m.loneDecisiveWrongRate ?? 0).toBeLessThanOrEqual(TOL);
    expect(m.costPerDecisive).toBeLessThan(0.01); // far below single gpt-4.1 ($0.0127/dec)
  });

  it('PARAGRAPH chain first_decisive: decisive uplift over best single cheap (0.60), accuracy near gemini-lite', () => {
    const m = analyzeChain(paraCalls, CHAINS.paragraph, firstDecisive);
    expect(m.decisiveRate).toBeGreaterThanOrEqual(0.70);
    expect(m.accuracyLargeGap ?? 0).toBeGreaterThanOrEqual(0.74);
  });

  it('first_decisive is strictly more decisive than unanimous_among_decisive on both sets', () => {
    expect(analyzeChain(articleCalls, CHAINS.article, firstDecisive).decisiveRate).toBeGreaterThan(
      analyzeChain(articleCalls, CHAINS.article, unanimousAmongDecisive).decisiveRate,
    );
    expect(analyzeChain(paraCalls, CHAINS.paragraph, firstDecisive).decisiveRate).toBeGreaterThan(
      analyzeChain(paraCalls, CHAINS.paragraph, unanimousAmongDecisive).decisiveRate,
    );
  });
});
