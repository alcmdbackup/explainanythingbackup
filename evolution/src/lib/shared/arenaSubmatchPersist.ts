// Persistence for PRODUCTION ensemble matches (Phase 4): map a match's EnsembleSubmatches onto
// evolution_arena_submatches (+ per-dimension evolution_submatch_dimension_verdicts) rows, and the
// parent summary columns on evolution_arena_comparisons. The row-building is pure (an id generator is
// injected so tests are deterministic); the DB insert is a thin wrapper. Mirrors the Judge Lab
// escalationPersist/dimensionVerdictRows shapes, in the evolution_arena_* tables.

import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reconcilePasses } from './rubricJudge';
import type { EnsembleSubmatches } from './computeRatings';

export type MatchVerdict = 'A' | 'B' | 'TIE';

export interface ArenaSubmatchRow {
  id: string;
  arena_comparison_id: string;
  judge_model: string;
  escalation_step: number;
  triggered_escalation: boolean;
  winner: string | null;
  confidence: number | null;
  chain_config_id: string | null;
  judge_rubric_id: string | null;
}

export interface ArenaSubmatchDimensionRow {
  submatch_id: string;
  criteria_id: string | null;
  criteria_name: string;
  weight: number;
  forward_verdict: string | null;
  reverse_verdict: string | null;
  dimension_winner: string | null;
  favored_match_winner: boolean | null;
  position: number;
}

/** Parent summary columns to merge onto the evolution_arena_comparisons row. */
export interface ArenaParentSummary {
  chain_depth: number;
  agreement: number | null;
  aggregation_rule: string;
  aggregation_rule_version: number;
}

export interface ArenaSubmatchPersistence {
  parent: ArenaParentSummary;
  submatchRows: ArenaSubmatchRow[];
  dimensionRows: ArenaSubmatchDimensionRow[];
}

/** Agreement = fraction of DECISIVE submatches (A/B winner, confidence > 0.6) that favored the
 *  consolidated match winner. Null when no submatch was decisive (or the match is a TIE). */
function computeAgreement(ensemble: EnsembleSubmatches, matchWinner: MatchVerdict): number | null {
  if (matchWinner === 'TIE') return null;
  const decisive = ensemble.members.filter((m) => (m.winner === 'A' || m.winner === 'B') && m.confidence > 0.6);
  if (decisive.length === 0) return null;
  const favoring = decisive.filter((m) => m.winner === matchWinner).length;
  return favoring / decisive.length;
}

/** Build the submatch + dimension rows + parent summary for one ensemble match. Pure over `genId`
 *  (randomUUID in prod). `favored_match_winner` is relative to the consolidated MATCH winner
 *  (ensemble.matchWinner, in the submatch/dimension A/B frame — mirrors the Judge Lab breakout). */
export function buildArenaSubmatchPersistence(
  comparisonId: string,
  ensemble: EnsembleSubmatches,
  genId: () => string = randomUUID,
): ArenaSubmatchPersistence {
  const matchWinner: MatchVerdict = ensemble.matchWinner;
  const submatchRows: ArenaSubmatchRow[] = [];
  const dimensionRows: ArenaSubmatchDimensionRow[] = [];

  for (const m of ensemble.members) {
    const submatchId = genId();
    submatchRows.push({
      id: submatchId,
      arena_comparison_id: comparisonId,
      judge_model: m.model,
      escalation_step: m.escalationStep,
      triggered_escalation: m.triggeredEscalation,
      winner: m.winner,
      confidence: m.confidence,
      chain_config_id: ensemble.chainConfigId,
      judge_rubric_id: m.rubricBreakdown?.rubricId ?? null,
    });
    if (m.rubricBreakdown) {
      m.rubricBreakdown.dimensions.forEach((d, i) => {
        const dimWinner = reconcilePasses(d.forwardVerdict, d.reverseVerdict).winner;
        dimensionRows.push({
          submatch_id: submatchId,
          criteria_id: d.criteriaId,
          criteria_name: d.name,
          weight: d.weight,
          forward_verdict: d.forwardVerdict,
          reverse_verdict: d.reverseVerdict,
          dimension_winner: dimWinner,
          favored_match_winner: dimWinner === 'TIE' ? null : dimWinner === matchWinner,
          position: i,
        });
      });
    }
  }

  return {
    parent: {
      chain_depth: ensemble.members.length,
      agreement: computeAgreement(ensemble, matchWinner),
      aggregation_rule: ensemble.ruleId,
      aggregation_rule_version: ensemble.ruleVersion,
    },
    submatchRows,
    dimensionRows,
  };
}

/** Insert the accumulated submatch + dimension rows (best-effort: caller logs on error). The CASCADE
 *  from evolution_arena_comparisons handles deletion, so re-runs that replace comparisons are clean. */
export async function insertArenaSubmatches(
  db: SupabaseClient,
  submatchRows: ArenaSubmatchRow[],
  dimensionRows: ArenaSubmatchDimensionRow[],
): Promise<void> {
  if (submatchRows.length > 0) {
    const { error } = await db.from('evolution_arena_submatches').insert(submatchRows);
    if (error) throw error;
  }
  if (dimensionRows.length > 0) {
    const { error } = await db.from('evolution_submatch_dimension_verdicts').insert(dimensionRows);
    if (error) throw error;
  }
}
