// Client component for invocation detail: EntityDetailHeader + EntityDetailTabs.
// Renders overview metrics, input variant, output variants, and execution detail tabs.

'use client';

import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCostMicro, formatEloCIRange } from '@evolution/lib/utils/formatters';
import { ELO_SIGMA_SCALE } from '@evolution/lib/core/rating';
import { AgentExecutionDetailView } from '@evolution/components/evolution/agentDetails';
import { InputVariantSection, OutputVariantsSection } from './InvocationDetailClient';
import type { InvocationFullDetail, VariantBeforeAfter } from '@evolution/services/evolutionVisualizationActions';
import type { EntityLink } from '@evolution/components/evolution/EntityDetailHeader';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'input', label: 'Input Variant' },
  { id: 'outputs', label: 'Output Variants' },
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
            {/* Inputs / Outputs summary with CI */}
            {(inputVariant || variantDiffs.length > 0) && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Inputs / Outputs</h3>
                {inputVariant && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--text-muted)]">Input:</span>
                    <span className="font-mono text-[var(--text-secondary)]">{inputVariant.variantId.substring(0, 8)}</span>
                    {inputVariant.elo != null && (
                      <span className="font-semibold">{Math.round(inputVariant.elo)}</span>
                    )}
                    {inputVariant.elo != null && inputVariant.sigma != null && (() => {
                      const ci = formatEloCIRange(inputVariant.elo, inputVariant.sigma * ELO_SIGMA_SCALE);
                      return ci ? <span className="text-[var(--text-muted)]">{ci}</span> : null;
                    })()}
                  </div>
                )}
                {variantDiffs.map(diff => (
                  <div key={diff.variantId} className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--text-muted)]">Output:</span>
                    <span className="font-mono text-[var(--text-secondary)]">{diff.variantId.substring(0, 8)}</span>
                    {diff.eloAfter != null && (
                      <>
                        <span className="font-semibold">{Math.round(diff.eloAfter)}</span>
                        {diff.sigmaAfter != null && (() => {
                          const ci = formatEloCIRange(diff.eloAfter, diff.sigmaAfter * ELO_SIGMA_SCALE);
                          return ci ? <span className="text-[var(--text-muted)]">{ci}</span> : null;
                        })()}
                      </>
                    )}
                    {diff.eloDelta != null && inputVariant && (
                      <span className={diff.eloDelta >= 0 ? 'text-[var(--status-success)]' : 'text-[var(--status-error)]'}>
                        {diff.eloDelta >= 0 ? '+' : ''}{Math.round(diff.eloDelta)} from input
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === 'input' && (
          <InputVariantSection
            inputVariant={inputVariant}
            runId={invocation.runId}
          />
        )}
        {activeTab === 'outputs' && (
          <OutputVariantsSection
            variantDiffs={variantDiffs}
            eloHistory={eloHistory}
            runId={invocation.runId}
          />
        )}
        {activeTab === 'execution' && (
          invocation.executionDetail ? (
            <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
              <AgentExecutionDetailView detail={invocation.executionDetail} runId={invocation.runId} />
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--text-muted)]">No execution detail available for this invocation.</div>
          )
        )}
      </EntityDetailTabs>
    </>
  );
}
