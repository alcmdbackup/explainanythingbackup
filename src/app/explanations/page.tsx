import { getRecentExplanations } from '@/lib/services/explanations.server';
import ExplanationsTablePage from '@/components/ExplanationsTablePage';
import { type ExplanationFullDbType } from '@/lib/schemas/schemas';

export default async function ExplanationsPage() {
    let recentExplanations: ExplanationFullDbType[] = [];
    let error: string | null = null;
    try {
        recentExplanations = await getRecentExplanations(10);
    } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to load recent explanations';
    }

    return (
        <ExplanationsTablePage
            explanations={recentExplanations}
            error={error}
        />
    );
} 