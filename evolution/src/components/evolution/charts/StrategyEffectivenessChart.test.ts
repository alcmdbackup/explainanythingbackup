// Tests for extractStrategyEntries — Phase 5 label disambiguation
// (track_tactic_effectiveness_evolution_20260422).

import { extractStrategyEntries } from './StrategyEffectivenessChart';

describe('extractStrategyEntries', () => {
  it('returns [] for an empty metrics bag', () => {
    expect(extractStrategyEntries({})).toEqual([]);
  });

  it('renders `<agent> / <dim>` label (Phase 5 disambiguation)', () => {
    const entries = extractStrategyEntries({
      'eloAttrDelta:generate_from_previous_article:lexical_simplify': {
        value: 42, uncertainty: 10, ci: [22, 62], n: 5,
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe('generate_from_previous_article / lexical_simplify');
    expect(entries[0]!.value).toBe(42);
    expect(entries[0]!.ci).toEqual([22, 62]);
    expect(entries[0]!.n).toBe(5);
  });

  it('disambiguates when two agents share the same dimension value', () => {
    const entries = extractStrategyEntries({
      'eloAttrDelta:generate_from_previous_article:lexical_simplify': {
        value: 30, uncertainty: null, ci: null, n: 2,
      },
      'eloAttrDelta:hypothetical_future_agent:lexical_simplify': {
        value: 10, uncertainty: null, ci: null, n: 2,
      },
    });
    const labels = entries.map((e) => e.label).sort();
    expect(labels).toEqual([
      'generate_from_previous_article / lexical_simplify',
      'hypothetical_future_agent / lexical_simplify',
    ]);
  });

  it('skips eloAttrDeltaHist:* rows (histogram buckets, not delta values)', () => {
    const entries = extractStrategyEntries({
      'eloAttrDelta:generate_from_previous_article:lexical_simplify': {
        value: 42, uncertainty: null, ci: null, n: 5,
      },
      'eloAttrDeltaHist:generate_from_previous_article:lexical_simplify:0:10': {
        value: 0.5, uncertainty: null, ci: null, n: 3,
      },
      'eloAttrDeltaHist:generate_from_previous_article:lexical_simplify:10:20': {
        value: 0.5, uncertainty: null, ci: null, n: 2,
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe('generate_from_previous_article / lexical_simplify');
  });

  it('passes null CI through unchanged (single-observation case)', () => {
    const entries = extractStrategyEntries({
      'eloAttrDelta:generate_from_previous_article:structural_transform': {
        value: 100, uncertainty: null, ci: null, n: 1,
      },
    });
    expect(entries[0]!.ci).toBeNull();
    expect(entries[0]!.n).toBe(1);
  });

  it('ignores null/undefined metric values', () => {
    const entries = extractStrategyEntries({
      'eloAttrDelta:generate_from_previous_article:tacticA': null,
      'eloAttrDelta:generate_from_previous_article:tacticB': undefined,
      'eloAttrDelta:generate_from_previous_article:tacticC': {
        value: 5, uncertainty: null, ci: null, n: 1,
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe('generate_from_previous_article / tacticC');
  });

  it('handles dimension values with no colons (the common case)', () => {
    const entries = extractStrategyEntries({
      'eloAttrDelta:agent:simple_dim': { value: 1, uncertainty: null, ci: null, n: 1 },
    });
    expect(entries[0]!.label).toBe('agent / simple_dim');
  });

  it('skips malformed metric names (missing dimension)', () => {
    const entries = extractStrategyEntries({
      'eloAttrDelta:agent_only_no_dim': { value: 1, uncertainty: null, ci: null, n: 1 },
    });
    expect(entries).toEqual([]);
  });
});
