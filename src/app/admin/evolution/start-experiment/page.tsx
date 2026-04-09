// Start experiment page. Uses ExperimentForm and ExperimentStatusCard shared components.
'use client';

import { useState, useEffect } from 'react';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { ExperimentForm } from '../_components/ExperimentForm';
import { ExperimentStatusCard } from '../_components/ExperimentStatusCard';

export default function StartExperimentPage(): JSX.Element {
  useEffect(() => { document.title = 'Start Experiment | Evolution'; }, []);
  const [activeExperimentId, setActiveExperimentId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Start Experiment' },
      ]} />

      <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
        Start Experiment
      </h1>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ExperimentForm onCreated={(id) => setActiveExperimentId(id)} />
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
