// Strategy detail page with tabbed interface for metrics, configuration, and logs.
// Uses V2 getStrategyDetailAction and shared EntityDetailHeader + EntityDetailTabs.

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  EvolutionBreadcrumb,
  EntityDetailHeader,
  EntityDetailTabs,
  useTabState,
  EntityMetricsTab,
  type TabDef,
} from '@evolution/components/evolution';
import { LogsTab } from '@evolution/components/evolution/tabs/LogsTab';
import { StrategyConfigDisplay } from '@/app/admin/evolution/_components/StrategyConfigDisplay';
import {
  getStrategyDetailAction,
  type StrategyListItem,
} from '@evolution/services/strategyRegistryActions';
import {
  getEvolutionRunsAction,
  type EvolutionRun,
} from '@evolution/services/evolutionActions';
import { EntityTable, type ColumnDef } from '@evolution/components/evolution';
import { StatusBadge } from '@evolution/components/evolution';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';

// Inline runs tab for strategy detail
const RUN_COLUMNS: ColumnDef<EvolutionRun>[] = [
  { key: 'id', header: 'ID', render: (r) => <span className="font-mono text-xs text-[var(--accent-gold)]">{r.id.substring(0, 8)}</span> },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge variant="run-status" status={r.status} hasError={!!r.error_message} /> },
  { key: 'created_at', header: 'Created', render: (r) => new Date(r.created_at).toLocaleDateString() },
];

function StrategyRunsTab({ strategyId }: { strategyId: string }): JSX.Element {
  const [runs, setRuns] = useState<EvolutionRun[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void (async () => {
      const result = await getEvolutionRunsAction({ strategy_id: strategyId, limit: 50, offset: 0 });
      if (result.success && result.data) setRuns(result.data.items);
      setLoading(false);
    })();
  }, [strategyId]);
  return <EntityTable columns={RUN_COLUMNS} items={runs} loading={loading} getRowHref={(r) => buildRunUrl(r.id)} emptyMessage="No runs for this strategy." />;
}

const TABS: TabDef[] = [
  { id: 'metrics', label: 'Metrics' },
  { id: 'runs', label: 'Runs' },
  { id: 'config', label: 'Configuration' },
  { id: 'logs', label: 'Logs' },
];

export default function StrategyDetailPage(): JSX.Element {
  const { strategyId } = useParams<{ strategyId: string }>();
  const [strategy, setStrategy] = useState<StrategyListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useTabState(TABS);

  useEffect(() => {
    void (async () => {
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

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
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

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'metrics' && <EntityMetricsTab entityType="strategy" entityId={strategyId} />}
        {activeTab === 'runs' && <StrategyRunsTab strategyId={strategyId} />}
        {activeTab === 'config' && (
          <div className="space-y-6">
            <StrategyConfigDisplay config={strategy.config ?? {}} />
            {strategy.description && (
              <div>
                <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">Description</h3>
                <p className="text-sm text-[var(--text-secondary)] bg-[var(--surface-elevated)] rounded-page p-4">
                  {strategy.description}
                </p>
              </div>
            )}
          </div>
        )}
        {activeTab === 'logs' && <LogsTab entityType="strategy" entityId={strategyId} />}
      </EntityDetailTabs>
    </div>
  );
}
