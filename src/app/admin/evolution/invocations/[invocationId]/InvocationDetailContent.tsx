// Client component for invocation detail with tabbed interface (overview + logs).
'use client';

import { EntityDetailHeader, MetricGrid, EntityDetailTabs, useTabState, EntityMetricsTab, type TabDef } from '@evolution/components/evolution';
import { formatCostDetailed } from '@evolution/lib/utils/formatters';
import { InvocationExecutionDetail } from './InvocationExecutionDetail';
import { LogsTab } from '@evolution/components/evolution/tabs/LogsTab';
import { InvocationTimelineTab } from '@evolution/components/evolution/tabs/InvocationTimelineTab';
import { InvocationParentBlock } from '@evolution/components/evolution/tabs/InvocationParentBlock';

const TIMELINE_AGENTS = new Set<string>([
  'generate_from_previous_article',
  'reflect_and_generate_from_previous_article',
  'evaluate_criteria_then_generate_from_previous_article',
]);

const REFLECT_GENERATE_AGENT = 'reflect_and_generate_from_previous_article';
const CRITERIA_GENERATE_AGENT = 'evaluate_criteria_then_generate_from_previous_article';

function buildTabs(agentName: string): TabDef[] {
  if (agentName === REFLECT_GENERATE_AGENT) {
    return [
      { id: 'overview-reflection', label: 'Reflection Overview' },
      { id: 'overview-gfpa', label: 'Generation Overview' },
      { id: 'metrics', label: 'Metrics' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'logs', label: 'Logs' },
    ];
  }
  if (agentName === CRITERIA_GENERATE_AGENT) {
    // Single combined Eval & Suggest tab (one LLM call sources both scoring + suggestions).
    return [
      { id: 'overview-evaluate-suggest', label: 'Eval & Suggest' },
      { id: 'overview-gfpa', label: 'Generation' },
      { id: 'metrics', label: 'Metrics' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'logs', label: 'Logs' },
    ];
  }
  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'metrics', label: 'Metrics' },
  ];
  if (TIMELINE_AGENTS.has(agentName)) {
    tabs.push({ id: 'timeline', label: 'Timeline' });
  }
  tabs.push({ id: 'logs', label: 'Logs' });
  return tabs;
}

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
  const tabs = buildTabs(inv.agent_name);
  const [activeTab, setActiveTab] = useTabState(tabs);
  const detail = inv.execution_detail as {
    detailType?: string;
    tactic?: string;
    sourceMode?: string;
    reflection?: Record<string, unknown>;
  } | null;
  const isGenerateFromPrevious = detail?.detailType === 'generate_from_previous_article';
  // Phase 9: wrapper agent's GFPA Overview tab needs the same parent-block render as
  // the standalone GFPA invocation page, since the wrapper's variants have parent_variant_id
  // populated by the inner GFPA execute().
  const isReflectAndGenerate = detail?.detailType === 'reflect_and_generate_from_previous_article';
  const isCriteriaAndGenerate = detail?.detailType === 'evaluate_criteria_then_generate_from_previous_article';

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

      <EntityDetailTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
        {/* Existing single-Overview path (all agents except the wrapper) */}
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

            {isGenerateFromPrevious && (
              <InvocationParentBlock
                invocationId={inv.id}
                tactic={detail?.tactic ?? null}
                sourceMode={detail?.sourceMode ?? null}
              />
            )}

            <InvocationExecutionDetail detail={inv.execution_detail} />
          </div>
        )}

        {/* Phase 9: wrapper agent — Reflection Overview tab. Renders the reflection
            sub-detail (tactic chosen, ranked tactics with reasoning, candidates presented). */}
        {activeTab === 'overview-reflection' && (
          <div className="space-y-6" data-testid="reflection-overview-tab">
            <MetricGrid
              columns={4}
              variant="bordered"
              size="md"
              metrics={[
                { label: 'Agent', value: inv.agent_name },
                { label: 'Tactic Chosen', value: (detail?.tactic ?? '—') },
                { label: 'Cost', value: formatCostDetailed(inv.cost_usd) },
                { label: 'Duration', value: inv.duration_ms != null ? `${(inv.duration_ms / 1000).toFixed(1)}s` : '—' },
              ]}
            />

            {inv.error_message && (
              <div className="border border-[var(--status-error)] rounded-book bg-[var(--surface-elevated)] p-4" data-testid="error-message">
                <h2 className="text-2xl font-display font-semibold text-[var(--status-error)] mb-2">Error</h2>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{inv.error_message}</p>
              </div>
            )}

            {/* Render only the reflection sub-detail. The renderer slices via the
                'reflection' key prefix in DETAIL_VIEW_CONFIGS['reflect_and_generate_from_previous_article']. */}
            <InvocationExecutionDetail
              detail={inv.execution_detail}
              keyFilter={(key) => key === 'tactic' || key.startsWith('reflection')}
            />
          </div>
        )}

        {/* Phase 9: wrapper agent — Generation Overview tab. Renders the generation/ranking
            sub-detail, mirroring the standalone GFPA invocation page. */}
        {activeTab === 'overview-gfpa' && (
          <div className="space-y-6" data-testid="generation-overview-tab">
            <MetricGrid
              columns={4}
              variant="bordered"
              size="md"
              metrics={[
                { label: 'Agent', value: inv.agent_name },
                { label: 'Iteration', value: inv.iteration != null ? String(inv.iteration) : '—' },
                { label: 'Execution Order', value: inv.execution_order != null ? String(inv.execution_order) : '—' },
                { label: 'Tactic', value: (detail?.tactic ?? '—') },
                { label: 'Cost', value: formatCostDetailed(inv.cost_usd) },
                { label: 'Duration', value: inv.duration_ms != null ? `${(inv.duration_ms / 1000).toFixed(1)}s` : '—' },
              ]}
            />

            {(isReflectAndGenerate || isCriteriaAndGenerate) && (
              <InvocationParentBlock
                invocationId={inv.id}
                tactic={detail?.tactic ?? null}
                sourceMode={detail?.sourceMode ?? null}
              />
            )}

            {/* Render generation + ranking sub-details, omitting reflection-only +
                evaluateAndSuggest-only + criteria-overview-specific fields. */}
            <InvocationExecutionDetail
              detail={inv.execution_detail}
              keyFilter={(key) =>
                !key.startsWith('reflection')
                && !key.startsWith('evaluateAndSuggest')
                && !key.startsWith('weakestCriteria')
                && key !== 'tactic'}
            />
          </div>
        )}

        {/* Criteria-driven wrapper: single Eval & Suggest tab (one LLM call = unified phase) */}
        {activeTab === 'overview-evaluate-suggest' && (
          <div className="space-y-6" data-testid="evaluate-suggest-overview-tab">
            <MetricGrid
              columns={4}
              variant="bordered"
              size="md"
              metrics={[
                { label: 'Agent', value: inv.agent_name },
                { label: 'Tactic', value: 'criteria_driven' },
                { label: 'Cost', value: formatCostDetailed(inv.cost_usd) },
                { label: 'Duration', value: inv.duration_ms != null ? `${(inv.duration_ms / 1000).toFixed(1)}s` : '—' },
              ]}
            />

            {inv.error_message && (
              <div className="border border-[var(--status-error)] rounded-book bg-[var(--surface-elevated)] p-4" data-testid="error-message">
                <h2 className="text-2xl font-display font-semibold text-[var(--status-error)] mb-2">Error</h2>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{inv.error_message}</p>
              </div>
            )}

            {/* Render evaluateAndSuggest sub-detail + weakestCriteria fields. */}
            <InvocationExecutionDetail
              detail={inv.execution_detail}
              keyFilter={(key) => key === 'tactic' || key.startsWith('weakestCriteria') || key.startsWith('evaluateAndSuggest')}
            />
          </div>
        )}

        {activeTab === 'metrics' && <EntityMetricsTab entityType="invocation" entityId={inv.id} />}
        {activeTab === 'timeline' && <InvocationTimelineTab invocation={inv} />}
        {activeTab === 'logs' && <LogsTab entityType="invocation" entityId={inv.id} />}
      </EntityDetailTabs>
    </>
  );
}
