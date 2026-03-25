// Tests for the central metric catalog: validates definitions, uniqueness, and structure.

import { METRIC_CATALOG } from './metricCatalog';

describe('METRIC_CATALOG', () => {
  it('has no duplicate metric names', () => {
    const names = Object.values(METRIC_CATALOG).map(d => d.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('every entry has required fields', () => {
    for (const [key, def] of Object.entries(METRIC_CATALOG)) {
      expect(def.name).toBe(key);
      expect(def.label).toBeTruthy();
      expect(def.category).toBeTruthy();
      expect(def.formatter).toBeTruthy();
      expect(def.timing).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });

  it('timing values are valid', () => {
    const validTimings = ['during_execution', 'at_finalization', 'at_propagation'];
    for (const def of Object.values(METRIC_CATALOG)) {
      expect(validTimings).toContain(def.timing);
    }
  });

  it('formatter values are valid', () => {
    const validFormatters = ['cost', 'costDetailed', 'elo', 'score', 'percent', 'integer'];
    for (const def of Object.values(METRIC_CATALOG)) {
      expect(validFormatters).toContain(def.formatter);
    }
  });

  it('has expected number of metrics', () => {
    const count = Object.keys(METRIC_CATALOG).length;
    expect(count).toBeGreaterThanOrEqual(20);
  });

  it('cost metric is during_execution', () => {
    expect(METRIC_CATALOG.cost.timing).toBe('during_execution');
  });

  it('winner_elo is at_finalization', () => {
    expect(METRIC_CATALOG.winner_elo.timing).toBe('at_finalization');
  });

  it('run_count is at_propagation', () => {
    expect(METRIC_CATALOG.run_count.timing).toBe('at_propagation');
  });

  it('listView metrics are flagged', () => {
    const listViewMetrics = Object.values(METRIC_CATALOG).filter(
      (d): d is typeof d & { listView: true } => 'listView' in d && d.listView === true,
    );
    expect(listViewMetrics.length).toBeGreaterThan(0);
    expect(listViewMetrics.map(d => d.name)).toContain('cost');
    expect(listViewMetrics.map(d => d.name)).toContain('run_count');
  });
});
