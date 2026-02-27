// Article detail page: shows cross-run evolution history for a single explanation/article.
// Server component fetches overview, then client tabs load their own data.

import { notFound } from 'next/navigation';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getArticleOverviewAction } from '@evolution/services/articleDetailActions';
import { ArticleOverviewCard } from '@evolution/components/evolution/article/ArticleOverviewCard';
import { ArticleDetailTabs } from './ArticleDetailTabs';

interface Props {
  params: Promise<{ explanationId: string }>;
}

export default async function ArticleDetailPage({ params }: Props) {
  const { explanationId: rawId } = await params;
  const explanationId = parseInt(rawId, 10);
  if (isNaN(explanationId)) notFound();

  const result = await getArticleOverviewAction(explanationId);
  if (!result.success || !result.data) notFound();

  const overview = result.data;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/quality/evolution' },
          { label: 'Article' },
          { label: overview.title },
        ]}
      />
      <ArticleOverviewCard overview={overview} />
      <ArticleDetailTabs explanationId={explanationId} />
    </div>
  );
}
