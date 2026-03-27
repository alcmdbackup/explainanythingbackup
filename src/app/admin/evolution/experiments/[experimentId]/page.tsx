// Experiment detail page: shows comprehensive status for a single experiment.
// Server component fetches experiment via V2 action, then client ExperimentDetailContent renders detail views.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getExperimentAction } from '@evolution/services/experimentActions';
import { ExperimentDetailContent } from './ExperimentDetailContent';

interface Props {
  params: Promise<{ experimentId: string }>;
}

export default async function ExperimentDetailPage({ params }: Props): Promise<JSX.Element> {
  const { experimentId } = await params;
  const result = await getExperimentAction({ experimentId });
  if (!result.success || !result.data) notFound();

  const experiment = result.data;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Experiments', href: '/admin/evolution/experiments' },
          { label: experiment.name },
        ]}
      />
      <ExperimentDetailContent experiment={experiment} />
    </div>
  );
}
