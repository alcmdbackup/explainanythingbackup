// Verifies that the Phase 5 dynamic metric prefixes are accepted by isValidMetricName.
// Guards against silent rejection by writeMetrics when a new prefix isn't whitelisted.

import { isValidMetricName } from './registry';

describe('isValidMetricName — dynamic prefix whitelisting', () => {
  it('accepts subagent:<path>.<measure> (rename_agents_subagents_evolution_20260508 Phase 3)', () => {
    expect(isValidMetricName('run', 'subagent:reflection.cost')).toBe(true);
    expect(isValidMetricName('run', 'subagent:generation.duration_ms')).toBe(true);
    expect(isValidMetricName('run', 'subagent:ranking.count')).toBe(true);
    expect(isValidMetricName('strategy', 'subagent:cycle.propose.cost')).toBe(true);
  });

  it('rejects the removed agentCost: prefix (Phase 6)', () => {
    expect(isValidMetricName('run', 'agentCost:generation')).toBe(false);
  });

  it('accepts eloAttrDelta:<agent>:<dim> (Phase 5)', () => {
    expect(isValidMetricName('run', 'eloAttrDelta:generate_from_previous_article:lexical_simplify')).toBe(true);
    expect(isValidMetricName('strategy', 'eloAttrDelta:foo:bar')).toBe(true);
    expect(isValidMetricName('experiment', 'eloAttrDelta:x:y')).toBe(true);
  });

  it('accepts eloAttrDeltaHist:<agent>:<dim>:<lo>:<hi> (Phase 5 histogram)', () => {
    expect(isValidMetricName('run', 'eloAttrDeltaHist:generate_from_previous_article:lexical_simplify:-10:0')).toBe(true);
    expect(isValidMetricName('run', 'eloAttrDeltaHist:foo:bar:ltmin:-40')).toBe(true);
    expect(isValidMetricName('run', 'eloAttrDeltaHist:foo:bar:40:gtmax')).toBe(true);
  });

  it('accepts known static metrics', () => {
    expect(isValidMetricName('run', 'cost')).toBe(true);
    expect(isValidMetricName('run', 'winner_elo')).toBe(true);
    expect(isValidMetricName('invocation', 'elo_delta_vs_parent')).toBe(true);
  });

  it('rejects unknown metric names', () => {
    expect(isValidMetricName('run', 'totally_made_up_metric')).toBe(false);
    expect(isValidMetricName('run', 'unknownPrefix:foo')).toBe(false);
  });
});
