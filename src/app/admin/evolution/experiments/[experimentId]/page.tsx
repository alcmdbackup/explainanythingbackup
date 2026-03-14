// Experiment detail page: shows comprehensive status for a single experiment.
// Server component fetches status, then client ExperimentDetailContent renders detail views.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getExperimentStatusAction } from '@evolution/services/experimentActions';
import { ExperimentDetailContent } from './ExperimentDetailContent';

interface Props {
  params: Promise<{ experimentId: string }>;
}

export default async function ExperimentDetailPage({ params }: Props): Promise<JSX.Element> {
  const { experimentId } = await params;
  const result = await getExperimentStatusAction({ experimentId });
  if (!result.success || !result.data) notFound();

  const status = result.data;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Experiments', href: '/admin/evolution/experiments' },
          { label: 'Experiment' },
          { label: status.name },
        ]}
      />
      <ExperimentDetailContent status={status} />
    </div>
  );
}
