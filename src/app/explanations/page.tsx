'use client';

import { useState, useEffect } from 'react';
import { type ExplanationFullDbType } from '@/lib/schemas/schemas';
import { getRecentExplanationsAction } from '@/actions/actions';
import { logger } from '@/lib/server_utilities';
import ExplanationsTablePage from '@/components/ExplanationsTablePage';

export default function ExplanationsPage() {
    const [recentExplanations, setRecentExplanations] = useState<ExplanationFullDbType[]>([]);
    const [error, setError] = useState<string | null>(null);
    // const router = useRouter(); // No longer needed here

    useEffect(() => {
        loadRecentExplanations();
    }, []);

    const loadRecentExplanations = async () => {
        try {
            const explanations = await getRecentExplanationsAction(10); // Showing more explanations on dedicated page
            setRecentExplanations(explanations);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load recent explanations';
            logger.error('Failed to load recent explanations:', { error: errorMessage });
            setError(errorMessage);
        }
    };

    return (
        <ExplanationsTablePage
            explanations={recentExplanations}
            error={error}
        />
    );
} 