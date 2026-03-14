// Start experiment page. Uses ExperimentForm and ExperimentStatusCard shared components.
'use client';

import { useState } from 'react';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { ExperimentForm } from '../_components/ExperimentForm';
import { ExperimentStatusCard } from '../_components/ExperimentStatusCard';

export default function StartExperimentPage(): JSX.Element {
  const [activeExperimentId, setActiveExperimentId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Start Experiment' },
      ]} />

      <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
        Start Experiment
      </h1>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ExperimentForm onStarted={(id) => setActiveExperimentId(id)} />
        {activeExperimentId && (
          <ExperimentStatusCard
            experimentId={activeExperimentId}
            onCancelled={() => setActiveExperimentId(null)}
          />
        )}
      </div>
    </div>
  );
}
