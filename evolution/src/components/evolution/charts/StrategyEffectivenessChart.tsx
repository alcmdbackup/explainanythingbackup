// Phase 5: horizontal bar chart of mean ELO delta per (agent, dimension) with 95% CI whiskers.
// Reads eloAttrDelta:<agent>:<dim> metric rows emitted by experimentMetrics.computeRunMetrics.

'use client';

import type { MetricValue } from '@evolution/lib/metrics/experimentMetrics';

export interface StrategyEffectivenessEntry {
  /** Display label — typically "<agent>/<dimensionValue>" or just "<dimensionValue>". */
  label: string;
  value: number;
  ci: [number, number] | null;
  n: number;
}

interface Props {
  entries: StrategyEffectivenessEntry[];
  /** Optional subtitle (e.g., "aggregated across 5 runs"). */
  subtitle?: string;
  /** Judge model name — surfaced per Phase 5 Goodhart warning. */
  judgeModel?: string;
}

export function StrategyEffectivenessChart({ entries, subtitle, judgeModel }: Props): JSX.Element {
  if (entries.length === 0) {
    return (
      <div
        className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4"
        data-testid="strategy-effectiveness-chart-empty"
      >
        <p className="text-sm font-ui text-[var(--text-muted)]">
          No attribution data yet — run a generate iteration to populate.
        </p>
      </div>
    );
  }

  // Sort by mean descending so the best strategy is on top.
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const allExtents = sorted.flatMap(e => e.ci ? [e.ci[0], e.ci[1]] : [e.value]);
  const minX = Math.min(0, ...allExtents) - 5;
  const maxX = Math.max(0, ...allExtents) + 5;
  const range = maxX - minX;

  return (
    <div
      className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4"
      data-testid="strategy-effectiveness-chart"
    >
      <h3 className="text-lg font-display font-semibold text-[var(--text-primary)] mb-1">
        Strategy Effectiveness
      </h3>
      {subtitle && (
        <p className="text-xs font-ui text-[var(--text-muted)] mb-3">{subtitle}</p>
      )}
      <div className="space-y-2">
        {sorted.map((e) => {
          const x0 = ((e.ci?.[0] ?? e.value) - minX) / range * 100;
          const x1 = ((e.ci?.[1] ?? e.value) - minX) / range * 100;
          const xMean = (e.value - minX) / range * 100;
          const zeroPct = (0 - minX) / range * 100;
          return (
            <div key={e.label} className="font-ui text-xs" data-testid="strategy-bar-row">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-[var(--text-primary)]">{e.label}</span>
                <span className="text-[var(--text-secondary)]">
                  Δ {e.value > 0 ? '+' : ''}{Math.round(e.value)}
                  {e.ci && (
                    <span className="ml-1">
                      [{e.ci[0] >= 0 ? '+' : ''}{Math.round(e.ci[0])}, {e.ci[1] >= 0 ? '+' : ''}{Math.round(e.ci[1])}]
                    </span>
                  )}
                  <span className="ml-1 text-[var(--text-muted)]">n={e.n}</span>
                </span>
              </div>
              <div className="relative h-6 bg-[var(--surface-secondary)] rounded">
                {/* zero axis */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-[var(--border-default)]"
                  style={{ left: `${zeroPct}%` }}
                />
                {/* CI band */}
                {e.ci && (
                  <div
                    className="absolute top-1 bottom-1 bg-[var(--accent-copper)] opacity-30"
                    style={{ left: `${x0}%`, width: `${Math.max(0, x1 - x0)}%` }}
                  />
                )}
                {/* mean marker */}
                <div
                  className="absolute top-0.5 bottom-0.5 w-1 bg-[var(--accent-gold)]"
                  style={{ left: `calc(${xMean}% - 2px)` }}
                  data-testid="strategy-bar-mean"
                />
              </div>
            </div>
          );
        })}
      </div>
      {judgeModel && (
        <p className="text-[10px] font-ui text-[var(--text-muted)] mt-3">
          ELO comparisons judged by <code>{judgeModel}</code> — numbers reflect judge preference, not absolute quality.
        </p>
      )}
    </div>
  );
}

/** Helper: extract StrategyEffectivenessEntry[] from a MetricsBag. */
export function extractStrategyEntries(
  metrics: Record<string, MetricValue | null | undefined>,
): StrategyEffectivenessEntry[] {
  const entries: StrategyEffectivenessEntry[] = [];
  for (const [name, value] of Object.entries(metrics)) {
    if (!value) continue;
    if (!name.startsWith('eloAttrDelta:')) continue;
    // Skip histogram rows (eloAttrDeltaHist:* starts with the same prefix).
    if (name.startsWith('eloAttrDeltaHist:')) continue;
    // name = "eloAttrDelta:<agent>:<dim>"
    const rest = name.slice('eloAttrDelta:'.length);
    const parts = rest.split(':');
    if (parts.length < 2) continue;
    const agent = parts[0]!;
    const dim = parts.slice(1).join(':');
    // Phase 5 (track_tactic_effectiveness_evolution_20260422): include the agent in
    // the bar label. Multiple agents can share a dimension value (e.g. different
    // variant-producing agents all reporting `lexical_simplify`); the previous
    // dim-only label rendered ambiguously in those cases. Keeping the agent name
    // visible disambiguates without changing the underlying data.
    entries.push({
      label: `${agent} / ${dim}`,
      value: value.value,
      ci: value.ci,
      n: value.n,
    });
  }
  return entries;
}
