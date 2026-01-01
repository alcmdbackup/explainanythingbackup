'use client';

/**
 * AdvancedAIEditorModal - Full-featured AI editing modal with tags support
 * Provides expanded view of AI editing options including prompt, sources, output mode, and tags
 */

import { useState, useMemo, useCallback } from 'react';
import { SourceList } from '@/components/sources';
import OutputModeToggle, { type OutputMode } from './OutputModeToggle';
import TagSelector from './TagSelector';
import { Spinner } from '@/components/ui/spinner';
import type { SourceChipType } from '@/lib/schemas/schemas';
import type { TagModeState, TagModeAction } from '@/reducers/tagModeReducer';
import { getCurrentTags } from '@/reducers/tagModeReducer';

export interface AIEditData {
  prompt: string;
  sources: SourceChipType[];
  outputMode: OutputMode;
  tagDescriptions: string[];
}

interface AdvancedAIEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt: string;
  initialSources: SourceChipType[];
  initialOutputMode: OutputMode;
  tagState: TagModeState;
  dispatchTagAction: React.Dispatch<TagModeAction>;
  explanationId?: number;
  onApply: (data: AIEditData) => Promise<void>;
  isLoading?: boolean;
}

/**
 * Modal for advanced AI editing with all options expanded
 */
export default function AdvancedAIEditorModal({
  isOpen,
  onClose,
  initialPrompt,
  initialSources,
  initialOutputMode,
  tagState,
  dispatchTagAction,
  explanationId,
  onApply,
  isLoading = false
}: AdvancedAIEditorModalProps) {
  // Local state that can diverge from initial values
  const [prompt, setPrompt] = useState(initialPrompt);
  const [sources, setSources] = useState<SourceChipType[]>(initialSources);
  const [outputMode, setOutputMode] = useState<OutputMode>(initialOutputMode);
  const [showCancelWarning, setShowCancelWarning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract tag descriptions from current tag state
  const extractTagDescriptions = useCallback((): string[] => {
    const tags = getCurrentTags(tagState);
    const descriptions: string[] = [];
    tags.forEach(tag => {
      if (!tag.tag_active_current) return;
      if ('tag_name' in tag) {
        descriptions.push(tag.tag_description);
      } else {
        const currentTag = tag.tags.find(t => t.id === tag.currentActiveTagId);
        if (currentTag) {
          descriptions.push(currentTag.tag_description);
        }
      }
    });
    return descriptions;
  }, [tagState]);

  // Detect if any changes have been made
  const isDirty = useMemo(() => {
    const promptChanged = prompt !== initialPrompt;
    const sourcesChanged = JSON.stringify(sources) !== JSON.stringify(initialSources);
    const outputModeChanged = outputMode !== initialOutputMode;
    // Tags are tracked separately through tagState
    return promptChanged || sourcesChanged || outputModeChanged;
  }, [prompt, sources, outputMode, initialPrompt, initialSources, initialOutputMode]);

  const handleCancel = () => {
    if (isDirty) {
      setShowCancelWarning(true);
    } else {
      onClose();
    }
  };

  const handleConfirmCancel = () => {
    setShowCancelWarning(false);
    onClose();
  };

  const handleApply = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setError(null);
    try {
      await onApply({
        prompt: prompt.trim(),
        sources,
        outputMode,
        tagDescriptions: extractTagDescriptions()
      });
    } catch (err) {
      // Log error but still close - parent should handle display
      console.error('Modal apply error:', err);
    } finally {
      // ALWAYS close after apply attempt
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="advanced-ai-modal"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleCancel}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-[var(--surface-primary)] rounded-xl shadow-2xl border border-[var(--border-default)] max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
          <h2 className="text-lg font-serif font-semibold text-[var(--text-primary)]">
            Advanced AI Editor
          </h2>
          <button
            type="button"
            onClick={handleCancel}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            data-testid="modal-cancel-button"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Prompt */}
          <div>
            <label className="block text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your desired changes..."
              className="w-full h-24 px-3 py-2 border border-[var(--border-default)] rounded-md
                focus:ring-2 focus:ring-[var(--accent-gold)]/20 focus:border-[var(--accent-gold)]
                bg-[var(--surface-secondary)]
                text-[var(--text-primary)]
                placeholder:text-[var(--text-muted)]
                font-serif text-sm resize-none transition-all duration-200"
              disabled={isLoading}
              data-testid="modal-prompt-textarea"
            />
          </div>

          {/* Sources */}
          <div>
            <label className="block text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Reference Sources
            </label>
            <SourceList
              sources={sources}
              onSourceAdded={(source) => {
                const existingIndex = sources.findIndex(
                  s => s.url === source.url && s.status === 'loading'
                );
                if (existingIndex >= 0 && source.status !== 'loading') {
                  const newSources = [...sources];
                  newSources[existingIndex] = source;
                  setSources(newSources);
                } else if (!sources.some(s => s.url === source.url)) {
                  setSources([...sources, source]);
                }
              }}
              onSourceRemoved={(index) => {
                setSources(sources.filter((_, i) => i !== index));
              }}
              maxSources={5}
              disabled={isLoading}
            />
          </div>

          {/* Output Mode */}
          <OutputModeToggle
            value={outputMode}
            onChange={setOutputMode}
            disabled={isLoading}
          />

          {/* Tags */}
          {explanationId && (
            <TagSelector
              tagState={tagState}
              dispatch={dispatchTagAction}
              disabled={isLoading}
            />
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-md text-sm text-[var(--status-error)]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-default)] bg-[var(--surface-secondary)]">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-ui font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isLoading || !prompt.trim()}
            className="px-4 py-2 text-sm font-ui font-medium rounded-md transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)] focus:ring-offset-2
              disabled:opacity-50 disabled:cursor-not-allowed
              text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)]
              hover:shadow-md"
            data-testid="modal-apply-button"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Spinner variant="quill" size={16} />
                <span>Applying...</span>
              </span>
            ) : (
              <span>{outputMode === 'rewrite' ? 'Generate New Version' : 'Apply Suggestions'}</span>
            )}
          </button>
        </div>

        {/* Cancel Warning Dialog */}
        {showCancelWarning && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
            <div className="bg-[var(--surface-elevated)] rounded-lg p-6 mx-4 max-w-sm border border-[var(--border-default)] shadow-xl">
              <h3 className="text-base font-serif font-semibold text-[var(--text-primary)] mb-2">
                Discard changes?
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                You have unsaved changes. Are you sure you want to close?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCancelWarning(false)}
                  className="px-3 py-1.5 text-sm font-ui text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancel}
                  className="px-3 py-1.5 text-sm font-ui font-medium text-[var(--status-error)] hover:bg-[var(--status-error)]/10 rounded"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
