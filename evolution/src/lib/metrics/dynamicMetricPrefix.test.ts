// Verifies that the Phase 5 dynamic metric prefixes are accepted by isValidMetricName.
// Guards against silent rejection by writeMetrics when a new prefix isn't whitelisted.

import { isValidMetricName } from './registry';

describe('isValidMetricName — dynamic prefix whitelisting', () => {
  it('accepts agentCost:<name> (pre-existing)', () => {
    expect(isValidMetricName('run', 'agentCost:generation')).toBe(true);
    expect(isValidMetricName('run', 'agentCost:generate_from_previous_article')).toBe(true);
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
