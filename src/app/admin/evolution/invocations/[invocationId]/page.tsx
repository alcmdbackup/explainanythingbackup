// Invocation detail page: deep-dive into a single agent invocation's execution,
// before/after variant diffs, and Elo rating changes.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getInvocationFullDetailAction } from '@evolution/services/evolutionVisualizationActions';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { InvocationDetailContent } from './InvocationDetailContent';

interface Props {
  params: Promise<{ invocationId: string }>;
}

export default async function InvocationDetailPage({ params }: Props): Promise<JSX.Element> {
  const { invocationId } = await params;

  const result = await getInvocationFullDetailAction(invocationId);
  if (!result.success || !result.data) notFound();

  const { invocation, run, diffMetrics, inputVariant, variantDiffs, eloHistory } = result.data;

  const breadcrumbItems = [
    { label: 'Runs', href: '/admin/evolution/runs' },
    { label: `Run ${invocation.runId.substring(0, 8)}`, href: buildRunUrl(invocation.runId) },
    { label: `${invocation.agentName} (Iter ${invocation.iteration})` },
  ];

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb items={breadcrumbItems} />
      <InvocationDetailContent
        invocation={invocation}
        run={run}
        diffMetrics={diffMetrics}
        inputVariant={inputVariant}
        variantDiffs={variantDiffs}
        eloHistory={eloHistory}
      />
    </div>
  );
}
