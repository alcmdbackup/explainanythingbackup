// Offline ensemble simulator (pure): replays recorded single-judge verdicts through an
// escalation chain + aggregation rule, grouped by (pairLabel, repeatIndex), and computes the
// Phase-1 acceptance-gate metrics (decisive rate, large-gap accuracy, lone-decisive-wrong,
// cost-per-decisive, avg chain depth). No DB/LLM — operates on recorded rows passed in.

import type { AggregationRule, SubVerdict, Verdict } from './types';
import { replayEscalation, DEFAULT_ESCALATION_CAP } from './planner';

/** A recorded judge_eval_calls row (subset) — one judge's 2-pass verdict on one pair. */
export interface RecordedCall {
  testSet: string;
  model: string;
  pairLabel: string;
  pairKind: 'article' | 'paragraph';
  repeatIndex: number;
  winner: Verdict;
  confidence: number;
  forwardWinner: Verdict | null;
  reverseWinner: Verdict | null;
  expectedWinner: Verdict | null;
  gapKind: string | null;
  costUsd: number;
}

/** Frozen Phase-1 validation sets. */
export const ARTICLE_SET = '9acb42f5-fa9b-4ce8-b053-431fbe01e026';
export const PARAGRAPH_SET = '970494a4-d95b-4097-ad77-07702846a6ed';

/** Finalized Phase-1 escalation chains (most-accurate cheap judge first; first_decisive resolves on
 *  the first decisive vote). Articles: two complementary cheap judges, NO strong tier (adding gpt-4.1
 *  hurt large-gap accuracy 1.000 -> 0.778). Paragraphs: cheapest accurate-first, NO deepseek-v4-pro
 *  (strong = decisive-but-wrong on paragraphs, acc 0.200). Confirmed on the pinned corpus; revisit at
 *  larger n (lone-decisive-safety bar is underpowered at n=9 article / n=20 paragraph large-gap). */
export const CHAINS: Record<'article' | 'paragraph', string[]> = {
  article: ['gpt-4o-mini', 'deepseek-chat'],
  paragraph: ['google/gemini-2.5-flash-lite', 'deepseek-v4-flash', 'google/gemini-2.5-flash'],
};

export function toSubVerdict(call: RecordedCall, step: number): SubVerdict {
  return {
    sourceKind: 'judge',
    sourceId: call.model,
    winner: call.winner,
    confidence: call.confidence,
    weight: 1,
    escalationStep: step,
    triggeredEscalation: false,
  };
}

export interface PairResult {
  pairLabel: string;
  pairKind: 'article' | 'paragraph';
  winner: Verdict;
  confidence: number;
  decisive: boolean;
  depth: number;
  decisiveVotes: number;
  costUsd: number;
  expectedWinner: Verdict | null;
  gapKind: string | null;
}

/** Index recorded calls by `${pairLabel}#${repeatIndex}` -> model -> call. */
function indexByPair(calls: RecordedCall[]): Map<string, Map<string, RecordedCall>> {
  const byPair = new Map<string, Map<string, RecordedCall>>();
  for (const c of calls) {
    const key = `${c.pairLabel}#${c.repeatIndex}`;
    let m = byPair.get(key);
    if (!m) {
      m = new Map();
      byPair.set(key, m);
    }
    m.set(c.model, c);
  }
  return byPair;
}

/** Replay the escalation chain over recorded calls for every pair in `calls`. */
export function simulate(
  calls: RecordedCall[],
  chainModels: string[],
  rule: AggregationRule,
  cap: number = DEFAULT_ESCALATION_CAP,
): PairResult[] {
  const byPair = indexByPair(calls);
  const results: PairResult[] = [];
  for (const modelMap of byPair.values()) {
    // Build the chain's available sub-verdicts in model order (skip models with no recorded call).
    const available: SubVerdict[] = [];
    const orderedCalls: RecordedCall[] = [];
    for (const model of chainModels) {
      const c = modelMap.get(model);
      if (c) {
        available.push(toSubVerdict(c, available.length));
        orderedCalls.push(c);
      }
    }
    const anchor = orderedCalls[0];
    if (!anchor) continue;
    const replay = replayEscalation(available, rule, cap);
    const cost = orderedCalls.slice(0, replay.depth).reduce((s, c) => s + c.costUsd, 0);
    const { votesA, votesB } = replay.consolidated.breakdown;
    results.push({
      pairLabel: anchor.pairLabel,
      pairKind: anchor.pairKind,
      winner: replay.consolidated.winner,
      confidence: replay.consolidated.confidence,
      decisive: replay.consolidated.confidence > 0.6,
      depth: replay.depth,
      decisiveVotes: votesA + votesB,
      costUsd: cost,
      expectedWinner: anchor.expectedWinner,
      gapKind: anchor.gapKind,
    });
  }
  return results;
}

export interface ChainMetrics {
  nPairs: number;
  decisiveRate: number;
  avgDepth: number;
  totalCost: number;
  costPerDecisive: number;
  nLargeGap: number;
  /** Accuracy among DECISIVE large-gap pairs (null if none). */
  accuracyLargeGap: number | null;
  /** Among large-gap pairs resolved by exactly ONE decisive vote, fraction wrong (null if none). */
  loneDecisiveWrongRate: number | null;
}

export function computeMetrics(results: PairResult[]): ChainMetrics {
  const n = results.length;
  const decisive = results.filter((r) => r.decisive);
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  const large = results.filter((r) => r.gapKind === 'large' && r.expectedWinner != null);
  const largeDecisive = large.filter((r) => r.decisive && r.winner !== 'TIE');
  const correct = largeDecisive.filter((r) => r.winner === r.expectedWinner);
  const lone = large.filter((r) => r.decisive && r.decisiveVotes === 1 && r.winner !== 'TIE');
  const loneWrong = lone.filter((r) => r.winner !== r.expectedWinner);
  return {
    nPairs: n,
    decisiveRate: n ? decisive.length / n : 0,
    avgDepth: n ? results.reduce((s, r) => s + r.depth, 0) / n : 0,
    totalCost,
    costPerDecisive: decisive.length ? totalCost / decisive.length : 0,
    nLargeGap: large.length,
    accuracyLargeGap: largeDecisive.length ? correct.length / largeDecisive.length : null,
    loneDecisiveWrongRate: lone.length ? loneWrong.length / lone.length : null,
  };
}

/** Convenience: run a chain+rule on a set and return its metrics. */
export function analyzeChain(
  calls: RecordedCall[],
  chainModels: string[],
  rule: AggregationRule,
  cap: number = DEFAULT_ESCALATION_CAP,
): ChainMetrics {
  return computeMetrics(simulate(calls, chainModels, rule, cap));
}
