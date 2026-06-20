// Escalation planner: the dispatch policy for the sequential judge chain. Phase 1 uses the
// pure REPLAY form (consume sub-verdicts in chain-model order, stop when the rule resolves, cap
// at N) so escalation is simulated offline with zero LLM calls. Live dispatch (Phase 2+) reuses
// the same stop condition with a makeJudge(model)=>JudgeFn runner.

import type { AggregationRule, ConsolidatedVerdict, SubVerdict } from './types';
import type { ComparisonMode } from '../computeRatings';

/** Default cap on chain length (judges per match). */
export const DEFAULT_ESCALATION_CAP = 3;

/** A mode-aware escalation ladder: the ordered judge models to try per comparison mode. */
export interface EscalationChain {
  id: string;
  cap: number;
  models: Record<ComparisonMode, string[]>;
}

export interface EscalationReplayResult {
  consolidated: ConsolidatedVerdict;
  /** The submatches that actually ran (chain prefix), with escalationStep/triggeredEscalation set. */
  used: SubVerdict[];
  depth: number;
}

/** Resolve the ordered judge models for a comparison mode. */
export function resolveChainModels(chain: EscalationChain, mode: ComparisonMode): string[] {
  return chain.models[mode] ?? [];
}

/** Replay an escalation chain over already-available sub-verdicts (in chain-model order).
 *  Stops as soon as the aggregation rule resolves (winner !== 'TIE'), or at the cap / end of input.
 *  Returns the consolidated verdict plus the chain prefix that actually "ran". Pure. */
export function replayEscalation(
  available: SubVerdict[],
  rule: AggregationRule,
  cap: number = DEFAULT_ESCALATION_CAP,
): EscalationReplayResult {
  const used: SubVerdict[] = [];
  let resolved: ConsolidatedVerdict | null = null;
  for (const candidate of available) {
    if (used.length >= cap) break;
    used.push({ ...candidate, escalationStep: used.length, triggeredEscalation: false });
    const agg = rule.aggregate(used);
    if (agg.winner !== 'TIE') {
      resolved = agg;
      break;
    }
  }
  // Every used submatch except the last triggered the next escalation.
  for (let i = 0; i < used.length - 1; i += 1) {
    const s = used[i];
    if (s) s.triggeredEscalation = true;
  }
  const consolidated = resolved ?? rule.aggregate(used);
  consolidated.breakdown.members = used; // reflect the final flags
  return { consolidated, used, depth: used.length };
}
