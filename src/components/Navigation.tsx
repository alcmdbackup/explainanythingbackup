'use client';

import Link from 'next/link';
import { signOut } from '@/app/login/actions';
import SearchBar from '@/components/SearchBar';

interface NavigationProps {
    showSearchBar?: boolean;
    searchBarProps?: {
        placeholder?: string;
        maxLength?: number;
        initialValue?: string;
        onSearch?: (query: string) => void;
        disabled?: boolean;
    };
}

/**
 * Reusable navigation component with optional search bar
 * Midnight Scholar theme - Library header aesthetic
 *
 * Features:
 * - Elegant serif logo with gold accent
 * - Gold underline hover animations on links
 * - Integrated search bar with scholarly styling
 * - Dark mode support with lamplight accents
 */
export default function Navigation({
    showSearchBar = true,
    searchBarProps = {}
}: NavigationProps) {
    return (
        <nav className="scholar-nav bg-[var(--surface-secondary)] border-b border-[var(--border-default)] relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    {/* Logo - Elegant serif treatment */}
                    <Link href="/" className="group flex items-center gap-2">
                        {/* Decorative book icon */}
                        <svg
                            className="w-7 h-7 text-[var(--accent-gold)] transition-transform duration-300 group-hover:scale-110"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        >
                            <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <h1 className="text-xl font-display font-semibold text-[var(--text-primary)] tracking-wide">
                            <span className="text-[var(--accent-gold)]">Explain</span>
                            <span>Anything</span>
                        </h1>
                    </Link>

                    {/* Optional Search Bar - Catalog search styling */}
                    {showSearchBar && (
                        <div className="flex-1 max-w-lg mx-8">
                            <SearchBar
                                variant="nav"
                                placeholder="Search the archives..."
                                maxLength={100}
                                {...searchBarProps}
                            />
                        </div>
                    )}

                    {/* Navigation Links with gold underline hover */}
                    <div className="flex items-center space-x-8">
                        <Link
                            href="/"
                            className="scholar-nav-link text-[var(--text-secondary)] hover:text-[var(--accent-gold)] text-sm font-ui font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 rounded px-1"
                        >
                            Home
                        </Link>
                        <Link
                            href="/userlibrary"
                            className="scholar-nav-link text-[var(--text-secondary)] hover:text-[var(--accent-gold)] text-sm font-ui font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 rounded px-1"
                        >
                            My Library
                        </Link>
                        <Link
                            href="/explanations"
                            className="scholar-nav-link text-[var(--text-secondary)] hover:text-[var(--accent-gold)] text-sm font-ui font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 rounded px-1"
                        >
                            Explore
                        </Link>
                        <Link
                            href="/settings"
                            className="scholar-nav-link text-[var(--text-secondary)] hover:text-[var(--accent-gold)] text-sm font-ui font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 rounded px-1"
                        >
                            Settings
                        </Link>
                        <button
                            onClick={() => signOut()}
                            data-testid="logout-button"
                            className="text-[var(--text-muted)] hover:text-[var(--destructive)] text-sm font-ui font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--destructive)] focus-visible:ring-offset-2 rounded px-1"
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </div>
            {/* Gold accent line at bottom */}
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent-gold)] to-transparent opacity-60"></div>
        </nav>
    );
}
