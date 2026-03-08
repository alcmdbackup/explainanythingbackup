// Variant detail page: deep-dive into a single variant's metadata, content, lineage, and matches.
// Server component shell fetches data, client VariantDetailContent handles tabs.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getVariantFullDetailAction } from '@evolution/services/variantDetailActions';
import { buildRunUrl, buildExplanationUrl } from '@evolution/lib/utils/evolutionUrls';
import { VariantDetailContent } from './VariantDetailContent';

interface Props {
  params: Promise<{ variantId: string }>;
}

export default async function VariantDetailPage({ params }: Props) {
  const { variantId } = await params;
  if (!variantId) notFound();

  const result = await getVariantFullDetailAction(variantId);
  if (!result.success || !result.data) notFound();

  const variant = result.data;

  const breadcrumbItems = [
    { label: 'Runs', href: '/admin/evolution/runs' },
    ...(variant.explanationId != null
      ? [{ label: variant.explanationTitle ?? `Explanation #${variant.explanationId}`, href: buildExplanationUrl(variant.explanationId) }]
      : []),
    { label: `Run ${variant.runId.substring(0, 8)}`, href: buildRunUrl(variant.runId) },
    { label: `Variant ${variantId.substring(0, 8)}` },
  ];

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb items={breadcrumbItems} />
      <VariantDetailContent variant={variant} variantId={variantId} />
    </div>
  );
}
