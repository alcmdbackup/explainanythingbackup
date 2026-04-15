// Evolution run detail page with tabbed interface for metrics, elo, lineage, variants, and logs.
// Fetches run data via V2 actions and renders EntityDetailHeader + EntityDetailTabs.
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  EvolutionBreadcrumb,
  EntityDetailHeader,
  EntityDetailTabs,
  useTabState,
  StatusBadge,
  EntityMetricsTab,
  NotFoundCard,
  type TabDef,
} from '@evolution/components/evolution';
import {
  getEvolutionRunByIdAction,
  type EvolutionRun,
} from '@evolution/services/evolutionActions';
import { EloTab } from '@evolution/components/evolution/tabs/EloTab';
import { LineageTab } from '@evolution/components/evolution/tabs/LineageTab';
import { VariantsTab } from '@evolution/components/evolution/tabs/VariantsTab';
import { LogsTab } from '@evolution/components/evolution/tabs/LogsTab';
import { SnapshotsTab } from '@evolution/components/evolution/tabs/SnapshotsTab';
import { TimelineTab } from '@evolution/components/evolution/tabs/TimelineTab';

const TABS: TabDef[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'elo', label: 'Elo' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'variants', label: 'Variants' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'logs', label: 'Logs' },
];

export default function EvolutionRunDetailPage(): JSX.Element {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<EvolutionRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useTabState(TABS);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const result = await getEvolutionRunByIdAction(runId);
      if (result.success && result.data) setRun(result.data);
      setLoading(false);
    })();
  }, [runId]);

  if (loading && !run) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <div key={i} className="h-32 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
        ))}
      </div>
    );
  }

  if (!run) {
    return (
      <NotFoundCard
        entityType="Run"
        breadcrumbs={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Runs', href: '/admin/evolution/runs' },
        ]}
      />
    );
  }

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Runs', href: '/admin/evolution/runs' },
        { label: run.prompt_name || run.id.substring(0, 8) },
      ]} />

      <EntityDetailHeader
        title={run.prompt_name ? `Run: ${run.prompt_name}` : `Run ${run.id.substring(0, 8)}`}
        entityId={run.id}
        statusBadge={<StatusBadge variant="run-status" status={run.status} hasError={!!run.error_message} />}
        links={[
          run.strategy_name || run.strategy_id
            ? { prefix: 'Strategy', label: run.strategy_name || `#${run.strategy_id.substring(0, 8)}`, href: `/admin/evolution/strategies/${run.strategy_id}` }
            : null,
          run.experiment_id
            ? { prefix: 'Experiment', label: run.experiment_name || `#${run.experiment_id.substring(0, 8)}`, href: `/admin/evolution/experiments/${run.experiment_id}` }
            : null,
          run.prompt_id
            ? { prefix: 'Prompt', label: run.prompt_name || `#${run.prompt_id.substring(0, 8)}`, href: `/admin/evolution/prompts/${run.prompt_id}` }
            : null,
        ].filter(Boolean) as Array<{ prefix: string; label: string; href: string }>}
      />

      {run.status === 'failed' && run.error_message && (
        <div
          className="rounded-book border border-[var(--status-error)] bg-[var(--status-error)]/10 p-4"
          data-testid="run-error-banner"
        >
          <p className="text-sm font-ui font-medium text-[var(--status-error)] mb-1">Run Failed</p>
          <p className="text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap">{run.error_message}</p>
        </div>
      )}

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'timeline' && <TimelineTab runId={runId} run={run} />}
        {activeTab === 'metrics' && <EntityMetricsTab entityType="run" entityId={runId} />}
        {activeTab === 'elo' && <EloTab runId={runId} />}
        {activeTab === 'lineage' && <LineageTab runId={runId} />}
        {activeTab === 'variants' && <VariantsTab runId={runId} runStatus={run.status} />}
        {activeTab === 'snapshots' && <SnapshotsTab runId={runId} />}
        {activeTab === 'logs' && <LogsTab entityType="run" entityId={runId} />}
      </EntityDetailTabs>
    </div>
  );
}
