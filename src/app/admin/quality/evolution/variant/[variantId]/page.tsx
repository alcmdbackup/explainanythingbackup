// Variant detail page: deep-dive into a single variant's metadata, content, lineage, and matches.
// Server component fetches core data, client components handle interactive sections.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getVariantFullDetailAction } from '@evolution/services/variantDetailActions';
import { VariantOverviewCard } from '@evolution/components/evolution/variant/VariantOverviewCard';
import { VariantContentSection } from '@evolution/components/evolution/variant/VariantContentSection';
import { VariantLineageSection } from '@evolution/components/evolution/variant/VariantLineageSection';
import { VariantMatchHistory } from '@evolution/components/evolution/variant/VariantMatchHistory';
import { buildArticleUrl, buildRunUrl } from '@evolution/lib/utils/evolutionUrls';

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
    { label: 'Evolution', href: '/admin/quality/evolution' },
    ...(variant.explanationId != null
      ? [{ label: variant.explanationTitle ?? `Article #${variant.explanationId}`, href: buildArticleUrl(variant.explanationId) }]
      : []),
    { label: `Run ${variant.runId.substring(0, 8)}`, href: buildRunUrl(variant.runId) },
    { label: `Variant ${variantId.substring(0, 8)}` },
  ];

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb items={breadcrumbItems} />
      <VariantOverviewCard variant={variant} />
      <VariantContentSection content={variant.variantContent} />
      <VariantLineageSection variantId={variantId} />
      <VariantMatchHistory variantId={variantId} />
    </div>
  );
}
