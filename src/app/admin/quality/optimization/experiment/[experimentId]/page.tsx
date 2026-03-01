// Experiment detail page: shows comprehensive data for a single experiment.
// Server component fetches status, then client tabs render detail views.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getExperimentStatusAction } from '@evolution/services/experimentActions';
import { ExperimentOverviewCard } from './ExperimentOverviewCard';
import { ExperimentDetailTabs } from './ExperimentDetailTabs';

interface Props {
  params: Promise<{ experimentId: string }>;
}

export default async function ExperimentDetailPage({ params }: Props) {
  const { experimentId } = await params;
  const result = await getExperimentStatusAction({ experimentId });
  if (!result.success || !result.data) notFound();

  const status = result.data;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Rating Optimization', href: '/admin/quality/optimization' },
          { label: 'Experiment' },
          { label: status.name },
        ]}
      />
      <ExperimentOverviewCard status={status} />
      <ExperimentDetailTabs status={status} />
    </div>
  );
}
