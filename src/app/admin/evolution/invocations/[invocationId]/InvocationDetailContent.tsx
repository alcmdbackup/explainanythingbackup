// Client component for invocation detail: EntityDetailHeader + EntityDetailTabs.
// Renders overview metrics, variants produced, execution detail, and logs tabs.

'use client';

import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCostMicro } from '@evolution/lib/utils/formatters';
import { AgentExecutionDetailView } from '@evolution/components/evolution/agentDetails';
import { InvocationDetailClient } from './InvocationDetailClient';
import type { InvocationFullDetail, VariantBeforeAfter } from '@evolution/services/evolutionVisualizationActions';
import type { EntityLink } from '@evolution/components/evolution/EntityDetailHeader';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'variants', label: 'Variants Produced' },
  { id: 'execution', label: 'Execution Detail' },
];

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  skipped: { label: 'Skipped', className: 'bg-[var(--status-warning)]/15 text-[var(--status-warning)]' },
  success: { label: 'Success', className: 'bg-[var(--status-success)]/15 text-[var(--status-success)]' },
  failed: { label: 'Failed', className: 'bg-[var(--status-error)]/15 text-[var(--status-error)]' },
};

function getStatusBadge(skipped: boolean, success: boolean): JSX.Element {
  const key = skipped ? 'skipped' : success ? 'success' : 'failed';
  const { label, className } = STATUS_STYLES[key];
  return (
    <span className={`px-2 py-0.5 rounded-page text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

interface Props {
  invocation: InvocationFullDetail['invocation'];
  run: InvocationFullDetail['run'];
  diffMetrics: InvocationFullDetail['diffMetrics'];
  inputVariant: InvocationFullDetail['inputVariant'];
  variantDiffs: VariantBeforeAfter[];
  eloHistory: InvocationFullDetail['eloHistory'];
}

export function InvocationDetailContent({
  invocation,
  run,
  diffMetrics,
  inputVariant,
  variantDiffs,
  eloHistory,
}: Props): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(TABS);

  const links: EntityLink[] = [
    { prefix: 'Run', label: invocation.runId.substring(0, 8), href: buildRunUrl(invocation.runId) },
  ];

  return (
    <>
      <EntityDetailHeader
        title={invocation.agentName}
        entityId={invocation.id}
        links={links}
        statusBadge={getStatusBadge(invocation.skipped, invocation.success)}
      />
      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <MetricGrid
              columns={4}
              metrics={[
                { label: 'Iteration', value: invocation.iteration },
                { label: 'Cost', value: formatCostMicro(invocation.costUsd) },
                { label: 'Variants Added', value: diffMetrics?.variantsAdded ?? 0 },
                { label: 'Matches Played', value: diffMetrics?.matchesPlayed ?? 0 },
              ]}
            />
            {run.explanationTitle && (
              <div className="text-xs text-[var(--text-muted)]">
                Article: <span className="text-[var(--text-secondary)]">{run.explanationTitle}</span>
              </div>
            )}
            {invocation.errorMessage && (
              <div className="p-2 bg-[var(--status-error)]/10 rounded text-xs text-[var(--status-error)]">
                {invocation.errorMessage}
              </div>
            )}
          </div>
        )}
        {activeTab === 'variants' && (
          <InvocationDetailClient
            inputVariant={inputVariant}
            variantDiffs={variantDiffs}
            eloHistory={eloHistory}
            runId={invocation.runId}
          />
        )}
        {activeTab === 'execution' && invocation.executionDetail && (
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <AgentExecutionDetailView detail={invocation.executionDetail} runId={invocation.runId} />
          </div>
        )}
      </EntityDetailTabs>
    </>
  );
}
