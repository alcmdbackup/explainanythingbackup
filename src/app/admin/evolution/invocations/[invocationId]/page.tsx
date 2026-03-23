// Invocation detail page. Server wrapper that fetches data and passes to client component.
import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getInvocationDetailAction } from '@evolution/services/invocationActions';
import { InvocationDetailContent } from './InvocationDetailContent';

interface Props {
  params: Promise<{ invocationId: string }>;
}

export default async function InvocationDetailPage({ params }: Props): Promise<JSX.Element> {
  const { invocationId } = await params;
  const result = await getInvocationDetailAction(invocationId);
  if (!result.success || !result.data) notFound();

  const inv = result.data;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Invocations', href: '/admin/evolution/invocations' },
          { label: `${invocationId.substring(0, 8)}...` },
        ]}
      />

      <InvocationDetailContent invocation={inv} />
    </div>
  );
}

