// Client component for tactic detail — tabs for overview, metrics, variants, runs, by-prompt.

'use client';

import { EntityDetailHeader, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { EntityMetricsTab } from '@evolution/components/evolution/tabs/EntityMetricsTab';
import { TacticPromptPerformanceTable } from '@evolution/components/evolution/tabs/TacticPromptPerformanceTable';
import type { TacticDetailRow } from '@evolution/services/tacticActions';
import type { TabDef } from '@evolution/lib/core/types';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'variants', label: 'Variants' },
  { id: 'runs', label: 'Runs' },
  { id: 'by-prompt', label: 'By Prompt' },
];

interface Props {
  tactic: TacticDetailRow;
}

export function TacticDetailContent({ tactic }: Props) {
  const [activeTab, setActiveTab] = useTabState(TABS);

  const statusBadge = (
    <span className={`text-xs px-1.5 py-0.5 rounded ${tactic.is_predefined ? 'bg-blue-900/30 text-blue-300' : 'bg-green-900/30 text-green-300'}`}>
      {tactic.is_predefined ? 'System' : 'Custom'}
    </span>
  );

  return (
    <div className="space-y-6">
      <EntityDetailHeader
        title={tactic.name}
        entityId={tactic.id}
        statusBadge={statusBadge}
      />

      <EntityDetailTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <span className="text-[var(--text-muted)]">Agent Type:</span>{' '}
                  <span className="font-mono">{tactic.agent_type}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Category:</span>{' '}
                  <span>{tactic.category ?? '—'}</span>
                </div>
              </div>
            </div>

            {tactic.preamble && (
              <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
                <h3 className="font-ui text-sm font-semibold text-[var(--text-primary)] mb-2">Preamble</h3>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{tactic.preamble}</p>
              </div>
            )}

            {tactic.instructions && (
              <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
                <h3 className="font-ui text-sm font-semibold text-[var(--text-primary)] mb-2">Instructions</h3>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{tactic.instructions}</p>
              </div>
            )}

            {!tactic.preamble && !tactic.instructions && (
              <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 text-center text-[var(--text-muted)] text-sm">
                Custom tactic — prompt not defined in code registry.
              </div>
            )}

            <div className="text-xs text-[var(--text-muted)]">
              {tactic.is_predefined
                ? 'Read-only — system-defined tactic. Prompt source: git-controlled code.'
                : 'Custom tactic — created via admin UI.'}
            </div>
          </div>
        )}

        {activeTab === 'metrics' && (
          <EntityMetricsTab entityType="tactic" entityId={tactic.id} />
        )}

        {activeTab === 'variants' && (
          <div className="text-sm text-[var(--text-muted)] p-4">
            Variants tab — shows all variants produced by this tactic across runs. Coming in Phase 3.
          </div>
        )}

        {activeTab === 'runs' && (
          <div className="text-sm text-[var(--text-muted)] p-4">
            Runs tab — shows all runs that used this tactic. Coming in Phase 3.
          </div>
        )}

        {activeTab === 'by-prompt' && (
          <TacticPromptPerformanceTable tacticName={tactic.name} />
        )}
      </EntityDetailTabs>
    </div>
  );
}
