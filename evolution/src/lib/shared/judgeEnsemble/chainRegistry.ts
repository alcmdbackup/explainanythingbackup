// Built-in named escalation-chain compositions for the PRODUCTION ranking path (Phase 4). A strategy
// config's `ensembleConfigId` resolves here (in buildRunContext) to an { chain, rule } pair, which the
// ranking agents turn into an EnsembleRunner. Gated default-OFF — only consulted when the kill switch
// (EVOLUTION_JUDGE_ESCALATION_ENABLED) is on AND a strategy sets ensembleConfigId. Models are validated
// evolution model ids; the chains mirror the cheap-but-decisive compositions from the Phase 1/3 analysis.

import type { EscalationChain } from './planner';
import type { AggregationRule } from './types';
import { getAggregationRule } from './aggregation';

export interface EnsembleConfig {
  chain: EscalationChain;
  rule: AggregationRule;
}

interface ChainDef {
  chain: EscalationChain;
  ruleId: string;
  ruleVersion: number;
}

const BUILTIN_CHAINS: Record<string, ChainDef> = {
  // Cheap sequential escalation: a cheap first judge, escalate to a complementary model only when
  // indecisive (cap 3). Article chain ≈ 0.83 decisive @ ~1.0 large-gap accuracy at ~10× lower cost
  // than a single strong judge (Phase 1 analysis); folded by first_decisive (live default).
  'cheap-escalation-v1': {
    chain: {
      id: 'cheap-escalation-v1',
      cap: 3,
      models: {
        article: ['gpt-4o-mini', 'deepseek-chat'],
        paragraph: ['deepseek-v4-flash', 'gpt-4o-mini', 'deepseek-chat'],
      },
    },
    ruleId: 'first_decisive',
    ruleVersion: 1,
  },
  // Tie-breaker for the incumbent gemini-2.5-flash-lite judge (judge_acceptance_gate_phase5 analysis,
  // n=150 large-gap). Keeps gemini as the lead; escalates to gpt-4o-mini (cross-family → uncorrelated
  // errors, best partner) only when gemini abstains; paragraphs add deepseek-v4-pro to mop up the
  // residual ties (+8/−2 there; on articles a 3rd model hurts, so article stays at 2). Pareto-better
  // than gemini alone (more decisive + accurate + lower lone-wrong, ~same cost). Folded by first_decisive.
  'gemini-tiebreak-v1': {
    chain: {
      id: 'gemini-tiebreak-v1',
      cap: 3,
      models: {
        article: ['google/gemini-2.5-flash-lite', 'gpt-4o-mini'],
        paragraph: ['google/gemini-2.5-flash-lite', 'gpt-4o-mini', 'deepseek-v4-pro'],
      },
    },
    ruleId: 'first_decisive',
    ruleVersion: 1,
  },
};

/** Resolve a named ensemble config to its chain + aggregation rule. Returns null on an unknown id. */
export function resolveEnsembleConfig(id: string): EnsembleConfig | null {
  const def = BUILTIN_CHAINS[id];
  if (!def) return null;
  return { chain: def.chain, rule: getAggregationRule(def.ruleId, def.ruleVersion) };
}

/** All known ensemble config ids (for the wizard surface / validation). */
export function listEnsembleConfigIds(): string[] {
  return Object.keys(BUILTIN_CHAINS);
}
