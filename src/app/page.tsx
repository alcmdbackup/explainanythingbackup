'use client';

import SearchBar from '@/components/SearchBar';
import Navigation from '@/components/Navigation';

export default function Home() {
    return (
        <div className="min-h-screen bg-[var(--surface-primary)] flex flex-col">
            <Navigation showSearchBar={false} />
            <div className="flex-1 flex items-center justify-center">
                <main className="container mx-auto px-8 max-w-2xl">
                    <div className="text-center mb-12 atlas-animate-fade-up">
                        <h1 className="atlas-display text-[var(--text-primary)] mb-4">
                            Explain Anything
                        </h1>
                        <p className="atlas-ui text-[var(--text-muted)] tracking-wide">
                            Learn about any topic, simply explained
                        </p>
                    </div>
                    <div className="flex flex-col items-center atlas-animate-fade-up" style={{ animationDelay: '100ms' }}>
                        <div className="w-full">
                            <SearchBar
                                variant="home"
                                placeholder="What would you like to learn?"
                                maxLength={150}
                            />
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
}
