// Core types for the multi-judge "escalation" ensemble: a SubVerdict is one judge's
// (or one criterion's) verdict within a match, and an AggregationRule folds SubVerdicts
// into one consolidated match verdict. Pure types + helpers — no DB/LLM/IO.

import { DECISIVE_CONFIDENCE_THRESHOLD } from '../computeRatings';

export type Verdict = 'A' | 'B' | 'TIE';

/** One judge's verdict on a matchup (or one criterion's, for criteria-split rubric mode). */
export interface SubVerdict {
  /** 'judge' = a whole-text judge (replication axis); 'criterion' = one rubric dimension. */
  sourceKind: 'judge' | 'criterion';
  /** Model name (judge) or criteria_id (criterion). */
  sourceId: string;
  /** Parsed winner; null = parse failure / errored submatch. */
  winner: Verdict | null;
  /** 2-pass fold confidence: one of 0, 0.3, 0.5, 0.7, 1.0. */
  confidence: number;
  /** Aggregation weight (1 for a plain judge panel; the criterion weight otherwise). */
  weight: number;
  /** 0-based position in the escalation chain. */
  escalationStep: number;
  /** Did this sub-verdict's indecision cause the next submatch to be dispatched? */
  triggeredEscalation: boolean;
}

/** The folded match verdict + an audit breakdown that makes it re-derivable. */
export interface ConsolidatedVerdict {
  winner: Verdict;
  confidence: number;
  breakdown: {
    ruleId: string;
    ruleVersion: number;
    /** Decisive A/B vote tallies (a confident TIE is NOT a vote — it abstains). */
    votesA: number;
    votesB: number;
    abstains: number;
    /** Decisive votes that disagree with the chosen winner. */
    dissenters: number;
    members: SubVerdict[];
  };
}

/** A versioned, pure aggregation rule. Folds SubVerdict[] into one ConsolidatedVerdict. */
export interface AggregationRule {
  id: string;
  version: number;
  aggregate(subs: SubVerdict[]): ConsolidatedVerdict;
}

/** A decisive A/B vote: winner is A or B AND confidence clears the arena decisive threshold.
 *  A confident TIE (winner='TIE', confidence 1.0) is deliberately NOT a vote — it abstains
 *  (decision 2026-06-13: a single judge's "these are equal" is not trusted; escalate instead). */
export function isDecisiveVote(s: SubVerdict): boolean {
  return (s.winner === 'A' || s.winner === 'B') && s.confidence > DECISIVE_CONFIDENCE_THRESHOLD;
}

/** Tally decisive A/B votes + abstentions across sub-verdicts. */
export function tally(subs: SubVerdict[]): { votesA: number; votesB: number; abstains: number } {
  let votesA = 0;
  let votesB = 0;
  for (const s of subs) {
    if (isDecisiveVote(s)) {
      if (s.winner === 'A') votesA += 1;
      else votesB += 1;
    }
  }
  return { votesA, votesB, abstains: subs.length - votesA - votesB };
}
