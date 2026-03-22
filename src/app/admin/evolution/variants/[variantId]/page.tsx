// Variant detail page. Server component that fetches variant data and delegates to VariantDetailContent.
import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getVariantFullDetailAction } from '@evolution/services/variantDetailActions';
import { VariantDetailContent } from './VariantDetailContent';

interface Props {
  params: Promise<{ variantId: string }>;
}

export default async function VariantDetailPage({ params }: Props): Promise<JSX.Element> {
  const { variantId } = await params;
  const result = await getVariantFullDetailAction(variantId);
  if (!result.success || !result.data) notFound();

  const variant = result.data;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Variants', href: '/admin/evolution/variants' },
          { label: `${variantId.substring(0, 8)}...` },
        ]}
      />
      <VariantDetailContent variant={variant} />
    </div>
  );
}
