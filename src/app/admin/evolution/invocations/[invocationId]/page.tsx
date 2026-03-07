// Invocation detail page: deep-dive into a single agent invocation's execution,
// before/after variant diffs, and Elo rating changes.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getInvocationFullDetailAction } from '@evolution/services/evolutionVisualizationActions';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCostMicro } from '@evolution/lib/utils/formatters';
import { AgentExecutionDetailView } from '@evolution/components/evolution/agentDetails';
import { InvocationDetailClient } from './InvocationDetailClient';

interface Props {
  params: Promise<{ invocationId: string }>;
}

function getStatusBadge(skipped: boolean, success: boolean): JSX.Element {
  if (skipped) {
    return (
      <span className="px-2 py-0.5 rounded-page text-xs font-medium bg-[var(--status-warning)]/15 text-[var(--status-warning)]">
        Skipped
      </span>
    );
  }
  if (success) {
    return (
      <span className="px-2 py-0.5 rounded-page text-xs font-medium bg-[var(--status-success)]/15 text-[var(--status-success)]">
        Success
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-page text-xs font-medium bg-[var(--status-error)]/15 text-[var(--status-error)]">
      Failed
    </span>
  );
}

export default async function InvocationDetailPage({ params }: Props): Promise<JSX.Element> {
  const { invocationId } = await params;
  if (!invocationId) notFound();

  const result = await getInvocationFullDetailAction(invocationId);
  if (!result.success || !result.data) notFound();

  const { invocation, run, diffMetrics, inputVariant, variantDiffs, eloHistory } = result.data;

  const breadcrumbItems = [
    { label: 'Runs', href: '/admin/evolution/runs' },
    { label: `Run ${invocation.runId.substring(0, 8)}`, href: buildRunUrl(invocation.runId) },
    { label: `${invocation.agentName} (Iter ${invocation.iteration})` },
  ];

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb items={breadcrumbItems} />

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-display font-bold text-[var(--text-primary)]">
            {invocation.agentName}
          </h1>
          <div className="flex items-center gap-3">
            {getStatusBadge(invocation.skipped, invocation.success)}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Iteration</div>
            <div className="font-mono text-[var(--text-primary)]">{invocation.iteration}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Cost</div>
            <div className="font-mono text-[var(--text-primary)]">{formatCostMicro(invocation.costUsd)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Variants Added</div>
            <div className="font-mono text-[var(--text-primary)]">{diffMetrics?.variantsAdded ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Matches Played</div>
            <div className="font-mono text-[var(--text-primary)]">{diffMetrics?.matchesPlayed ?? 0}</div>
          </div>
        </div>

        {run.explanationTitle && (
          <div className="mt-3 text-xs text-[var(--text-muted)]">
            Article: <span className="text-[var(--text-secondary)]">{run.explanationTitle}</span>
          </div>
        )}

        {invocation.errorMessage && (
          <div className="mt-3 p-2 bg-[var(--status-error)]/10 rounded text-xs text-[var(--status-error)]">
            {invocation.errorMessage}
          </div>
        )}
      </div>

      <InvocationDetailClient
        inputVariant={inputVariant}
        variantDiffs={variantDiffs}
        eloHistory={eloHistory}
        runId={invocation.runId}
      />

      {invocation.executionDetail && (
        <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wide">
            Execution Detail
          </h2>
          <AgentExecutionDetailView detail={invocation.executionDetail} runId={invocation.runId} />
        </div>
      )}
    </div>
  );
}
