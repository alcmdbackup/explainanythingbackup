/**
 * SourceEditor — Edit mode wrapper for the bibliography section.
 * Toggles between read-only Bibliography and editable SourceList with apply/cancel controls.
 */
'use client';

import { useState, useCallback, useMemo } from 'react';
import { PencilIcon, ArrowPathIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { type SourceChipType } from '@/lib/schemas/schemas';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Bibliography from './Bibliography';
import SourceList from './SourceList';
import { updateSourcesForExplanationAction } from '@/actions/actions';

interface BibliographySource {
  index: number;
  title: string;
  domain: string;
  url: string;
  favicon_url?: string | null;
}

interface SourceEditorProps {
  explanationId: number | null;
  sources: SourceChipType[];
  bibliographySources: BibliographySource[];
  onSourcesChanged: (sources: SourceChipType[]) => void;
  className?: string;
}

export default function SourceEditor({
  explanationId,
  sources,
  bibliographySources,
  onSourcesChanged,
  className = '',
}: SourceEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedSources, setEditedSources] = useState<SourceChipType[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track original source URLs to detect changes for "Regenerate" button
  const originalUrls = useMemo(
    () => sources.filter(s => s.status === 'success').map(s => s.url).sort().join(','),
    [sources]
  );

  const editedUrls = useMemo(
    () => editedSources.filter(s => s.status === 'success').map(s => s.url).sort().join(','),
    [editedSources]
  );

  const hasChanges = isEditing && originalUrls !== editedUrls;

  const handleEnterEdit = useCallback(() => {
    setEditedSources([...sources]);
    setIsEditing(true);
    setError(null);
  }, [sources]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditedSources([]);
    setError(null);
  }, []);

  const handleSourceAdded = useCallback((source: SourceChipType) => {
    setEditedSources(prev => {
      // If updating a loading chip, replace it
      const existingIdx = prev.findIndex(s => s.url === source.url && s.status === 'loading');
      if (existingIdx >= 0 && source.status !== 'loading') {
        const updated = [...prev];
        updated[existingIdx] = source;
        return updated;
      }
      // Otherwise add new source
      if (prev.some(s => s.url === source.url)) return prev;
      return [...prev, source];
    });
  }, []);

  const handleSourceRemoved = useCallback((index: number) => {
    setEditedSources(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleApply = useCallback(async () => {
    if (!explanationId) return;

    // Validate source count before applying
    const successCount = editedSources.filter(s => s.status === 'success').length;
    if (successCount > 5) {
      setError(`Too many sources (${successCount}). Maximum 5 sources allowed.`);
      return;
    }

    setIsApplying(true);
    setError(null);

    try {
      // Extract source_cache_ids from successful sources that have database IDs
      const successSources = editedSources.filter(s => s.status === 'success' && s.source_cache_id);
      const sourceIds = successSources.map(s => s.source_cache_id!);

      await updateSourcesForExplanationAction({
        explanationId,
        sourceIds,
      });

      // Update parent state with the persisted sources
      onSourcesChanged(editedSources.filter(s => s.status !== 'loading'));
      setIsEditing(false);
      setEditedSources([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update sources');
    } finally {
      setIsApplying(false);
    }
  }, [explanationId, editedSources, onSourcesChanged]);

  // No sources and not editing — nothing to show
  if (!isEditing && sources.length === 0) {
    return null;
  }

  return (
    <div className={cn('mt-8 pt-6 border-t border-[var(--border-default)]', className)}>
      {isEditing ? (
        // ─── EDIT MODE ─────────────────────────────────────────
        <div
          data-testid="source-editor-panel"
          className="bg-[var(--surface-elevated)] border border-[var(--border-strong)] rounded-book p-4 shadow-page"
        >
          {/* Header with title and action buttons */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-display font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <svg className="w-5 h-5 text-[var(--accent-gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Edit Sources
            </h2>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={isApplying}
                data-testid="source-cancel-btn"
              >
                <XMarkIcon className="w-4 h-4 mr-1" />
                Cancel
              </Button>
              <Button
                variant="scholar"
                size="sm"
                onClick={handleApply}
                disabled={isApplying || !hasChanges}
                data-testid="source-apply-btn"
              >
                {isApplying ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                ) : (
                  <CheckIcon className="w-4 h-4 mr-1" />
                )}
                Apply
              </Button>
            </div>
          </div>

          {/* Source list with add/remove */}
          <SourceList
            sources={editedSources}
            onSourceAdded={handleSourceAdded}
            onSourceRemoved={handleSourceRemoved}
            maxSources={5}
            disabled={isApplying}
            showInput={true}
            explanationId={explanationId ?? undefined}
          />

          {/* Error message */}
          {error && (
            <p className="mt-2 text-sm text-[var(--status-error)]">{error}</p>
          )}

          {/* Regenerate button — only shown when sources actually changed */}
          {hasChanges && (
            <div className="mt-4 pt-3 border-t border-[var(--border-default)]">
              <Button
                variant="secondary"
                size="sm"
                data-testid="source-regenerate-btn"
                className="text-[var(--accent-copper)]"
                disabled
                title="Coming soon — regenerate explanation with updated sources"
              >
                <ArrowPathIcon className="w-4 h-4 mr-1.5" />
                Regenerate with updated sources
              </Button>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Apply changes first, then regenerate to update inline citations.
              </p>
            </div>
          )}
        </div>
      ) : (
        // ─── VIEW MODE ─────────────────────────────────────────
        <div className="relative group">
          <Bibliography sources={bibliographySources} />

          {/* Edit toggle button — appears on hover */}
          {explanationId && (
            <button
              onClick={handleEnterEdit}
              data-testid="source-edit-toggle"
              className={cn(
                'absolute top-0 right-0 p-2 rounded-book',
                'text-[var(--text-muted)] hover:text-[var(--accent-gold)]',
                'hover:bg-[var(--surface-elevated)]',
                'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
                'focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30'
              )}
              aria-label="Edit sources"
              title="Edit sources"
            >
              <PencilIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
