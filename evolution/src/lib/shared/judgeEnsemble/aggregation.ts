// The versioned aggregation-rule registry: first_decisive (live default),
// unanimous_among_decisive (">=2 agree"), and confidence_weighted. Pure — each rule folds
// SubVerdict[] into one ConsolidatedVerdict. Both Judge Lab and the prod ranking path import this.

import type { AggregationRule, ConsolidatedVerdict, SubVerdict, Verdict } from './types';
import { isDecisiveVote, tally } from './types';

function buildBreakdown(
  ruleId: string,
  ruleVersion: number,
  subs: SubVerdict[],
  winner: Verdict,
): ConsolidatedVerdict['breakdown'] {
  const { votesA, votesB, abstains } = tally(subs);
  const dissenters = winner === 'A' ? votesB : winner === 'B' ? votesA : 0;
  return { ruleId, ruleVersion, votesA, votesB, abstains, dissenters, members: subs };
}

/** Build a rule from a pure resolver (winner + confidence). Avoids `this` binding pitfalls. */
function rule(
  id: string,
  version: number,
  resolve: (subs: SubVerdict[]) => { winner: Verdict; confidence: number },
): AggregationRule {
  return {
    id,
    version,
    aggregate(subs) {
      const { winner, confidence } = resolve(subs);
      return { winner, confidence, breakdown: buildBreakdown(id, version, subs, winner) };
    },
  };
}

/** Decisive A/B votes in escalation order (earliest step first). */
function decisiveInOrder(subs: SubVerdict[]): SubVerdict[] {
  return subs.filter(isDecisiveVote).sort((a, b) => a.escalationStep - b.escalationStep);
}

/** first_decisive (LIVE DEFAULT): the first decisive A/B vote resolves the match; a lone
 *  decisive vote among abstentions is accepted; TIE (confidence 0) only if every judge abstained.
 *  Confident TIEs abstain (see isDecisiveVote), so a chain of `TIE, TIE, A` resolves to A. */
export const firstDecisive: AggregationRule = rule('first_decisive', 1, (subs) => {
  const first = decisiveInOrder(subs)[0];
  if (!first) return { winner: 'TIE', confidence: 0 };
  // winner is 'A' | 'B' by isDecisiveVote; confidence is the submatch's 2-pass confidence (> 0.6).
  return { winner: first.winner as Verdict, confidence: first.confidence };
});

/** unanimous_among_decisive (">=2 agree"): resolve only when >=2 decisive judges agree AND
 *  none dissent. A lone decisive vote, or a conflict, stays TIE. Used for the offline accuracy
 *  head-to-head vs first_decisive — NOT the live default. */
export const unanimousAmongDecisive: AggregationRule = rule('unanimous_among_decisive', 1, (subs) => {
  const { votesA, votesB } = tally(subs);
  if (votesA >= 2 && votesB === 0) return { winner: 'A', confidence: 1.0 };
  if (votesB >= 2 && votesA === 0) return { winner: 'B', confidence: 1.0 };
  // conflict (both sides voted) -> low-confidence TIE; otherwise no decisive signal.
  return { winner: 'TIE', confidence: votesA > 0 && votesB > 0 ? 0.5 : 0 };
});

/** confidence_weighted: sum signed (confidence * weight) over decisive votes; resolve when the
 *  margin clears a threshold. Down-weights 0.5/abstain noise; available for offline comparison. */
export const confidenceWeighted: AggregationRule = rule('confidence_weighted', 1, (subs) => {
  let scoreA = 0;
  let scoreB = 0;
  for (const s of subs) {
    if (!isDecisiveVote(s)) continue;
    if (s.winner === 'A') scoreA += s.confidence * s.weight;
    else scoreB += s.confidence * s.weight;
  }
  const margin = Math.abs(scoreA - scoreB);
  const MIN_MARGIN = 0.7;
  if (scoreA > scoreB && margin >= MIN_MARGIN) return { winner: 'A', confidence: Math.min(1, margin) };
  if (scoreB > scoreA && margin >= MIN_MARGIN) return { winner: 'B', confidence: Math.min(1, margin) };
  return { winner: 'TIE', confidence: scoreA > 0 && scoreB > 0 ? 0.5 : 0 };
});

const RULES: AggregationRule[] = [firstDecisive, unanimousAmongDecisive, confidenceWeighted];
const registry = new Map<string, AggregationRule>(RULES.map((r) => [`${r.id}@${r.version}`, r]));

/** The live production default. */
export const DEFAULT_AGGREGATION_RULE: AggregationRule = firstDecisive;

/** Resolve a rule by id@version. Throws on an unknown rule/version (fail closed). */
export function getAggregationRule(id: string, version: number): AggregationRule {
  const r = registry.get(`${id}@${version}`);
  if (!r) throw new Error(`Unknown aggregation rule "${id}@${version}"`);
  return r;
}

/** All registered rules (for offline sweeps / leaderboards). */
export function listAggregationRules(): AggregationRule[] {
  return [...RULES];
}
