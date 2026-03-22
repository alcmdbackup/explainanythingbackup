// Evolution run detail page with tabbed interface for metrics, elo, lineage, variants, and logs.
// Fetches run data via V2 actions and renders EntityDetailHeader + EntityDetailTabs.
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  EvolutionBreadcrumb,
  EntityDetailHeader,
  EntityDetailTabs,
  useTabState,
  EvolutionStatusBadge,
  type TabDef,
} from '@evolution/components/evolution';
import {
  getEvolutionRunByIdAction,
  getEvolutionRunLogsAction,
  type EvolutionRun,
  type RunLogEntry,
} from '@evolution/services/evolutionActions';
import { RunMetricsTab } from './RunMetricsTab';
import { EloTab } from '@evolution/components/evolution/tabs/EloTab';
import { LineageTab } from '@evolution/components/evolution/tabs/LineageTab';
import { VariantsTab } from '@evolution/components/evolution/tabs/VariantsTab';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'elo', label: 'Elo' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'variants', label: 'Variants' },
  { id: 'logs', label: 'Logs' },
];

function LogsPanel({ runId }: { runId: string }): JSX.Element {
  const [logs, setLogs] = useState<RunLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunLogsAction({ runId });
      if (result.success && result.data) {
        setLogs(result.data.items);
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) {
    return <div className="h-48 bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  }

  if (logs.length === 0) {
    return <div className="text-sm text-[var(--text-muted)] p-8 text-center">No logs available.</div>;
  }

  return (
    <div className="overflow-x-auto border border-[var(--border-default)] rounded-book" data-testid="logs-panel">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface-elevated)]">
          <tr>
            <th className="px-3 py-2 text-left">Time</th>
            <th className="px-3 py-2 text-left">Level</th>
            <th className="px-3 py-2 text-left">Agent</th>
            <th className="px-3 py-2 text-left">Message</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-t border-[var(--border-default)]">
              <td className="px-3 py-2 text-xs text-[var(--text-muted)] whitespace-nowrap">
                {new Date(log.created_at).toLocaleTimeString()}
              </td>
              <td className="px-3 py-2 text-xs font-mono">{log.level}</td>
              <td className="px-3 py-2 text-xs font-mono text-[var(--text-secondary)]">{log.agent_name ?? '—'}</td>
              <td className="px-3 py-2 text-xs">{log.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EvolutionRunDetailPage(): JSX.Element {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const [run, setRun] = useState<EvolutionRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useTabState(TABS);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getEvolutionRunByIdAction(runId);
    if (result.success && result.data) {
      setRun(result.data);
    }
    setLoading(false);
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

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
    return <div className="text-[var(--status-error)] text-sm p-4">Run not found.</div>;
  }

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Runs', href: '/admin/evolution/runs' },
        { label: run.id.substring(0, 8) },
      ]} />

      <EntityDetailHeader
        title={`Run ${run.id.substring(0, 8)}`}
        entityId={run.id}
        statusBadge={<EvolutionStatusBadge status={run.status as import('@evolution/lib/types').EvolutionRunStatus} hasError={!!run.error_message} />}
      />

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && <RunMetricsTab runId={runId} />}
        {activeTab === 'elo' && <EloTab runId={runId} />}
        {activeTab === 'lineage' && <LineageTab runId={runId} />}
        {activeTab === 'variants' && <VariantsTab runId={runId} />}
        {activeTab === 'logs' && <LogsPanel runId={runId} />}
      </EntityDetailTabs>
    </div>
  );
}
