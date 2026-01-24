/**
 * Home page with tabbed interface for Search and Import content creation modes.
 * Search tab provides query input with sources and tag preferences.
 * Import tab allows pasting AI content for processing.
 */
'use client';

import { useState, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import ImportPreview from '@/components/import/ImportPreview';
import { HomeTabs, HomeSearchPanel, HomeImportPanel, type HomeTab } from '@/components/home';
import { type ImportSource, type SourceChipType } from '@/lib/schemas/schemas';

interface ImportData {
    title: string;
    content: string;
    source: ImportSource;
}

export default function Home() {
    const [activeTab, setActiveTab] = useState<HomeTab>('search');
    const [sources, setSources] = useState<SourceChipType[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [previewData, setPreviewData] = useState<ImportData | null>(null);

    const handleProcessed = useCallback((data: ImportData) => {
        setPreviewData(data);
    }, []);

    const handlePreviewBack = useCallback(() => {
        setPreviewData(null);
        setActiveTab('import');
    }, []);

    const handlePreviewClose = useCallback((open: boolean) => {
        if (!open) {
            setPreviewData(null);
        }
    }, []);

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
                        {/* Tab switcher */}
                        <HomeTabs
                            activeTab={activeTab}
                            onTabChange={setActiveTab}
                        />

                        {/* Tab panels */}
                        <div className="w-full">
                            {activeTab === 'search' ? (
                                <HomeSearchPanel
                                    sources={sources}
                                    onSourcesChange={setSources}
                                    query={searchQuery}
                                    onQueryChange={setSearchQuery}
                                />
                            ) : (
                                <HomeImportPanel
                                    onProcessed={handleProcessed}
                                />
                            )}
                        </div>
                    </div>
                </main>
            </div>

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
        </div>
    );
}
