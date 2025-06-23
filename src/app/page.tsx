'use client';

import { useState } from 'react';
import SearchBar from '@/components/SearchBar';
import Navigation from '@/components/Navigation';

export default function Home() {
    const [isGeneratingExplanation, setIsGeneratingExplanation] = useState(false);

    const handleSearch = (query: string) => {
        setIsGeneratingExplanation(true);
        // The SearchBar component will handle navigation
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
            <Navigation showSearchBar={false} />
            <div className="flex-1 flex items-center justify-center">
                <main className="container mx-auto px-4 max-w-2xl">
                    <div className="text-center mb-8">
                        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-6 tracking-tight">
                            Explain Anything
                        </h1>
                    </div>
                    <div className="flex flex-col items-center">
                        <div className="w-full">
                            <SearchBar 
                                variant="home"
                                placeholder="Learn about any topic"
                                maxLength={150}
                            />
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
