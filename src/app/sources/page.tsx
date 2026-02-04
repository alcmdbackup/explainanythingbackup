/**
 * /sources — Server component that fetches top sources for the leaderboard page.
 * Passes data and filter state to the client-side SourceLeaderboardPage component.
 */

import { getTopSources, type TimePeriodFilter, type SourceSortMode } from '@/lib/services/sourceDiscovery';
import { type SourceCitationCountType } from '@/lib/schemas/schemas';
import SourceLeaderboardPage from '@/components/sources/SourceLeaderboardPage';

export const dynamic = 'force-dynamic';

interface SourcesPageProps {
  searchParams: Promise<{ sort?: string; t?: string }>;
}

export default async function SourcesPage({ searchParams }: SourcesPageProps) {
  const params = await searchParams;
  const sort = (params.sort as SourceSortMode) || 'citations';
  const period = (params.t as TimePeriodFilter) || 'all';

  let sources: SourceCitationCountType[] = [];
  let error: string | null = null;

  try {
    sources = await getTopSources({ sort, period, limit: 50 });
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load sources';
  }

  return (
    <SourceLeaderboardPage
      sources={sources}
      error={error}
      sort={sort}
      period={period}
    />
  );
}
