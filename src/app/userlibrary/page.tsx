'use client';

import { useState, useEffect } from 'react';
import { type ExplanationFullDbType } from '@/lib/schemas/schemas';
import { getUserLibraryExplanations } from '@/lib/services/userLibrary';
import { logger } from '@/lib/server_utilities';
import ExplanationsTablePage from '@/components/ExplanationsTablePage';
import { supabase_browser } from '@/lib/supabase';

export default function UserLibraryPage() {
    const [userExplanations, setUserExplanations] = useState<ExplanationFullDbType[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        loadUserExplanations();
    }, []);

    const loadUserExplanations = async () => {
        setLoading(true);
        try {
            // Fetch user id from supabase
            const { data: userData, error: userError } = await supabase_browser.auth.getUser();
            if (userError || !userData?.user?.id) {
                throw new Error('Could not get user information. Please log in.');
            }
            const userId = userData.user.id;
            const explanations = await getUserLibraryExplanations(userId);
            setUserExplanations(explanations);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load user library explanations';
            logger.error('Failed to load user library explanations:', { error: errorMessage });
            setError(errorMessage);
        }
        setLoading(false);
    };

    return (
        loading ? (
            <div className="flex justify-center items-center min-h-screen">
                <span className="text-lg text-gray-700 dark:text-gray-200">Loading your library...</span>
            </div>
        ) : (
            <ExplanationsTablePage
                explanations={userExplanations}
                error={error}
            />
        )
    );
} 