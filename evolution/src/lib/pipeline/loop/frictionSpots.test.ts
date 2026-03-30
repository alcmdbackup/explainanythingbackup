// Unit tests for friction spots helper — extraction and formatting.

import { getVariantFrictionSpots, formatFrictionSpots } from './frictionSpots';
import type { Match } from '../../types';

function makeMatch(a: string, b: string, frictionSpots?: { a: string[]; b: string[] }): Match {
  return {
    variationA: a,
    variationB: b,
    winner: a,
    confidence: 0.8,
    turns: 1,
    dimensionScores: {},
    frictionSpots,
  };
}

describe('getVariantFrictionSpots', () => {
  it('returns empty array when no matches have friction spots', () => {
    const matches = [makeMatch('v1', 'v2'), makeMatch('v1', 'v3')];
    expect(getVariantFrictionSpots('v1', matches)).toEqual([]);
  });

  it('collects spots when variant is variationA', () => {
    const matches = [
      makeMatch('v1', 'v2', { a: ['weak intro', 'abrupt ending'], b: ['too verbose'] }),
    ];
    expect(getVariantFrictionSpots('v1', matches)).toEqual(['weak intro', 'abrupt ending']);
  });

  it('collects spots when variant is variationB', () => {
    const matches = [
      makeMatch('v1', 'v2', { a: ['weak intro'], b: ['too verbose', 'missing examples'] }),
    ];
    expect(getVariantFrictionSpots('v2', matches)).toEqual(['too verbose', 'missing examples']);
  });

  it('aggregates across multiple matches', () => {
    const matches = [
      makeMatch('v1', 'v2', { a: ['weak intro'], b: [] }),
      makeMatch('v1', 'v3', { a: ['choppy transitions'], b: ['unclear thesis'] }),
    ];
    expect(getVariantFrictionSpots('v1', matches)).toEqual(['weak intro', 'choppy transitions']);
  });

  it('deduplicates identical friction spots', () => {
    const matches = [
      makeMatch('v1', 'v2', { a: ['weak intro'], b: [] }),
      makeMatch('v1', 'v3', { a: ['weak intro', 'new issue'], b: [] }),
    ];
    expect(getVariantFrictionSpots('v1', matches)).toEqual(['weak intro', 'new issue']);
  });

  it('returns empty array for variant not in any match', () => {
    const matches = [
      makeMatch('v1', 'v2', { a: ['weak intro'], b: ['too verbose'] }),
    ];
    expect(getVariantFrictionSpots('v99', matches)).toEqual([]);
  });

  it('handles empty match history', () => {
    expect(getVariantFrictionSpots('v1', [])).toEqual([]);
  });
});

describe('formatFrictionSpots', () => {
  it('returns empty string for empty array', () => {
    expect(formatFrictionSpots([])).toBe('');
  });

  it('formats spots as bullet list with header', () => {
    const result = formatFrictionSpots(['weak intro', 'abrupt ending']);
    expect(result).toContain('Known Friction Points');
    expect(result).toContain('- weak intro');
    expect(result).toContain('- abrupt ending');
  });

  it('includes guidance to address friction points', () => {
    const result = formatFrictionSpots(['issue']);
    expect(result).toContain('pay special attention');
  });
});
