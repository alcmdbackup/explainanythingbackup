// Run detail page shell with EntityDetailHeader and EntityDetailTabs.
// Each tab is a separate component that lazily loads its own data on selection.

'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionStatusBadge, PhaseIndicator, EvolutionBreadcrumb, EntityDetailHeader, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { getEvolutionRunByIdAction, type EvolutionRun } from '@evolution/services/evolutionActions';
import { getStrategyDetailAction } from '@evolution/services/strategyRegistryActions';
import { getPromptTitleAction } from '@evolution/services/promptRegistryActions';
import { getExperimentNameAction } from '@evolution/services/experimentActions';
import type { StrategyConfigRow } from '@evolution/lib/core/strategyConfig';
import { AutoRefreshProvider, RefreshIndicator, useAutoRefresh } from '@evolution/components/evolution/AutoRefreshProvider';
import { TimelineTab } from '@evolution/components/evolution/tabs/TimelineTab';
import { EloTab } from '@evolution/components/evolution/tabs/EloTab';
import { LineageTab } from '@evolution/components/evolution/tabs/LineageTab';
import { VariantsTab } from '@evolution/components/evolution/tabs/VariantsTab';
import { LogsTab } from '@evolution/components/evolution/tabs/LogsTab';
import { buildExplanationUrl, buildStrategyUrl, buildArenaTopicUrl, buildExperimentUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCost } from '@evolution/lib/utils/formatters';
import type { EntityLink } from '@evolution/components/evolution/EntityDetailHeader';
import { RunMetricsTab } from './RunMetricsTab';

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'elo', label: 'Rating' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'variants', label: 'Variants' },
  { id: 'logs', label: 'Logs' },
];

export default function EvolutionRunDetailPage(): JSX.Element {
  const params = useParams();
  const searchParams = useSearchParams();
  const runId = params.runId as string;
  const [run, setRun] = useState<EvolutionRun | null>(null);
  const [strategy, setStrategy] = useState<StrategyConfigRow | null>(null);
  const [promptTitle, setPromptTitle] = useState<string | null>(null);
  const [experimentName, setExperimentName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true);
      const result = await getEvolutionRunByIdAction(runId);
      if (result.success && result.data) {
        setRun(result.data);
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  useEffect(() => {
    if (!run?.strategy_config_id) return;
    getStrategyDetailAction(run.strategy_config_id).then((res) => {
      if (res.success && res.data) setStrategy(res.data);
    });
  }, [run?.strategy_config_id]);

  useEffect(() => {
    if (!run?.prompt_id) return;
    const pid = run.prompt_id;
    getPromptTitleAction(pid).then((res) => {
      if (res.success && res.data) setPromptTitle(res.data);
      else setPromptTitle(pid.substring(0, 8));
    });
  }, [run?.prompt_id]);

  useEffect(() => {
    if (!run?.experiment_id) return;
    const eid = run.experiment_id;
    getExperimentNameAction(eid).then((res) => {
      if (res.success && res.data) setExperimentName(res.data);
      else setExperimentName(eid.substring(0, 8));
    });
  }, [run?.experiment_id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-[var(--surface-elevated)] rounded animate-pulse" />
        <div className="h-[400px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="text-center py-12 text-[var(--text-muted)]">
        Run not found: {runId}
      </div>
    );
  }

  const isActive = run.status === 'running' || run.status === 'claimed';

  return (
    <AutoRefreshProvider isActive={isActive}>
      <RunDetailContent
        run={run}
        setRun={setRun}
        strategy={strategy}
        promptTitle={promptTitle}
        experimentName={experimentName}
        runId={runId}
        searchParams={searchParams}
      />
    </AutoRefreshProvider>
  );
}

interface RunDetailContentProps {
  run: EvolutionRun;
  setRun: (r: EvolutionRun) => void;
  strategy: StrategyConfigRow | null;
  promptTitle: string | null;
  experimentName: string | null;
  runId: string;
  searchParams: ReturnType<typeof useSearchParams>;
}

function RunDetailContent({
  run,
  setRun,
  strategy,
  promptTitle,
  experimentName,
  runId,
  searchParams,
}: RunDetailContentProps): JSX.Element {
  const { refreshKey, reportRefresh } = useAutoRefresh();

  const agentParam = searchParams.get('agent') ?? undefined;
  const iterationParam = searchParams.get('iteration');
  const variantParam = searchParams.get('variant') ?? undefined;

  const legacyTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useTabState(TABS, {
    legacyTabMap: { budget: 'timeline', tree: 'lineage' },
  });

  const initialBudgetExpanded = legacyTab === 'budget';
  const initialTreeView = legacyTab === 'tree';

  useEffect(() => {
    if (refreshKey === 0) return;
    getEvolutionRunByIdAction(runId).then(result => {
      if (result.success && result.data) {
        setRun(result.data);
        reportRefresh();
      }
    });
  }, [refreshKey, runId, setRun, reportRefresh]);

  const maxIterations = strategy?.config.iterations ?? 15;

  const links: EntityLink[] = [];
  if (run.explanation_id) {
    links.push({ prefix: 'Explanation', label: `#${run.explanation_id}`, href: buildExplanationUrl(run.explanation_id) });
  }
  if (run.experiment_id) {
    links.push({ prefix: 'Experiment', label: experimentName ?? run.experiment_id.substring(0, 8), href: buildExperimentUrl(run.experiment_id) });
  }
  if (run.prompt_id) {
    links.push({ prefix: 'Prompt', label: promptTitle ?? run.prompt_id.substring(0, 8), href: buildArenaTopicUrl(run.prompt_id) });
  }
  if (strategy && run.strategy_config_id) {
    links.push({ prefix: 'Strategy', label: strategy.label, href: buildStrategyUrl(run.strategy_config_id) });
  }

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Runs', href: '/admin/evolution/runs' },
        { label: `Run ${runId.substring(0, 8)}`, href: `?tab=${activeTab}` },
        { label: TABS.find(t => t.id === activeTab)?.label ?? activeTab },
      ]} />

      <EntityDetailHeader
        title={`Run ${runId.substring(0, 8)}`}
        entityId={runId}
        links={links}
        statusBadge={
          <div className="flex items-center gap-3">
            <EvolutionStatusBadge status={run.status} />
            {run.archived && (
              <span className="px-2 py-0.5 text-xs font-ui rounded-page bg-[var(--surface-elevated)] text-[var(--text-muted)] border border-[var(--border-default)]">
                Archived
              </span>
            )}
            <PhaseIndicator phase={run.phase} iteration={run.current_iteration} maxIterations={maxIterations} />
            <BudgetBar spent={run.total_cost_usd} budget={run.budget_cap_usd} />
            <span className="text-xs text-[var(--text-muted)]" data-testid="budget-pct">
              {run.budget_cap_usd > 0 ? `${Math.round((run.total_cost_usd / run.budget_cap_usd) * 100)}%` : '\u2014'}
            </span>
            {(run.status === 'running' || run.status === 'claimed') && run.started_at && run.current_iteration > 0 && (
              <span className="text-xs text-[var(--text-muted)]" data-testid="eta-display" title="Estimated time remaining based on average iteration duration">
                {formatEta(run.started_at, run.current_iteration, maxIterations)}
              </span>
            )}
            <RefreshIndicator />
          </div>
        }
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => { navigator.clipboard.writeText(runId); toast.success('Run ID copied'); }}
              className="px-3 py-1.5 border border-[var(--border-default)] rounded-page text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
            >
              Copy ID
            </button>
            <Link
              href={`/admin/evolution/runs/${runId}/compare`}
              className="px-4 py-2 border border-[var(--border-default)] rounded-page text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
              data-testid="compare-link"
            >
              Compare
            </Link>
          </div>
        }
      />

      {run.error_message && (
        <div className="text-xs text-[var(--status-error)]">{run.error_message}</div>
      )}

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'timeline' && (
          <TimelineTab
            runId={runId}
            initialAgent={agentParam}
            initialBudgetExpanded={initialBudgetExpanded}
          />
        )}
        {activeTab === 'elo' && <EloTab runId={runId} />}
        {activeTab === 'metrics' && <RunMetricsTab runId={runId} />}
        {activeTab === 'lineage' && <LineageTab runId={runId} initialView={initialTreeView ? 'tree' : 'lineage'} />}
        {activeTab === 'variants' && <VariantsTab runId={runId} />}
        {activeTab === 'logs' && (
          <LogsTab
            runId={runId}
            initialAgent={agentParam}
            initialIteration={iterationParam ? Number(iterationParam) : undefined}
            initialVariant={variantParam}
          />
        )}
      </EntityDetailTabs>
    </div>
  );
}

function formatEta(startedAt: string, currentIteration: number, maxIterations: number): string {
  const elapsedSec = (Date.now() - new Date(startedAt).getTime()) / 1000;
  const avgPerIter = elapsedSec / currentIteration;
  const etaSec = Math.round(avgPerIter * (maxIterations - currentIteration));
  if (etaSec < 60) return `~${etaSec}s left`;
  if (etaSec < 3600) return `~${Math.round(etaSec / 60)}m left`;
  return `~${(etaSec / 3600).toFixed(1)}h left`;
}

function BudgetBar({ spent, budget }: { spent: number; budget: number }): JSX.Element {
  const pct = budget > 0 ? Math.min(1, spent / budget) : 0;

  let colorClass: string;
  if (pct >= 0.9) colorClass = 'bg-[var(--status-error)]';
  else if (pct >= 0.7) colorClass = 'bg-[var(--status-warning)]';
  else colorClass = 'bg-[var(--status-success)]';

  return (
    <div className="flex items-center gap-2 text-xs" data-testid="budget-bar">
      <div className="w-24 h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
        <div className={`h-full ${colorClass} rounded-full transition-all`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="font-mono text-[var(--text-muted)]">
        {formatCost(spent)} / {formatCost(budget)}
      </span>
    </div>
  );
}
