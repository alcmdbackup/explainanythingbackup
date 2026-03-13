// Standalone experiments list page. Reuses ExperimentHistory shared component.
'use client';

import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { ExperimentHistory } from '../_components/ExperimentHistory';

export default function ExperimentsListPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Experiments' },
      ]} />

      <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
        Experiments
      </h1>

      <ExperimentHistory />
    </div>
  );
}
