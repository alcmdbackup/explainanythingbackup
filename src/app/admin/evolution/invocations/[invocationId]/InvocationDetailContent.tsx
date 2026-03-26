// Client component for invocation detail with tabbed interface (overview + logs).
'use client';

import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState, EntityMetricsTab, type TabDef } from '@evolution/components/evolution';
import { formatCostDetailed } from '@evolution/lib/utils/formatters';
import { InvocationExecutionDetail } from './InvocationExecutionDetail';
import { LogsTab } from '@evolution/components/evolution/tabs/LogsTab';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'logs', label: 'Logs' },
];

interface InvocationData {
  id: string;
  run_id: string;
  agent_name: string;
  iteration: number | null;
  execution_order: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  success: boolean;
  error_message: string | null;
  execution_detail: Record<string, unknown> | null;
  created_at: string;
}

interface Props {
  invocation: InvocationData;
}

export function InvocationDetailContent({ invocation: inv }: Props): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(TABS);

  return (
    <>
      <EntityDetailHeader
        title={`Invocation ${inv.id.substring(0, 8)}`}
        entityId={inv.id}
        statusBadge={
          inv.success ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--status-success)] text-white font-ui">Success</span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--status-error)] text-white font-ui">Failed</span>
          )
        }
        links={[
          { prefix: 'Run', label: inv.run_id.substring(0, 8), href: `/admin/evolution/runs/${inv.run_id}` },
        ]}
      />

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <MetricGrid
              columns={4}
              variant="bordered"
              size="md"
              metrics={[
                { label: 'Agent', value: inv.agent_name },
                { label: 'Iteration', value: inv.iteration != null ? String(inv.iteration) : '—' },
                { label: 'Execution Order', value: inv.execution_order != null ? String(inv.execution_order) : '—' },
                { label: 'Cost', value: formatCostDetailed(inv.cost_usd) },
                { label: 'Duration', value: inv.duration_ms != null ? `${(inv.duration_ms / 1000).toFixed(1)}s` : '—' },
                { label: 'Created', value: new Date(inv.created_at).toLocaleString() },
              ]}
            />

            {inv.error_message && (
              <div className="border border-[var(--status-error)] rounded-book bg-[var(--surface-elevated)] p-4" data-testid="error-message">
                <h2 className="text-2xl font-display font-semibold text-[var(--status-error)] mb-2">Error</h2>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{inv.error_message}</p>
              </div>
            )}

            <InvocationExecutionDetail detail={inv.execution_detail} />
          </div>
        )}
        {activeTab === 'metrics' && <EntityMetricsTab entityType="invocation" entityId={inv.id} />}
        {activeTab === 'logs' && <LogsTab entityType="invocation" entityId={inv.id} />}
      </EntityDetailTabs>
    </>
  );
}
