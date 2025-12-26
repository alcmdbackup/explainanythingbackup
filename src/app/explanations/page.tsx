import { getRecentExplanations } from '@/lib/services/explanations';
import { ExploreGalleryPage } from '@/components/explore';
import { type ExplanationFullDbType, type SortMode, type TimePeriod } from '@/lib/schemas/schemas';

// Disable caching to ensure time period filter affects query results
export const dynamic = 'force-dynamic';

interface ExplanationsPageProps {
    searchParams: Promise<{ sort?: string; t?: string }>;
}

export default async function ExplanationsPage({ searchParams }: ExplanationsPageProps) {
    const params = await searchParams;
    const sort = (params.sort as SortMode) || 'new';
    const period = (params.t as TimePeriod) || 'week';

    let recentExplanations: ExplanationFullDbType[] = [];
    let error: string | null = null;
    try {
        recentExplanations = await getRecentExplanations(20, 0, { sort, period });
    } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to load recent explanations';
    }

    return (
        <ExploreGalleryPage
            explanations={recentExplanations}
            error={error}
            sort={sort}
            period={period}
        />
    );
}
