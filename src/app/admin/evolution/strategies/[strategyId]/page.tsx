// Strategy detail page showing config, metrics, and run statistics.
// Uses V2 getStrategyDetailAction and shared EntityDetailHeader + MetricGrid.

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  EvolutionBreadcrumb,
  EntityDetailHeader,
  MetricGrid,
} from '@evolution/components/evolution';
import { StrategyConfigDisplay } from '@/app/admin/evolution/_components/StrategyConfigDisplay';
import {
  getStrategyDetailAction,
  type StrategyListItem,
} from '@evolution/services/strategyRegistryActionsV2';

export default function StrategyDetailPage(): JSX.Element {
  const { strategyId } = useParams<{ strategyId: string }>();
  const [strategy, setStrategy] = useState<StrategyListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const result = await getStrategyDetailAction(strategyId);
      if (!result.success || !result.data) {
        setError(result.error?.message ?? 'Failed to load strategy');
      } else {
        setStrategy(result.data);
      }
      setLoading(false);
    })();
  }, [strategyId]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-[var(--text-secondary)]">Loading strategy...</p>
      </div>
    );
  }

  if (error || !strategy) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-display font-bold text-[var(--status-error)] mb-4">Error</h2>
        <p className="text-sm text-[var(--text-secondary)]">{error ?? 'Strategy not found'}</p>
      </div>
    );
  }

  const metrics = [
    { label: 'Run Count', value: strategy.run_count },
    { label: 'Total Cost', value: `$${(strategy.total_cost_usd ?? 0).toFixed(2)}`, prefix: '' },
    { label: 'Avg Final Elo', value: strategy.avg_final_elo != null ? strategy.avg_final_elo.toFixed(0) : '—' },
    { label: 'Best Final Elo', value: '—' },
    { label: 'Worst Final Elo', value: '—' },
  ];

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Dashboard', href: '/admin/evolution-dashboard' },
          { label: 'Strategies', href: '/admin/evolution/strategies' },
          { label: strategy.name },
        ]}
      />

      <EntityDetailHeader
        title={strategy.name}
        entityId={strategy.id}
        statusBadge={
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
              strategy.status === 'active'
                ? 'bg-[var(--status-success)]/20 text-[var(--status-success)] border-[var(--status-success)]/30'
                : 'bg-[var(--text-muted)]/20 text-[var(--text-muted)] border-[var(--text-muted)]/30'
            }`}
            data-testid="strategy-status-badge"
          >
            {strategy.status}
          </span>
        }
      />

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)] mb-3">Configuration</h2>
          <StrategyConfigDisplay config={strategy.config ?? {}} />
        </div>

        <div>
          <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)] mb-3">Metrics</h2>
          <MetricGrid metrics={metrics} columns={5} variant="card" testId="strategy-metrics" />
        </div>

        {strategy.description && (
          <div>
            <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)] mb-3">Description</h2>
            <p className="text-sm text-[var(--text-secondary)] bg-[var(--surface-elevated)] rounded-page p-4">
              {strategy.description}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
