'use client';

import { useState, useCallback } from 'react';
import SearchBar from '@/components/SearchBar';
import Navigation from '@/components/Navigation';
import ImportModal from '@/components/import/ImportModal';
import ImportPreview from '@/components/import/ImportPreview';
import { type ImportSource, type SourceChipType } from '@/lib/schemas/schemas';

interface ImportData {
    title: string;
    content: string;
    source: ImportSource;
}

export default function Home() {
    const [sources, setSources] = useState<SourceChipType[]>([]);
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [previewData, setPreviewData] = useState<ImportData | null>(null);

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
                        <button
                            onClick={() => setImportModalOpen(true)}
                            className="mt-4 text-sm text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors duration-200"
                        >
                            Or import from AI
                        </button>
                    </div>
                </main>
            </div>

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
        </div>
    );
}
