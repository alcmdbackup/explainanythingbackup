'use client';

/**
 * Navigation component with dark navy theme and optional search bar.
 * Uses hardcoded "Darker Nav (Navy)" theme for consistent dark header styling.
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { signOut } from '@/app/login/actions';
import { clearRememberMe } from '@/lib/utils/supabase/rememberMe';
import SearchBar from '@/components/SearchBar';
import ImportModal from '@/components/import/ImportModal';
import ImportPreview from '@/components/import/ImportPreview';
import { type ImportSource } from '@/lib/schemas/schemas';

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

interface ImportData {
    title: string;
    content: string;
    source: ImportSource;
}

/**
 * Reusable navigation component with optional search bar
 */
export default function Navigation({
    showSearchBar = true,
    searchBarProps = {}
}: NavigationProps) {
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [previewData, setPreviewData] = useState<ImportData | null>(null);

    // Hardcoded "Darker Nav (Navy)" theme - permanent dark header styling
    const navColors = {
        bg: '#0d1628',
        text: '#ffffff',
        textMuted: '#ffffff',
        border: 'rgba(255, 255, 255, 0.12)',
        logo: '#ffffff',
        searchBg: 'rgba(255, 255, 255, 0.08)',
        searchText: '#ffffff',
        searchPlaceholder: 'rgba(255, 255, 255, 0.6)',
        searchBorder: 'rgba(255, 255, 255, 0.3)',
        importBg: '#ffffff',
        importText: '#0d1628',
        importBorder: 'rgba(255, 255, 255, 0.9)',
        isDark: true
    };

    const handleProcessed = useCallback((data: ImportData) => {
        setPreviewData(data);
        setImportModalOpen(false);
    }, []);

    const handlePreviewBack = useCallback(() => {
        setPreviewData(null);
        setImportModalOpen(true);
    }, []);

    const handlePreviewClose = useCallback((open: boolean) => {
        if (!open) {
            setPreviewData(null);
        }
    }, []);

    return (
        <nav
            className="scholar-nav dark-nav border-b relative paper-texture"
            style={{
                backgroundColor: navColors.bg,
                borderColor: navColors.border
            }}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    {/* Logo - Elegant serif treatment */}
                    <Link href="/" className="group flex items-center gap-2">
                        {/* Decorative book icon - uses logo color for dark nav support */}
                        <svg
                            className="logo-book w-6 h-6"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            style={{ color: navColors.logo }}
                        >
                            <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <h1 className="text-lg font-display font-bold tracking-wide" style={{ color: navColors.logo }}>
                            <span>Explain</span>
                            <span>Anything</span>
                        </h1>
                    </Link>

                    {/* Optional Search Bar - Catalog search styling */}
                    {showSearchBar && (
                        <div className="flex-1 max-w-lg mx-8">
                            <SearchBar
                                variant="nav"
                                placeholder="Search..."
                                maxLength={100}
                                darkModeStyles={navColors.isDark ? {
                                    backgroundColor: navColors.searchBg,
                                    textColor: navColors.searchText,
                                    placeholderColor: navColors.searchPlaceholder,
                                    borderColor: navColors.searchBorder
                                } : undefined}
                                {...searchBarProps}
                            />
                        </div>
                    )}

                    {/* Navigation Links with gold underline hover */}
                    <div className="flex items-center space-x-6">
                        <Link
                            href="/"
                            className="scholar-nav-link hover:text-[var(--accent-gold)] text-base font-ui font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 rounded px-1"
                            style={{ color: navColors.textMuted }}
                        >
                            Home
                        </Link>
                        <Link
                            href="/userlibrary"
                            className="scholar-nav-link hover:text-[var(--accent-gold)] text-base font-ui font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 rounded px-1"
                            style={{ color: navColors.textMuted }}
                        >
                            Saved
                        </Link>
                        <Link
                            href="/explanations"
                            className="scholar-nav-link hover:text-[var(--accent-gold)] text-base font-ui font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 rounded px-1"
                            style={{ color: navColors.textMuted }}
                        >
                            Explore
                        </Link>
                        <Link
                            href="/settings"
                            className="scholar-nav-link hover:text-[var(--accent-gold)] text-base font-ui font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2 rounded px-1"
                            style={{ color: navColors.textMuted }}
                        >
                            Settings
                        </Link>

                        <button
                            onClick={() => {
                                clearRememberMe();
                                signOut();
                            }}
                            data-testid="logout-button"
                            className="scholar-nav-link hover:text-[var(--destructive)] text-base font-ui font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--destructive)] focus-visible:ring-offset-2 rounded px-1"
                            style={{ color: navColors.textMuted }}
                        >
                            Logout
                        </button>

                        {/* Import CTA Button - Gold pill on dark nav */}
                        <button
                            data-testid="import-button"
                            onClick={() => setImportModalOpen(true)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-ui font-semibold transition-all duration-200 shadow-md hover:shadow-lg hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-gold)] focus-visible:ring-offset-2"
                            style={{
                                backgroundColor: navColors.importBg,
                                borderColor: navColors.importBorder,
                                color: navColors.importText,
                                borderWidth: '1px',
                                borderStyle: 'solid'
                            }}
                        >
                            <Plus className="h-4 w-4" />
                            Import
                        </button>
                    </div>
                </div>
            </div>
            {/* Gold accent line at bottom - solid for better nav/content separation */}
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[var(--accent-gold)]"></div>

            {/* Import Modal */}
            <ImportModal
                open={importModalOpen}
                onOpenChange={setImportModalOpen}
                onProcessed={handleProcessed}
            />

            {/* Import Preview */}
            {previewData && (
                <ImportPreview
                    open={!!previewData}
                    onOpenChange={handlePreviewClose}
                    onBack={handlePreviewBack}
                    title={previewData.title}
                    content={previewData.content}
                    source={previewData.source}
                />
            )}
        </nav>
    );
}
