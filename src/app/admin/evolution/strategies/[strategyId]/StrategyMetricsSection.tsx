// Strategy metrics section: V2 does not support per-strategy metrics or action distribution.
// Shows a simplified empty state.

'use client';

export function StrategyMetricsSection({ strategyConfigId }: { strategyConfigId: string }) {
  return (
    <div className="p-4 text-xs font-body text-[var(--text-muted)]">
      <p>Strategy-level metrics are not available in V2.</p>
      <p className="mt-1">View experiment-level metrics from the experiment detail page instead.</p>
      <p className="mt-2 font-mono">Strategy: {strategyConfigId.slice(0, 8)}</p>
    </div>
  );
}
