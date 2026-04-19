// Shared UI block that renders StrategyEffectivenessChart + EloDeltaHistogram for a run,
// strategy, or experiment. Reads eloAttrDelta:* / eloAttrDeltaHist:* rows from
// evolution_metrics via getEntityMetricsAction and extracts per-(agent, dimension) entries.
//
// Renders nothing when there's no attribution data (keeps the detail page clean for
// entities that never had a variant-producing generate iteration).

'use client';

import { useEffect, useMemo, useState } from 'react';

import { getEntityMetricsAction } from '@evolution/services/metricsActions';
import type { MetricRow } from '@evolution/lib/metrics/types';
import type { EntityType } from '@evolution/lib/core/types';
import {
  StrategyEffectivenessChart,
  extractStrategyEntries,
} from '@evolution/components/evolution/charts/StrategyEffectivenessChart';
import { EloDeltaHistogram } from '@evolution/components/evolution/charts/EloDeltaHistogram';
import type { MetricValue } from '@evolution/lib/metrics/experimentMetrics';

interface Props {
  entityType: EntityType;
  entityId: string;
  subtitle?: string;
  judgeModel?: string;
}

function rowToMetricValue(row: MetricRow): MetricValue {
  return {
    value: row.value,
    uncertainty: row.uncertainty,
    ci: (row.ci_lower != null && row.ci_upper != null) ? [row.ci_lower, row.ci_upper] : null,
    n: row.n,
  };
}

export function AttributionCharts({ entityType, entityId, subtitle, judgeModel }: Props): JSX.Element | null {
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getEntityMetricsAction(entityType, entityId)
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) setRows(res.data);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  // Index metrics by name for the chart extractors.
  const byName = useMemo(() => {
    const m: Record<string, MetricValue> = {};
    for (const r of rows) {
      if (r.metric_name.startsWith('eloAttrDelta:') || r.metric_name.startsWith('eloAttrDeltaHist:')) {
        m[r.metric_name] = rowToMetricValue(r);
      }
    }
    return m;
  }, [rows]);

  // Strategy-breakdown entries.
  const entries = useMemo(() => extractStrategyEntries(byName), [byName]);

  // Histogram: aggregate across all (agent, dim) combos into one overall distribution.
  // (Per-strategy filter left as a follow-up — the aggregate view matches the plan default.)
  const histogramAgg = useMemo(() => {
    const buckets: Array<{ label: string; lo: number; hi: number; fraction: number; count: number }> = [];
    let total = 0;
    const totals = new Map<string, { lo: number; hi: number; count: number }>();
    for (const [name, value] of Object.entries(byName)) {
      if (!name.startsWith('eloAttrDeltaHist:')) continue;
      // eloAttrDeltaHist:<agent>:<dim>:<lo>:<hi>
      const parts = name.slice('eloAttrDeltaHist:'.length).split(':');
      if (parts.length < 4) continue;
      const loStr = parts[parts.length - 2]!;
      const hiStr = parts[parts.length - 1]!;
      const lo = loStr === 'ltmin' ? -Infinity : Number(loStr);
      const hi = hiStr === 'gtmax' ? Infinity : Number(hiStr);
      if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
      const key = `${lo}:${hi}`;
      const prior = totals.get(key) ?? { lo, hi, count: 0 };
      totals.set(key, { lo, hi, count: prior.count + value.n });
      total += value.n;
    }
    for (const { lo, hi, count } of totals.values()) {
      buckets.push({
        label: lo === -Infinity ? `≤${hi}` : hi === Infinity ? `≥${lo}` : `[${lo},${hi})`,
        lo, hi,
        fraction: total > 0 ? count / total : 0,
        count,
      });
    }
    return { buckets, total };
  }, [byName]);

  if (loading) return null;
  if (entries.length === 0 && histogramAgg.total === 0) return null;

  return (
    <div className="space-y-4" data-testid="attribution-charts">
      {entries.length > 0 && (
        <StrategyEffectivenessChart entries={entries} subtitle={subtitle} judgeModel={judgeModel} />
      )}
      {histogramAgg.total > 0 && (
        <EloDeltaHistogram buckets={histogramAgg.buckets} subtitle={subtitle} total={histogramAgg.total} />
      )}
    </div>
  );
}
