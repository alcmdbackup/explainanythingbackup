// Invocation detail page. Shows full invocation data including execution_detail JSONB.
import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb, EntityDetailHeader } from '@evolution/components/evolution';
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <InfoCard label="Agent" value={inv.agent_name} />
        <InfoCard label="Iteration" value={inv.iteration != null ? String(inv.iteration) : '—'} />
        <InfoCard label="Execution Order" value={inv.execution_order != null ? String(inv.execution_order) : '—'} />
        <InfoCard label="Cost" value={formatCostDetailed(inv.cost_usd)} />
        <InfoCard label="Duration" value={inv.duration_ms != null ? `${(inv.duration_ms / 1000).toFixed(1)}s` : '—'} />
        <InfoCard label="Created" value={new Date(inv.created_at).toLocaleString()} />
      </div>

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

function InfoCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4">
      <p className="text-xs font-ui text-[var(--text-muted)] mb-1">{label}</p>
      <p className="text-sm font-body font-bold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
