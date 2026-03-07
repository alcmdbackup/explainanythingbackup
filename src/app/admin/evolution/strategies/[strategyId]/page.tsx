// Strategy detail page: shows config, performance stats, and run history for a single strategy.
// Server component fetches strategy details, client components render tabs.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getStrategyDetailAction } from '@evolution/services/strategyRegistryActions';
import { getStrategyRunsAction, type StrategyRunEntry } from '@evolution/services/eloBudgetActions';
import { StrategyConfigDisplay } from '../../analysis/_components/StrategyConfigDisplay';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';

interface Props {
  params: Promise<{ strategyId: string }>;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--status-success)',
  archived: 'var(--text-muted)',
};

const RUN_STATUS_COLORS: Record<string, string> = {
  completed: 'var(--status-success)',
  failed: 'var(--status-error)',
  running: 'var(--accent-gold)',
  pending: 'var(--text-muted)',
  claimed: 'var(--accent-gold)',
};

export default async function StrategyDetailPage({ params }: Props) {
  const { strategyId } = await params;
  const [strategyResult, runsResult] = await Promise.all([
    getStrategyDetailAction(strategyId),
    getStrategyRunsAction(strategyId, 50),
  ]);

  if (!strategyResult.success || !strategyResult.data) notFound();
  const strategy = strategyResult.data;
  const runs: StrategyRunEntry[] = runsResult.success && runsResult.data ? runsResult.data : [];

  const statusColor = STATUS_COLORS[strategy.status] ?? 'var(--text-muted)';
  const runsWithElo = runs.filter(r => r.finalElo != null);
  const avgElo = runsWithElo.length > 0
    ? runsWithElo.reduce((s, r) => s + (r.finalElo ?? 0), 0) / runsWithElo.length
    : 0;
  const totalCost = runs.reduce((s, r) => s + r.totalCostUsd, 0);
  const avgCost = runs.length > 0 ? totalCost / runs.length : 0;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Strategies', href: '/admin/evolution/strategies' },
          { label: strategy.name ?? strategy.label },
        ]}
      />

      <div className="bg-[var(--surface-secondary)] paper-texture rounded-book p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-[var(--text-primary)]">
              {strategy.name ?? strategy.label}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <span
                className="inline-flex items-center px-2 py-0.5 text-xs font-ui font-medium rounded-full border"
                style={{ color: statusColor, borderColor: statusColor }}
                data-testid="status-badge"
              >
                {strategy.status}
              </span>
              {strategy.pipeline_type && (
                <span className="text-xs font-ui text-[var(--text-muted)]">
                  {strategy.pipeline_type}
                </span>
              )}
              <span className="text-xs font-mono text-[var(--text-muted)]" title={strategy.id}>
                {strategy.id.slice(0, 8)}&hellip;
              </span>
            </div>
          </div>
          <Link
            href="/admin/evolution/strategies"
            className="text-xs font-ui text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
          >
            &larr; All Strategies
          </Link>
        </div>

        {strategy.description && (
          <p className="text-sm font-body text-[var(--text-secondary)]">{strategy.description}</p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCell label="Runs" value={String(strategy.run_count ?? runs.length)} />
          <StatCell label="Avg Elo" value={runsWithElo.length > 0 ? avgElo.toFixed(0) : '—'} />
          <StatCell label="Total Cost" value={`$${totalCost.toFixed(2)}`} />
          <StatCell label="Avg $/Run" value={`$${avgCost.toFixed(3)}`} />
          <StatCell label="Created By" value={strategy.created_by ?? 'system'} />
        </div>
      </div>

      <div className="bg-[var(--surface-secondary)] paper-texture rounded-book p-6">
        <h2 className="text-lg font-display font-medium text-[var(--text-primary)] mb-4">Configuration</h2>
        <StrategyConfigDisplay config={strategy.config} />
      </div>

      <div className="bg-[var(--surface-secondary)] paper-texture rounded-book p-6">
        <h2 className="text-lg font-display font-medium text-[var(--text-primary)] mb-4">
          Run History ({runs.length})
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm font-body text-[var(--text-muted)]">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-ui" data-testid="runs-table">
              <thead>
                <tr className="text-[var(--text-muted)] border-b border-[var(--border-default)]">
                  <th className="text-left py-1 pr-3">Run</th>
                  <th className="text-left py-1 pr-3">Status</th>
                  <th className="text-left py-1 pr-3">Topic</th>
                  <th className="text-right py-1 pr-3">Elo</th>
                  <th className="text-right py-1 pr-3">Cost</th>
                  <th className="text-right py-1 pr-3">Iters</th>
                  <th className="text-right py-1">Date</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const runStatusColor = RUN_STATUS_COLORS[run.status] ?? 'var(--text-muted)';
                  return (
                    <tr key={run.runId} className="border-b border-[var(--border-default)] last:border-0">
                      <td className="py-1.5 pr-3">
                        <Link
                          href={buildRunUrl(run.runId)}
                          className="font-mono text-[var(--text-primary)] hover:text-[var(--accent-gold)] transition-colors"
                        >
                          {run.runId.slice(0, 8)}&hellip;
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3">
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-full border"
                          style={{ color: runStatusColor, borderColor: runStatusColor }}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--text-secondary)] max-w-[200px] truncate">
                        {run.explanationTitle}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-[var(--text-secondary)]">
                        {run.finalElo != null ? run.finalElo.toFixed(0) : '—'}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-[var(--text-secondary)]">
                        ${run.totalCostUsd.toFixed(3)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-[var(--text-muted)]">
                        {run.iterations}
                      </td>
                      <td className="py-1.5 text-right font-mono text-[var(--text-muted)]">
                        {run.startedAt ? new Date(run.startedAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <span className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">{label}</span>
      <p className="text-sm font-mono text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
