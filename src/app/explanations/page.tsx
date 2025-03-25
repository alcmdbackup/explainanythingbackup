'use client';

import { useState, useEffect } from 'react';
import { type ExplanationFullDbType } from '@/lib/schemas/schemas';
import { getRecentExplanations } from '@/lib/services/explanations';
import { logger } from '@/lib/server_utilities';
import Link from 'next/link';

export default function ExplanationsPage() {
    const [recentExplanations, setRecentExplanations] = useState<ExplanationFullDbType[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadRecentExplanations();
    }, []);

    const loadRecentExplanations = async () => {
        try {
            const explanations = await getRecentExplanations(10); // Showing more explanations on dedicated page
            setRecentExplanations(explanations);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load recent explanations';
            logger.error('Failed to load recent explanations:', { error: errorMessage });
            setError(errorMessage);
        }
    };

    return (
        <div className="min-h-screen bg-white dark:bg-gray-900">
            <main className="container mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-8">
                    All Explanations
                </h1>

                {error && (
                    <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-md">
                        {error}
                    </div>
                )}

                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {recentExplanations.map((explanation) => (
                        <div 
                            key={explanation.id} 
                            className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg shadow-sm"
                        >
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                                {explanation.title}
                            </h2>
                            <div className="text-gray-600 dark:text-gray-400">
                                <p className="line-clamp-3">
                                    {explanation.content}
                                </p>
                                {explanation.content.length > 100 && (
                                    <Link 
                                        href={`/?explanation_id=${explanation.id}`}
                                        className="mt-4 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                    >
                                        View full explanation
                                    </Link>
                                )}
                            </div>
                            <p className="mt-4 text-sm text-gray-500">
                                {new Date(explanation.timestamp).toLocaleString()}
                            </p>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
} 