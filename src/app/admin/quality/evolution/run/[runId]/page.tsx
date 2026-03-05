'use client';
// Run detail page shell with tab bar for deep-diving into a single evolution run.
// Each tab is a separate component that lazily loads its own data on selection.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionStatusBadge, PhaseIndicator, EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getEvolutionRunByIdAction, type EvolutionRun } from '@evolution/services/evolutionActions';

import { getStrategyDetailAction } from '@evolution/services/strategyRegistryActions';
import type { StrategyConfigRow } from '@evolution/lib/core/strategyConfig';
import { AutoRefreshProvider, RefreshIndicator, useAutoRefresh } from '@evolution/components/evolution/AutoRefreshProvider';
import { TimelineTab } from '@evolution/components/evolution/tabs/TimelineTab';
import { EloTab } from '@evolution/components/evolution/tabs/EloTab';
import { LineageTab } from '@evolution/components/evolution/tabs/LineageTab';
import { VariantsTab } from '@evolution/components/evolution/tabs/VariantsTab';
import { LogsTab } from '@evolution/components/evolution/tabs/LogsTab';
import { buildExplanationUrl, buildStrategyUrl, buildArenaTopicUrl, buildExperimentUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCost } from '@evolution/lib/utils/formatters';

type TabId = 'timeline' | 'elo' | 'lineage' | 'variants' | 'logs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'elo', label: 'Rating' },
  { id: 'lineage', label: 'Lineage' },
  { id: 'variants', label: 'Variants' },
  { id: 'logs', label: 'Logs' },
];

function mapLegacyTab(tab: string | null): { tabId: TabId; budgetExpanded?: boolean; treeView?: boolean } {
  if (tab === 'budget') return { tabId: 'timeline', budgetExpanded: true };
  if (tab === 'tree') return { tabId: 'lineage', treeView: true };
  if (tab && TABS.some(t => t.id === tab)) return { tabId: tab as TabId };
  return { tabId: 'timeline' };
}

export default function EvolutionRunDetailPage(): JSX.Element {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const runId = params.runId as string;
  const [run, setRun] = useState<EvolutionRun | null>(null);
  const [strategy, setStrategy] = useState<StrategyConfigRow | null>(null);
  const [loading, setLoading] = useState(true);

  // Initial run load
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

  // Fetch strategy details when run has a strategy_config_id
  useEffect(() => {
    if (!run?.strategy_config_id) return;
    getStrategyDetailAction(run.strategy_config_id).then((res) => {
      if (res.success && res.data) setStrategy(res.data);
    });
  }, [run?.strategy_config_id]);

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
        runId={runId}
        router={router}
        searchParams={searchParams}
      />
    </AutoRefreshProvider>
  );
}

function RunDetailContent({
  run,
  setRun,
  strategy,
  runId,
  router,
  searchParams,
}: {
  run: EvolutionRun;
  setRun: (r: EvolutionRun) => void;
  strategy: StrategyConfigRow | null;
  runId: string;
  router: ReturnType<typeof useRouter>;
  searchParams: ReturnType<typeof useSearchParams>;
}): JSX.Element {
  const { refreshKey, reportRefresh } = useAutoRefresh();

  const tabParam = searchParams.get('tab');
  const agentParam = searchParams.get('agent') ?? undefined;
  const iterationParam = searchParams.get('iteration');
  const variantParam = searchParams.get('variant') ?? undefined;

  const mapped = mapLegacyTab(tabParam);
  const [activeTab, setActiveTab] = useState<TabId>(mapped.tabId);
  useEffect(() => {
    if (tabParam === 'budget' || tabParam === 'tree') {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', mapped.tabId);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = useCallback((tabId: TabId) => {
    setActiveTab(tabId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  useEffect(() => {
    if (refreshKey === 0) return; // skip initial mount — already loaded by parent
    getEvolutionRunByIdAction(runId).then(result => {
      if (result.success && result.data) {
        setRun(result.data);
        reportRefresh();
      }
    });
  }, [refreshKey, runId, setRun, reportRefresh]);

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Pipeline Runs', href: '/admin/quality/evolution' },
        { label: `Run ${runId.substring(0, 8)}`, href: `?tab=${activeTab}` },
        { label: TABS.find(t => t.id === activeTab)?.label ?? activeTab },
      ]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-display font-bold text-[var(--text-primary)]">
              Run {runId.substring(0, 8)}
            </h1>
            {run.explanation_id && (
              <Link
                href={buildExplanationUrl(run.explanation_id)}
                className="text-lg font-display text-[var(--accent-gold)] hover:underline"
              >
                Explanation #{run.explanation_id}
              </Link>
            )}
            {run.prompt_id && (
              <Link
                href={buildArenaTopicUrl(run.prompt_id)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-gold)] border border-[var(--border-default)] rounded-page px-2 py-0.5"
              >
                Prompt
              </Link>
            )}
            {run.experiment_id && (
              <Link
                href={buildExperimentUrl(run.experiment_id)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--accent-gold)] border border-[var(--border-default)] rounded-page px-2 py-0.5"
              >
                Experiment
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-[var(--text-muted)] font-mono">
            <span title={runId}>{runId}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(runId); toast.success('Run ID copied'); }}
              className="text-[var(--accent-gold)] hover:underline"
            >
              Copy
            </button>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <EvolutionStatusBadge status={run.status} />
            <PhaseIndicator
              phase={run.phase}
              iteration={run.current_iteration}
              maxIterations={strategy?.config.iterations ?? 15}
            />
            <BudgetBar spent={run.total_cost_usd} budget={run.budget_cap_usd} />
            <span className="text-xs text-[var(--text-muted)]" data-testid="budget-pct">
              {run.budget_cap_usd > 0 ? `${Math.round((run.total_cost_usd / run.budget_cap_usd) * 100)}%` : '\u2014'}
            </span>
            {(run.status === 'running' || run.status === 'claimed') && run.started_at && run.current_iteration > 0 && (
              <span className="text-xs text-[var(--text-muted)]" data-testid="eta-display" title="Estimated time remaining based on average iteration duration">
                {formatEta(run.started_at, run.current_iteration, strategy?.config.iterations ?? 15)}
              </span>
            )}
            {strategy && run.strategy_config_id && (
              <Link
                href={buildStrategyUrl(run.strategy_config_id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--surface-elevated)] text-[var(--accent-gold)] border border-[var(--border-default)] hover:bg-[var(--surface-secondary)] transition-colors"
                title={`Strategy: ${strategy.label}`}
              >
                {strategy.label}
              </Link>
            )}
            <RefreshIndicator />
          </div>
          {run.error_message && (
            <div className="mt-2 text-xs text-[var(--status-error)]">{run.error_message}</div>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/quality/evolution/run/${runId}/compare`}
            className="px-4 py-2 border border-[var(--border-default)] rounded-page text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
            data-testid="compare-link"
          >
            Compare
          </Link>
        </div>
      </div>

      <div className="flex gap-1 border-b border-[var(--border-default)]" data-testid="tab-bar">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            data-testid={`tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div data-testid="tab-content">
        {activeTab === 'timeline' && (
          <TimelineTab
            runId={runId}
            initialAgent={agentParam}
            initialBudgetExpanded={mapped.budgetExpanded}
          />
        )}
        {activeTab === 'elo' && <EloTab runId={runId} />}
        {activeTab === 'lineage' && <LineageTab runId={runId} initialView={mapped.treeView ? 'tree' : 'lineage'} />}
        {activeTab === 'variants' && <VariantsTab runId={runId} />}
        {activeTab === 'logs' && (
          <LogsTab
            runId={runId}
            initialAgent={agentParam}
            initialIteration={iterationParam ? Number(iterationParam) : undefined}
            initialVariant={variantParam}
          />
        )}
      </div>

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
