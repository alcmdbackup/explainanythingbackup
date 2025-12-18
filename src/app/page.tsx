'use client';

import SearchBar from '@/components/SearchBar';
import Navigation from '@/components/Navigation';

/**
 * Homepage - Grand Library Entrance
 * Midnight Scholar theme - Elegant, scholarly entry point
 */
export default function Home() {
    return (
        <div className="min-h-screen bg-[var(--surface-primary)] flex flex-col">
            <Navigation showSearchBar={false} />

            {/* Hero Section - Library Entrance */}
            <div className="flex-1 flex flex-col items-center justify-center relative">
                {/* Decorative background elements */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[var(--accent-gold)]/5 rounded-full blur-3xl"></div>
                    <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[var(--accent-copper)]/5 rounded-full blur-3xl"></div>
                </div>

                <main className="container mx-auto px-4 max-w-2xl relative z-10">
                    {/* Main Heading */}
                    <div className="text-center mb-10">
                        {/* Decorative flourish */}
                        <div className="flex items-center justify-center gap-4 mb-6">
                            <div className="h-px w-12 bg-gradient-to-r from-transparent to-[var(--accent-gold)]"></div>
                            <svg
                                className="w-8 h-8 text-[var(--accent-gold)]"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                            >
                                <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <div className="h-px w-12 bg-gradient-to-l from-transparent to-[var(--accent-gold)]"></div>
                        </div>

                        <h1 className="text-5xl md:text-6xl font-display font-bold text-[var(--text-primary)] mb-4 tracking-tight">
                            <span className="text-[var(--accent-gold)]">Explain</span>
                            <span className="text-[var(--text-primary)]">Anything</span>
                        </h1>

                        <p className="text-lg font-serif text-[var(--text-secondary)] italic max-w-md mx-auto">
                            Enter the library of knowledge — discover explanations for any topic you seek
                        </p>
                    </div>

                    {/* Search Bar - Catalog Style */}
                    <div className="flex flex-col items-center">
                        <div className="w-full scholar-card p-1">
                            <SearchBar
                                variant="home"
                                placeholder="What would you like to understand?"
                                maxLength={150}
                            />
                        </div>

                        {/* Suggested topics */}
                        <div className="mt-6 flex flex-wrap justify-center gap-2">
                            <span className="text-xs font-sans text-[var(--text-muted)] uppercase tracking-wider mr-2">
                                Popular:
                            </span>
                            {['Quantum Physics', 'Machine Learning', 'Philosophy', 'Economics'].map((topic) => (
                                <button
                                    key={topic}
                                    onClick={() => window.location.href = `/results?q=${encodeURIComponent(topic)}`}
                                    className="px-3 py-1 text-xs font-sans text-[var(--text-secondary)] border border-[var(--border-default)] rounded-page hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)] transition-all duration-200 bg-[var(--surface-secondary)]"
                                >
                                    {topic}
                                </button>
                            ))}
                        </div>
                    </div>
                </main>
            </div>

            {/* Footer accent */}
            <div className="h-1 bg-gradient-to-r from-transparent via-[var(--accent-gold)]/30 to-transparent"></div>
        </div>
    );
}
