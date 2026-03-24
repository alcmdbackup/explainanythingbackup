// Unit tests for propagation aggregation functions.

import {
  aggregateSum, aggregateAvg, aggregateMax, aggregateMin, aggregateCount,
  aggregateBootstrapMean,
} from './propagation';
import type { MetricRow } from '../types';

function makeRow(value: number, sigma: number | null = null): MetricRow {
  return {
    id: crypto.randomUUID(),
    entity_type: 'run',
    entity_id: crypto.randomUUID(),
    metric_name: 'cost',
    value,
    sigma,
    ci_lower: null,
    ci_upper: null,
    n: 1,
    origin_entity_type: null,
    origin_entity_id: null,
    aggregation_method: null,
    source: 'pipeline',
    stale: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

describe('aggregateSum', () => {
  it('correct for multiple rows', () => {
    const result = aggregateSum([makeRow(1.5), makeRow(2.5), makeRow(3.0)]);
    expect(result.value).toBe(7);
    expect(result.n).toBe(3);
  });

  it('returns 0 for empty', () => {
    expect(aggregateSum([]).value).toBe(0);
  });
});

describe('aggregateAvg', () => {
  it('correct average', () => {
    const result = aggregateAvg([makeRow(10), makeRow(20), makeRow(30)]);
    expect(result.value).toBe(20);
    expect(result.n).toBe(3);
  });

  it('returns 0 for empty (no division-by-zero)', () => {
    expect(aggregateAvg([]).value).toBe(0);
  });
});

describe('aggregateMax', () => {
  it('correct max', () => {
    expect(aggregateMax([makeRow(5), makeRow(10), makeRow(3)]).value).toBe(10);
  });

  it('returns -Infinity for empty', () => {
    expect(aggregateMax([]).value).toBe(-Infinity);
  });
});

describe('aggregateMin', () => {
  it('correct min', () => {
    expect(aggregateMin([makeRow(5), makeRow(10), makeRow(3)]).value).toBe(3);
  });

  it('returns Infinity for empty', () => {
    expect(aggregateMin([]).value).toBe(Infinity);
  });
});

describe('aggregateCount', () => {
  it('returns row count', () => {
    expect(aggregateCount([makeRow(1), makeRow(2)]).value).toBe(2);
  });
});

describe('aggregateBootstrapMean', () => {
  it('returns MetricValue with CI bounds for 2+ values', () => {
    const rows = [makeRow(100), makeRow(200), makeRow(300)];
    const result = aggregateBootstrapMean(rows);
    expect(result.value).toBe(200);
    expect(result.n).toBe(3);
    expect(result.ci).not.toBeNull();
    expect(result.ci![0]).toBeLessThan(result.ci![1]);
  });

  it('returns null CI for 1 value', () => {
    const result = aggregateBootstrapMean([makeRow(42)]);
    expect(result.value).toBe(42);
    expect(result.ci).toBeNull();
  });
});
