// Unit tests for the pure ensemble-match persistence mapper (Phase 4). Deterministic ids injected.

import { buildArenaSubmatchPersistence } from './arenaSubmatchPersist';
import type { EnsembleSubmatches } from './computeRatings';
import type { RubricBreakdown } from './rubricJudge';

function genIds(): () => string {
  let i = 0;
  return () => `sub-${i++}`;
}

const RUBRIC_BREAKDOWN: RubricBreakdown = {
  rubricId: 'rub-1',
  dimensions: [
    { criteriaId: 'c1', name: 'clarity', weight: 0.5, forwardVerdict: 'A', reverseVerdict: 'A' }, // -> A
    { criteriaId: 'c2', name: 'depth', weight: 0.5, forwardVerdict: 'A', reverseVerdict: 'B' }, // -> TIE
  ],
  forwardPass: { scoreA: 1, scoreB: 0, winner: 'A' },
  reversePass: { scoreA: 0.5, scoreB: 0.5, winner: 'TIE' },
  overall: { winner: 'A', confidence: 1.0 },
};

describe('buildArenaSubmatchPersistence', () => {
  it('maps a 2-judge escalation (holistic) to submatch rows + parent summary', () => {
    const ensemble: EnsembleSubmatches = {
      chainConfigId: 'chain-1',
      ruleId: 'first_decisive',
      ruleVersion: 1,
      matchWinner: 'B',
      members: [
        { model: 'm1', escalationStep: 0, triggeredEscalation: true, winner: 'TIE', confidence: 0.5 },
        { model: 'm2', escalationStep: 1, triggeredEscalation: false, winner: 'B', confidence: 1.0 },
      ],
    };
    const { parent, submatchRows, dimensionRows } = buildArenaSubmatchPersistence('cmp-1', ensemble, genIds());
    expect(submatchRows).toHaveLength(2);
    expect(submatchRows.map((r) => r.judge_model)).toEqual(['m1', 'm2']);
    expect(submatchRows.every((r) => r.arena_comparison_id === 'cmp-1')).toBe(true);
    expect(submatchRows.every((r) => r.chain_config_id === 'chain-1')).toBe(true);
    expect(dimensionRows).toHaveLength(0); // holistic -> no dimension rows
    expect(parent.chain_depth).toBe(2);
    expect(parent.aggregation_rule).toBe('first_decisive');
    expect(parent.aggregation_rule_version).toBe(1);
    // only m2 is decisive (B@1.0); it favored the match winner B -> agreement 1.0
    expect(parent.agreement).toBe(1.0);
  });

  it('emits per-dimension rows for a rubric submatch with favored_match_winner vs the match winner', () => {
    const ensemble: EnsembleSubmatches = {
      chainConfigId: 'chain-1',
      ruleId: 'criteria_weighted',
      ruleVersion: 1,
      matchWinner: 'A',
      members: [
        { model: 'm1', escalationStep: 0, triggeredEscalation: false, winner: 'A', confidence: 1.0, rubricBreakdown: RUBRIC_BREAKDOWN },
      ],
    };
    const { submatchRows, dimensionRows } = buildArenaSubmatchPersistence('cmp-2', ensemble, genIds());
    expect(submatchRows).toHaveLength(1);
    expect(submatchRows[0]?.judge_rubric_id).toBe('rub-1');
    expect(dimensionRows).toHaveLength(2);
    expect(dimensionRows[0]).toMatchObject({
      submatch_id: 'sub-0',
      criteria_name: 'clarity',
      dimension_winner: 'A',
      favored_match_winner: true, // clarity -> A == matchWinner A
      position: 0,
    });
    expect(dimensionRows[1]).toMatchObject({
      criteria_name: 'depth',
      dimension_winner: 'TIE',
      favored_match_winner: null, // TIE -> null
      position: 1,
    });
  });

  it('agreement is null when no submatch was decisive', () => {
    const ensemble: EnsembleSubmatches = {
      chainConfigId: 'chain-1', ruleId: 'first_decisive', ruleVersion: 1, matchWinner: 'TIE',
      members: [{ model: 'm1', escalationStep: 0, triggeredEscalation: false, winner: 'TIE', confidence: 0.5 }],
    };
    expect(buildArenaSubmatchPersistence('cmp-3', ensemble, genIds()).parent.agreement).toBeNull();
  });
});
