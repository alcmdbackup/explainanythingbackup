// Phase 5: fixed 10-ELO-bucket histogram of per-invocation ELO delta distribution.
// Reads eloAttrDeltaHist:<agent>:<dim>:<lo>:<hi> metric rows.

'use client';

import type { MetricValue } from '@evolution/lib/metrics/experimentMetrics';

export interface HistogramBucket {
  label: string;
  lo: number;
  hi: number;
  fraction: number;
  count: number;
}

interface Props {
  buckets: HistogramBucket[];
  subtitle?: string;
  total: number;
}

// Fixed bucket ordering matches HISTOGRAM_BUCKETS in experimentMetrics.
const BUCKET_ORDER: Array<[number, number]> = [
  [-Infinity, -40],
  [-40, -30], [-30, -20], [-20, -10], [-10, 0],
  [0, 10], [10, 20], [20, 30], [30, 40],
  [40, Infinity],
];

function formatBucketLabel(lo: number, hi: number): string {
  if (lo === -Infinity) return `≤ ${hi}`;
  if (hi === Infinity) return `≥ ${lo}`;
  return `[${lo}, ${hi})`;
}

export function EloDeltaHistogram({ buckets, subtitle, total }: Props): JSX.Element {
  if (total === 0 || buckets.length === 0) {
    return (
      <div
        className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4"
        data-testid="elo-delta-histogram-empty"
      >
        <p className="text-sm font-ui text-[var(--text-muted)]">
          No invocations yet — histogram will populate as attribution data arrives.
        </p>
      </div>
    );
  }

  // Build the full ordered set (including empty buckets for visual consistency).
  const bucketMap = new Map(buckets.map(b => [`${b.lo}:${b.hi}`, b]));
  const ordered = BUCKET_ORDER.map(([lo, hi]) => {
    const key = `${lo === -Infinity ? '-Infinity' : lo}:${hi === Infinity ? 'Infinity' : hi}`;
    return bucketMap.get(key) ?? {
      label: formatBucketLabel(lo, hi),
      lo, hi, fraction: 0, count: 0,
    };
  });

  const maxFraction = Math.max(...ordered.map(b => b.fraction), 0.01);

  return (
    <div
      className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4"
      data-testid="elo-delta-histogram"
    >
      <h3 className="text-lg font-display font-semibold text-[var(--text-primary)] mb-1">
        ELO Δ Distribution
      </h3>
      {subtitle && (
        <p className="text-xs font-ui text-[var(--text-muted)] mb-3">{subtitle}</p>
      )}
      <p className="text-[10px] font-ui text-[var(--text-muted)] mb-2">n = {total} invocations</p>
      <div className="flex items-end gap-1 h-32">
        {ordered.map((b, i) => {
          const heightPct = Math.max(1, (b.fraction / maxFraction) * 100);
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-1"
              data-testid="histogram-bucket"
              title={`${formatBucketLabel(b.lo, b.hi)} · ${b.count} invocations (${Math.round(b.fraction * 100)}%)`}
            >
              <div
                className="w-full bg-[var(--accent-gold)] rounded-t"
                style={{ height: `${heightPct}%`, minHeight: '2px' }}
              />
              <span className="text-[8px] font-mono text-[var(--text-muted)] whitespace-nowrap">
                {b.lo === -Infinity ? `≤${b.hi}` : b.hi === Infinity ? `≥${b.lo}` : `${b.lo}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Helper: extract HistogramBucket[] for a specific (agent, dimension) from a MetricsBag. */
export function extractHistogramBuckets(
  metrics: Record<string, MetricValue | null | undefined>,
  agent: string,
  dim: string,
): { buckets: HistogramBucket[]; total: number } {
  const prefix = `eloAttrDeltaHist:${agent}:${dim}:`;
  const buckets: HistogramBucket[] = [];
  let total = 0;
  for (const [name, value] of Object.entries(metrics)) {
    if (!value) continue;
    if (!name.startsWith(prefix)) continue;
    const rest = name.slice(prefix.length);
    const [loStr, hiStr] = rest.split(':');
    if (loStr == null || hiStr == null) continue;
    const lo = loStr === 'ltmin' ? -Infinity : Number(loStr);
    const hi = hiStr === 'gtmax' ? Infinity : Number(hiStr);
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    buckets.push({
      label: formatBucketLabel(lo, hi),
      lo, hi,
      fraction: value.value,
      count: value.n,
    });
    total += value.n;
  }
  return { buckets, total };
}
