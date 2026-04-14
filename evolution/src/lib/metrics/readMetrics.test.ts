// Unit tests for readMetrics functions.

import { getEntityMetrics, getMetric, getMetricsForEntities } from './readMetrics';
import type { MetricRow } from './types';

function makeRow(overrides: Partial<MetricRow> = {}): MetricRow {
  return {
    id: crypto.randomUUID(),
    entity_type: 'run',
    entity_id: '00000000-0000-0000-0000-000000000001',
    metric_name: 'cost',
    value: 1.5,
    uncertainty: null,
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
    ...overrides,
  };
}

function makeMockDb(data: MetricRow[] = [], error?: string) {
  return {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(function eqFn() {
          return {
            eq: eqFn,
            in: jest.fn(function inFn() {
              return {
                in: jest.fn(() => {
                  if (error) return { data: null, error: { message: error } };
                  return { data, error: null };
                }),
              };
            }),
            maybeSingle: jest.fn(async () => {
              if (error) return { data: null, error: { message: error } };
              return { data: data[0] ?? null, error: null };
            }),
            // Return data for getEntityMetrics (no further chaining needed)
            then: (resolve: (v: { data: MetricRow[]; error: null }) => void) => {
              resolve({ data, error: null });
            },
          };
        }),
      })),
    })),
  } as never;
}

describe('getEntityMetrics', () => {
  it('returns complete set of metrics', async () => {
    const rows = [makeRow({ metric_name: 'cost' }), makeRow({ metric_name: 'winner_elo', value: 1500 })];
    const db = makeMockDb(rows);
    const result = await getEntityMetrics(db, 'run', '00000000-0000-0000-0000-000000000001');
    expect(result).toHaveLength(2);
  });

  it('returns empty array for entity with no metrics', async () => {
    const db = makeMockDb([]);
    const result = await getEntityMetrics(db, 'run', '00000000-0000-0000-0000-000000000002');
    expect(result).toHaveLength(0);
  });
});

describe('getMetric', () => {
  it('returns correct row', async () => {
    const row = makeRow({ metric_name: 'cost', value: 2.5 });
    const db = makeMockDb([row]);
    const result = await getMetric(db, 'run', row.entity_id, 'cost');
    expect(result?.value).toBe(2.5);
  });

  it('returns null for missing metric', async () => {
    const db = makeMockDb([]);
    const result = await getMetric(db, 'run', '00000000-0000-0000-0000-000000000001', 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('getMetricsForEntities', () => {
  it('returns empty map for no entity IDs', async () => {
    const db = makeMockDb([]);
    const result = await getMetricsForEntities(db, 'run', [], ['cost']);
    expect(result.size).toBe(0);
  });

  it('returns empty map for no metric names', async () => {
    const db = makeMockDb([]);
    const result = await getMetricsForEntities(db, 'run', ['id1'], []);
    expect(result.size).toBe(0);
  });
});
