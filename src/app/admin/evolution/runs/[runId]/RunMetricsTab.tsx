// Run metrics tab: V2 does not support per-run metrics.
// Shows a simplified empty state directing users to experiment-level metrics.

'use client';

export function RunMetricsTab({ runId }: { runId: string }) {
  return (
    <div className="text-sm text-[var(--text-muted)] py-8 text-center" data-testid="run-metrics-tab">
      <p>Per-run metrics are not available in V2.</p>
      <p className="mt-1 text-xs">
        View experiment-level metrics from the experiment detail page for aggregated analysis.
      </p>
      <p className="mt-2 text-xs font-mono text-[var(--text-muted)]">Run: {runId.slice(0, 8)}</p>
    </div>
  );
}
