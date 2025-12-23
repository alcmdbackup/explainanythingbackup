'use client';

import { useState } from 'react';
import SearchBar from '@/components/SearchBar';
import Navigation from '@/components/Navigation';
import { type SourceChipType } from '@/lib/schemas/schemas';

export default function Home() {
    const [sources, setSources] = useState<SourceChipType[]>([]);

    return (
        <div className="min-h-screen bg-[var(--surface-primary)] flex flex-col vignette-overlay paper-texture">
            <Navigation showSearchBar={false} />
            <div className="flex-1 flex items-center justify-center">
                <main className="container mx-auto px-8 max-w-2xl">
                    <div className="text-center mb-12">
                        <h1 className="atlas-display text-[var(--text-primary)] mb-4 atlas-animate-fade-up stagger-1">
                            Explain Anything
                        </h1>
                        <p className="atlas-ui text-[var(--text-muted)] tracking-wide atlas-animate-fade-up stagger-2">
                            Learn about any topic, simply explained
                        </p>
                    </div>
                    <div className="flex flex-col items-center atlas-animate-fade-up stagger-3">
                        <div className="w-full">
                            <SearchBar
                                variant="home"
                                placeholder="What would you like to learn?"
                                maxLength={150}
                                sources={sources}
                                onSourcesChange={setSources}
                            />
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
