// Tests for createMetricColumns — particularly the Phase 4d CI-rendering behavior.

import { createMetricColumns, createRunsMetricColumns } from './metricColumns';
import type { MetricRow } from './types';

function baseRow(overrides: Partial<MetricRow>): MetricRow {
  return {
    entity_type: 'strategy',
    entity_id: '00000000-0000-0000-0000-000000000001',
    metric_name: 'avg_final_elo',
    value: 1350,
    uncertainty: null,
    ci_lower: null,
    ci_upper: null,
    n: 5,
    source: 'at_propagation',
    stale: false,
    aggregation_method: 'bootstrap_mean',
    origin_entity_type: null,
    origin_entity_id: null,
    ...overrides,
  } as MetricRow;
}

describe('createMetricColumns — Phase 4d aggregate CI rendering', () => {
  it('renders bootstrap-aggregated Elo metric with [lo, hi] CI suffix when ci_lower/ci_upper populated', () => {
    const columns = createMetricColumns<{ metrics: MetricRow[] }>('strategy');
    const col = columns.find(c => c.key === 'metric_avg_final_elo');
    expect(col).toBeDefined();

    const row = baseRow({ metric_name: 'avg_final_elo', value: 1350, ci_lower: 1320, ci_upper: 1380 });
    const rendered = col!.render!({ metrics: [row] });
    const text = typeof rendered === 'string' ? rendered : String(rendered);
    // Elo formatter → value; CI appended as "[lo, hi]" because avg_final_elo uses bootstrap_mean.
    expect(text).toContain('1350');
    expect(text).toContain('[1320, 1380]');
  });

  it('renders bootstrap_percentile metric (best_final_elo = max) WITHOUT CI since max has no CI semantics', () => {
    const columns = createMetricColumns<{ metrics: MetricRow[] }>('strategy');
    const col = columns.find(c => c.key === 'metric_best_final_elo');
    if (!col) return; // Depending on registry, may be absent.

    const row = baseRow({
      metric_name: 'best_final_elo',
      value: 1500,
      ci_lower: 1480, ci_upper: 1520,
      aggregation_method: 'max',
    });
    const rendered = col.render!({ metrics: [row] });
    const text = typeof rendered === 'string' ? rendered : String(rendered);
    // max aggregation has no CI — suffix should not appear.
    expect(text).not.toContain('[');
    expect(text).toContain('1500');
  });

  it('renders avg (non-bootstrap) propagated metric with ± half-width CI when row carries ci_lower/upper', () => {
    const columns = createMetricColumns<{ metrics: MetricRow[] }>('strategy');
    const col = columns.find(c => c.key === 'metric_avg_cost_estimation_error_pct');
    expect(col).toBeDefined();

    const row = baseRow({
      metric_name: 'avg_cost_estimation_error_pct',
      value: 12.5,
      ci_lower: 10, ci_upper: 15,
      aggregation_method: 'avg',
    });
    const rendered = col!.render!({ metrics: [row] });
    const text = typeof rendered === 'string' ? rendered : String(rendered);
    // Percent formatter with avg → ± (hi-lo)/2 suffix.
    expect(text).toMatch(/±/);
  });

  it('does NOT append CI when ci_lower/ci_upper are null (backward compat with legacy rows)', () => {
    const columns = createMetricColumns<{ metrics: MetricRow[] }>('strategy');
    const col = columns.find(c => c.key === 'metric_avg_final_elo');
    expect(col).toBeDefined();

    const row = baseRow({ metric_name: 'avg_final_elo', value: 1350, ci_lower: null, ci_upper: null });
    const rendered = col!.render!({ metrics: [row] });
    const text = typeof rendered === 'string' ? rendered : String(rendered);
    expect(text).toBe('1350');
    expect(text).not.toMatch(/[\[±]/);
  });

  it('returns em-dash when metric row is absent (no CI to render)', () => {
    const columns = createMetricColumns<{ metrics: MetricRow[] }>('strategy');
    const col = columns.find(c => c.key === 'metric_avg_final_elo');
    expect(col).toBeDefined();

    const rendered = col!.render!({ metrics: [] });
    expect(rendered).toBe('—');
  });
});

describe('createRunsMetricColumns — Phase 4d (run list CI rendering)', () => {
  it('does not render CI for direct run-level metrics (no propagation aggregation)', () => {
    const columns = createRunsMetricColumns<{ metrics: MetricRow[] }>();
    const col = columns.find(c => c.key === 'metric_cost');
    if (!col) return; // cost may or may not be listView depending on registry.

    const row = baseRow({
      entity_type: 'run',
      metric_name: 'cost',
      value: 0.02,
      // Even if CI columns were somehow populated, run-level `cost` isn't a propagated metric.
      ci_lower: 0.01, ci_upper: 0.03,
      aggregation_method: null as unknown as MetricRow['aggregation_method'],
    });
    const rendered = col.render!({ metrics: [row] } as unknown as { metrics: MetricRow[] });
    // Rendered is a React element — extract its string. The CI must NOT appear.
    const el = rendered as { props?: { children?: string } };
    const text = typeof el === 'string' ? el : (el.props?.children ?? '');
    expect(text).not.toMatch(/[\[±]/);
  });
});
