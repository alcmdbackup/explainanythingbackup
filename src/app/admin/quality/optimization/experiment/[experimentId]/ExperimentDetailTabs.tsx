// Client tab bar for experiment detail page: Rounds, Runs, and Report tabs.
// Each tab lazily renders its content on selection.

'use client';

import { useState } from 'react';
import type { ExperimentStatus } from '@evolution/services/experimentActions';
import { RoundsTab } from './RoundsTab';
import { RunsTab } from './RunsTab';
import { ReportTab } from './ReportTab';

type TabId = 'rounds' | 'runs' | 'report';

const TABS: { id: TabId; label: string }[] = [
  { id: 'rounds', label: 'Rounds' },
  { id: 'runs', label: 'Runs' },
  { id: 'report', label: 'Report' },
];

interface ExperimentDetailTabsProps {
  status: ExperimentStatus;
}

export function ExperimentDetailTabs({ status }: ExperimentDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('rounds');

  return (
    <div>
      <div className="flex gap-1 border-b border-[var(--border-default)] mb-4">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium font-ui transition-colors ${
              activeTab === tab.id
                ? 'text-[var(--accent-gold)] border-b-2 border-[var(--accent-gold)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'rounds' && <RoundsTab rounds={status.rounds} />}
      {activeTab === 'runs' && <RunsTab experimentId={status.id} />}
      {activeTab === 'report' && (
        <ReportTab
          experimentId={status.id}
          status={status.status}
          resultsSummary={status.resultsSummary}
        />
      )}
    </div>
  );
}
