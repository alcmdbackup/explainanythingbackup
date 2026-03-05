// Client tab bar for experiment detail page: Analysis, Runs, and Report tabs.
// Each tab lazily renders its content on selection.

'use client';

import { useState } from 'react';
import type { ExperimentStatus } from '@evolution/services/experimentActions';
import { ExperimentAnalysisCard } from './ExperimentAnalysisCard';
import { RunsTab } from './RunsTab';
import { ReportTab } from './ReportTab';

type TabId = 'analysis' | 'runs' | 'report';

const TABS: { id: TabId; label: string }[] = [
  { id: 'analysis', label: 'Analysis' },
  { id: 'runs', label: 'Runs' },
  { id: 'report', label: 'Report' },
];

interface ExperimentDetailTabsProps {
  status: ExperimentStatus;
}

export function ExperimentDetailTabs({ status }: ExperimentDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('analysis');

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

      {activeTab === 'analysis' && <ExperimentAnalysisCard experiment={status} />}
      {activeTab === 'runs' && <RunsTab experimentId={status.id} design={status.design} />}
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
