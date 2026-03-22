// Invocation detail page. Shows full invocation data including execution_detail JSONB.
import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb, EntityDetailHeader, MetricGrid } from '@evolution/components/evolution';
import { getInvocationDetailAction } from '@evolution/services/invocationActions';
import { formatCostDetailed } from '@evolution/lib/utils/formatters';
import { InvocationExecutionDetail } from './InvocationExecutionDetail';

interface Props {
  params: Promise<{ invocationId: string }>;
}

export default async function InvocationDetailPage({ params }: Props): Promise<JSX.Element> {
  const { invocationId } = await params;
  const result = await getInvocationDetailAction(invocationId);
  if (!result.success || !result.data) notFound();

  const inv = result.data;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Invocations', href: '/admin/evolution/invocations' },
          { label: `${invocationId.substring(0, 8)}...` },
        ]}
      />

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
  );
}

