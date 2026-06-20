// Unit tests for the escalation planner replay: stop-on-first-resolve, cap enforcement,
// triggeredEscalation flags, and mode-aware chain resolution.

import type { SubVerdict, Verdict } from './types';
import { firstDecisive, unanimousAmongDecisive } from './aggregation';
import {
  replayEscalation,
  resolveChainModels,
  DEFAULT_ESCALATION_CAP,
  type EscalationChain,
} from './planner';

function sub(winner: Verdict | null, confidence: number, sourceId = 'm'): SubVerdict {
  return {
    sourceKind: 'judge',
    sourceId,
    winner,
    confidence,
    weight: 1,
    escalationStep: 0,
    triggeredEscalation: false,
  };
}

describe('replayEscalation (first_decisive)', () => {
  it('stops at the first decisive judge (chain-of-1)', () => {
    const r = replayEscalation([sub('A', 1.0), sub('B', 1.0)], firstDecisive);
    expect(r.depth).toBe(1);
    expect(r.consolidated.winner).toBe('A');
    expect(r.used[0]?.triggeredEscalation).toBe(false);
  });

  it('escalates past abstentions then resolves (TIE, TIE, A -> A at depth 3)', () => {
    const r = replayEscalation([sub('TIE', 0.5), sub('TIE', 0.5), sub('A', 1.0)], firstDecisive);
    expect(r.depth).toBe(3);
    expect(r.consolidated.winner).toBe('A');
    // first two abstainers each triggered the next escalation; the resolver did not.
    expect(r.used.map((s) => s.triggeredEscalation)).toEqual([true, true, false]);
    expect(r.used.map((s) => s.escalationStep)).toEqual([0, 1, 2]);
  });

  it('all judges abstain through the cap -> TIE', () => {
    const r = replayEscalation([sub('TIE', 0.5), sub(null, 0), sub('TIE', 1.0)], firstDecisive);
    expect(r.depth).toBe(3);
    expect(r.consolidated.winner).toBe('TIE');
    expect(r.consolidated.confidence).toBe(0);
  });

  it('respects the cap (never runs more than cap judges)', () => {
    const all = [sub('TIE', 0.5), sub('TIE', 0.5), sub('TIE', 0.5), sub('A', 1.0)];
    const r = replayEscalation(all, firstDecisive, DEFAULT_ESCALATION_CAP);
    expect(r.depth).toBe(3); // the 4th (decisive) judge is never reached
    expect(r.consolidated.winner).toBe('TIE');
  });

  it('does not mutate the input sub-verdicts', () => {
    const input = [sub('TIE', 0.5), sub('A', 1.0)];
    replayEscalation(input, firstDecisive);
    expect(input.every((s) => s.triggeredEscalation === false && s.escalationStep === 0)).toBe(true);
  });
});

describe('replayEscalation (unanimous_among_decisive)', () => {
  it('keeps escalating until two judges agree', () => {
    const r = replayEscalation([sub('A', 1.0), sub('TIE', 0.5), sub('A', 0.7)], unanimousAmongDecisive);
    expect(r.depth).toBe(3);
    expect(r.consolidated.winner).toBe('A');
    expect(r.consolidated.breakdown.votesA).toBe(2);
  });

  it('a lone decisive vote does not resolve (runs to cap, stays TIE)', () => {
    const r = replayEscalation([sub('A', 1.0), sub('TIE', 0.5), sub('TIE', 0.5)], unanimousAmongDecisive);
    expect(r.depth).toBe(3);
    expect(r.consolidated.winner).toBe('TIE');
  });
});

describe('resolveChainModels', () => {
  const chain: EscalationChain = {
    id: 'starter',
    cap: 3,
    models: {
      article: ['deepseek-chat', 'gpt-4o-mini', 'gpt-4.1'],
      paragraph: ['deepseek-v4-flash', 'gpt-4.1-nano', 'qwen-2.5-7b-instruct'],
    },
  };

  it('returns the mode-appropriate ordered ladder', () => {
    expect(resolveChainModels(chain, 'paragraph')[0]).toBe('deepseek-v4-flash');
    expect(resolveChainModels(chain, 'article')[2]).toBe('gpt-4.1');
  });
});
