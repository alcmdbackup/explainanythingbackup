'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import { type SourceChipType } from '@/lib/schemas/schemas';
import { SourceList } from '@/components/sources';

interface SearchBarProps {
    variant?: 'home' | 'nav';
    placeholder?: string;
    maxLength?: number;
    className?: string;
    initialValue?: string;
    onSearch?: (query: string, sources?: SourceChipType[]) => void;
    disabled?: boolean;
    // Source support (home variant only)
    sources?: SourceChipType[];
    onSourcesChange?: (sources: SourceChipType[]) => void;
    showSourcesSection?: boolean;
}

/**
 * The Atlas SearchBar - Minimal, elegant search input
 *
 * - home: Large centered search with prominent styling
 * - nav: Compact pill-shaped search for navigation
 *
 * Clean borders, subtle focus states, accent blue highlights
 */
export default function SearchBar({
    variant = 'home',
    placeholder = 'Learn about any topic',
    maxLength = 150,
    className = '',
    initialValue = '',
    onSearch,
    disabled = false,
    sources = [],
    onSourcesChange,
    showSourcesSection = false
}: SearchBarProps) {
    const [prompt, setPrompt] = useState(initialValue);
    const [isSourcesExpanded, setIsSourcesExpanded] = useState(showSourcesSection);
    const router = useRouter();

    useEffect(() => {
        setPrompt(initialValue);
    }, [initialValue]);

    // Expand sources section when sources are added
    useEffect(() => {
        if (sources.length > 0) {
            setIsSourcesExpanded(true);
        }
    }, [sources.length]);

    const handlePromptChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setPrompt(e.target.value);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim() || disabled) return;

        // Store sources in sessionStorage for results page
        const validSources = sources.filter(s => s.status === 'success');
        if (validSources.length > 0) {
            sessionStorage.setItem('pendingSources', JSON.stringify(validSources));
        } else {
            sessionStorage.removeItem('pendingSources');
        }

        if (onSearch) {
            onSearch(prompt, validSources.length > 0 ? validSources : undefined);
        } else {
            router.push(`/results?q=${encodeURIComponent(prompt)}`);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    // Source handlers for home variant
    const handleSourceAdded = (source: SourceChipType) => {
        if (!onSourcesChange) return;

        // Check if this is an update to an existing source (by URL)
        const existingIndex = sources.findIndex(s => s.url === source.url);

        if (existingIndex >= 0) {
            // Update existing chip (loading -> success/failed, or any other update)
            const newSources = [...sources];
            newSources[existingIndex] = source;
            onSourcesChange(newSources);
        } else {
            // Add new source chip
            onSourcesChange([...sources, source]);
        }
    };

    const handleSourceRemoved = (index: number) => {
        if (!onSourcesChange) return;
        const newSources = sources.filter((_, i) => i !== index);
        onSourcesChange(newSources);
    };

    const isHomeVariant = variant === 'home';
    const InputComponent = isHomeVariant ? 'textarea' : 'input';
    const inputProps = isHomeVariant ? { rows: 1 } : {};

    if (isHomeVariant) {
        // Home variant - Large, prominent search with optional sources
        return (
            <form onSubmit={handleSubmit} className={`w-full max-w-2xl mx-auto ${className}`}>
                <div className="relative group">
                    <InputComponent
                        value={prompt}
                        onChange={handlePromptChange}
                        onKeyDown={handleKeyDown}
                        data-testid="search-input"
                        className="w-full bg-[var(--surface-primary)] dark:bg-[var(--surface-primary)] border border-[var(--border-default)] focus:border-[var(--accent-gold)] px-6 py-4 text-lg text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors duration-200 atlas-body resize-none rounded-none search-focus-glow"
                        placeholder={placeholder}
                        maxLength={maxLength}
                        disabled={disabled}
                        {...inputProps}
                    />
                    <button
                        type="submit"
                        disabled={disabled || !prompt.trim()}
                        data-testid="search-submit"
                        className="absolute right-3 top-1/2 -translate-y-1/2 atlas-button disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {disabled ? (
                            <span className="atlas-loading-dots">
                                <span className="atlas-loading-dot"></span>
                                <span className="atlas-loading-dot"></span>
                                <span className="atlas-loading-dot"></span>
                            </span>
                        ) : 'Search'}
                    </button>
                </div>

                {/* Sources section - collapsible */}
                {onSourcesChange && (
                    <div className="mt-3">
                        <button
                            type="button"
                            onClick={() => setIsSourcesExpanded(!isSourcesExpanded)}
                            className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
                        >
                            {isSourcesExpanded ? (
                                <ChevronUpIcon className="w-4 h-4" />
                            ) : (
                                <ChevronDownIcon className="w-4 h-4" />
                            )}
                            <span>
                                {sources.length > 0
                                    ? `${sources.length} source${sources.length === 1 ? '' : 's'} added`
                                    : '+ Add sources'}
                            </span>
                        </button>

                        {isSourcesExpanded && (
                            <div className="mt-3 p-4 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page">
                                <p className="text-xs text-[var(--text-muted)] mb-3">
                                    Add URLs to ground the explanation with citations
                                </p>
                                <SourceList
                                    sources={sources}
                                    onSourceAdded={handleSourceAdded}
                                    onSourceRemoved={handleSourceRemoved}
                                    disabled={disabled}
                                />
                            </div>
                        )}
                    </div>
                )}
            </form>
        );
    }

    // Nav variant - Compact pill search
    return (
        <form onSubmit={handleSubmit} className={`w-full ${className}`}>
            <div className="flex items-center">
                <input
                    type="text"
                    value={prompt}
                    onChange={handlePromptChange}
                    data-testid="search-input"
                    className="w-full bg-transparent border border-[var(--border-default)] focus:border-[var(--accent-gold)] px-4 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors duration-200 atlas-ui rounded-full search-focus-glow"
                    placeholder={placeholder}
                    maxLength={maxLength}
                    disabled={disabled}
                />
            </div>
        </form>
    );
}
