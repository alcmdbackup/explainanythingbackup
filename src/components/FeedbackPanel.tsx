'use client';

import { useState, useCallback } from 'react';
import { type TagModeState, type TagModeAction, getCurrentTags, getTagBarMode, isTagsModified } from '@/reducers/tagModeReducer';
import { type SourceChipType, TagBarMode } from '@/lib/schemas/schemas';
import { SourceList } from '@/components/sources';
import TagBar from '@/components/TagBar';

interface FeedbackPanelProps {
    tagState: TagModeState;
    dispatchTagAction: React.Dispatch<TagModeAction>;
    sources: SourceChipType[];
    onSourcesChange: (sources: SourceChipType[]) => void;
    onApply: (tagDescriptions: string[], sources: SourceChipType[]) => void;
    onReset: () => void;
    explanationId?: number | null;
    isStreaming?: boolean;
    className?: string;
}

/**
 * FeedbackPanel - Combined tags and sources panel for rewriting
 *
 * Allows users to:
 * - Modify tags (using embedded TagBar)
 * - Add/remove source URLs
 * - Apply both together for rewrite
 */
export default function FeedbackPanel({
    tagState,
    dispatchTagAction,
    sources,
    onSourcesChange,
    onApply,
    onReset,
    explanationId,
    isStreaming = false,
    className = ''
}: FeedbackPanelProps) {
    const tags = getCurrentTags(tagState);
    const modeOverride = getTagBarMode(tagState);
    const tagsModified = isTagsModified(tagState);

    // Track if sources have been modified
    const [initialSources] = useState<SourceChipType[]>(() => [...sources]);
    const sourcesModified = sources.length !== initialSources.length ||
        sources.some((s, i) => s.url !== initialSources[i]?.url);

    const hasAnyChanges = tagsModified || sourcesModified || sources.length > 0;

    // Extract active tag descriptions for apply
    const extractActiveTagDescriptions = useCallback((): string[] => {
        const tagDescriptions: string[] = [];
        tags.forEach(tag => {
            if ('tag_name' in tag) {
                if (tag.tag_active_current) {
                    tagDescriptions.push(tag.tag_description);
                }
            } else {
                if (tag.tag_active_current) {
                    const currentTag = tag.tags.find(t => t.id === tag.currentActiveTagId);
                    if (currentTag) {
                        tagDescriptions.push(currentTag.tag_description);
                    }
                }
            }
        });
        return tagDescriptions;
    }, [tags]);

    // Handle apply button
    const handleApply = useCallback(() => {
        const tagDescriptions = extractActiveTagDescriptions();
        const validSources = sources.filter(s => s.status === 'success');
        onApply(tagDescriptions, validSources);
    }, [extractActiveTagDescriptions, sources, onApply]);

    // Handle reset
    const handleReset = useCallback(() => {
        onSourcesChange([]);
        onReset();
    }, [onSourcesChange, onReset]);

    // Source handlers
    const handleSourceAdded = useCallback((source: SourceChipType) => {
        // Check if this is an update to an existing loading source
        const existingIndex = sources.findIndex(
            s => s.url === source.url && s.status === 'loading'
        );

        if (existingIndex >= 0 && source.status !== 'loading') {
            // Update existing loading chip
            const newSources = [...sources];
            newSources[existingIndex] = source;
            onSourcesChange(newSources);
        } else if (source.status === 'loading') {
            // Add new loading chip
            onSourcesChange([...sources, source]);
        }
    }, [sources, onSourcesChange]);

    const handleSourceRemoved = useCallback((index: number) => {
        const newSources = sources.filter((_, i) => i !== index);
        onSourcesChange(newSources);
    }, [sources, onSourcesChange]);

    // Determine panel title based on mode
    const getPanelTitle = () => {
        switch (modeOverride) {
            case TagBarMode.RewriteWithTags:
                return 'Rewrite with Feedback';
            case TagBarMode.EditWithTags:
                return 'Edit with Feedback';
            default:
                return 'Apply Feedback';
        }
    };

    // Streaming state - show disabled placeholder
    if (isStreaming) {
        return (
            <div className={`bg-[var(--surface-elevated)] border border-[var(--border-strong)] rounded-book p-4 shadow-page opacity-50 ${className}`}>
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <svg className="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Generating... Feedback options available after completion.</span>
                </div>
            </div>
        );
    }

    // Don't show if tags are not modified and no mode override
    if (!tagsModified && modeOverride === TagBarMode.Normal && sources.length === 0) {
        return null;
    }

    return (
        <div className={`bg-[var(--surface-elevated)] border border-[var(--border-strong)] rounded-book shadow-page ${className}`}>
            {/* Panel Header */}
            <div className="px-4 py-3 border-b border-[var(--border-default)]">
                <h3 className="text-sm font-display font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    <svg className="w-4 h-4 text-[var(--accent-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    {getPanelTitle()}
                </h3>
            </div>

            <div className="p-4 space-y-4">
                {/* Tags Section */}
                <div>
                    <h4 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                        Tags
                    </h4>
                    <TagBar
                        tagState={tagState}
                        dispatch={dispatchTagAction}
                        explanationId={explanationId}
                        isStreaming={isStreaming}
                    />
                </div>

                {/* Sources Section */}
                <div>
                    <h4 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                        Sources
                    </h4>
                    <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page p-3">
                        <p className="text-xs text-[var(--text-muted)] mb-3">
                            Add URLs to ground the explanation with citations
                        </p>
                        <SourceList
                            sources={sources}
                            onSourceAdded={handleSourceAdded}
                            onSourceRemoved={handleSourceRemoved}
                            disabled={isStreaming}
                        />
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-default)]">
                    <button
                        onClick={handleReset}
                        className="px-4 py-2 text-sm font-ui font-medium text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page transition-all duration-200 hover:border-[var(--accent-copper)] hover:text-[var(--accent-copper)]"
                    >
                        Reset
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={!hasAnyChanges}
                        className={`px-4 py-2 text-sm font-ui font-medium rounded-page transition-all duration-200 ${
                            hasAnyChanges
                                ? 'text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] hover:shadow-warm-md hover:-translate-y-0.5'
                                : 'text-[var(--text-muted)] bg-[var(--surface-secondary)] cursor-not-allowed opacity-50'
                        }`}
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}
