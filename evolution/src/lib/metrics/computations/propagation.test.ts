// Unit tests for propagation aggregation functions.

import {
  aggregateSum, aggregateAvg, aggregateMax, aggregateMin, aggregateCount,
  aggregateBootstrapMean,
} from './propagation';
import type { MetricRow } from '../types';

function makeRow(value: number, uncertainty: number | null = null): MetricRow {
  return {
    id: crypto.randomUUID(),
    entity_type: 'run',
    entity_id: crypto.randomUUID(),
    metric_name: 'cost',
    value,
    uncertainty,
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

  it('produces CI via standard error when n >= 2', () => {
    const result = aggregateAvg([makeRow(10), makeRow(20), makeRow(30)]);
    expect(result.ci).not.toBeNull();
    expect(result.ci![0]).toBeLessThan(20);
    expect(result.ci![1]).toBeGreaterThan(20);
    expect(result.uncertainty).not.toBeNull();
  });

  it('returns null CI for n=1', () => {
    const result = aggregateAvg([makeRow(42)]);
    expect(result.value).toBe(42);
    expect(result.ci).toBeNull();
  });

  it('returns 0 for empty (no division-by-zero)', () => {
    expect(aggregateAvg([]).value).toBe(0);
  });
});

describe('aggregateMax', () => {
  it('correct max', () => {
    expect(aggregateMax([makeRow(5), makeRow(10), makeRow(3)]).value).toBe(10);
  });

  it('propagates uncertainty from max source row', () => {
    const result = aggregateMax([makeRow(5, 2.0), makeRow(10, 3.5), makeRow(3, 1.0)]);
    expect(result.value).toBe(10);
    expect(result.uncertainty).toBe(3.5);
    expect(result.ci).toEqual([10 - 1.96 * 3.5, 10 + 1.96 * 3.5]);
  });

  it('returns null uncertainty/ci when max row has no uncertainty', () => {
    const result = aggregateMax([makeRow(5), makeRow(10), makeRow(3)]);
    expect(result.value).toBe(10);
    expect(result.uncertainty).toBeNull();
    expect(result.ci).toBeNull();
  });

  it('returns 0 for empty (safe default)', () => {
    expect(aggregateMax([]).value).toBe(0);
    expect(aggregateMax([]).n).toBe(0);
  });
});

describe('aggregateMin', () => {
  it('correct min', () => {
    expect(aggregateMin([makeRow(5), makeRow(10), makeRow(3)]).value).toBe(3);
  });

  it('propagates uncertainty from min source row', () => {
    const result = aggregateMin([makeRow(5, 2.0), makeRow(10, 3.5), makeRow(3, 1.0)]);
    expect(result.value).toBe(3);
    expect(result.uncertainty).toBe(1.0);
    expect(result.ci).toEqual([3 - 1.96 * 1.0, 3 + 1.96 * 1.0]);
  });

  it('returns 0 for empty (safe default)', () => {
    expect(aggregateMin([]).value).toBe(0);
    expect(aggregateMin([]).n).toBe(0);
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
