/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import { useState, useCallback } from 'react';
import { runAISuggestionsPipelineAction } from '../editorFiles/actions/actions';
import { Spinner } from '@/components/ui/spinner';

interface AISuggestionsPanelProps {
  isVisible: boolean;
  onClose?: () => void;
  currentContent: string;
  editorRef?: React.RefObject<unknown>; // LexicalEditorRef
  onContentChange?: (content: string) => void;
  onEnterEditMode?: () => void;
  sessionData?: {
    explanation_id: number;
    explanation_title: string;
  };
}

interface ProgressState {
  step: string;
  progress: number;
}

/**
 * AI Suggestions Panel - Marginalia Sidebar
 * Midnight Scholar theme - styled as scholarly marginalia notes
 */
export default function AISuggestionsPanel({
  isVisible,
  onClose,
  currentContent,
  editorRef: _editorRef,
  onContentChange,
  onEnterEditMode,
  sessionData
}: AISuggestionsPanelProps) {
  const [userPrompt, setUserPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progressState, setProgressState] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ success: boolean; content?: string; session_id?: string } | null>(null);

  const handleProgressUpdate = useCallback((step: string, progress: number) => {
    setProgressState({ step, progress });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!userPrompt.trim() || !currentContent.trim()) {
      setError('Please enter a prompt and ensure there is content to edit');
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgressState(null);
    setLastResult(null);

    try {
      const sessionRequestData = sessionData ? {
        explanation_id: sessionData.explanation_id,
        explanation_title: sessionData.explanation_title,
        user_prompt: userPrompt.trim()
      } : undefined;

      console.log('🎭 AISuggestionsPanel: Calling runAISuggestionsPipelineAction', {
        hasSessionData: !!sessionRequestData,
        sessionRequestData,
        userPrompt: userPrompt.trim(),
        contentLength: currentContent.length
      });

      handleProgressUpdate('Processing AI suggestions...', 50);

      const result = await runAISuggestionsPipelineAction(
        currentContent,
        userPrompt.trim(),
        sessionRequestData
      );

      console.log('🎭 AISuggestionsPanel: runAISuggestionsPipelineAction result:', result);

      setLastResult(result);

      console.log('🎭 AISuggestionsPanel: Processing result...', {
        success: result.success,
        hasContent: !!result.content,
        contentLength: result.content?.length || 0,
        contentPreview: result.content?.substring(0, 200),
        hasCriticMarkup: result.content?.includes('{++') || result.content?.includes('{--') || result.content?.includes('{~~'),
        sessionId: result.session_id,
        error: result.error
      });

      // DIAGNOSTIC: Test if CriticMarkup regex would match
      if (result.content) {
        const criticMarkupRegex = /\{([+-~]{2})([\s\S]+?)\1\}/g;
        const matches = Array.from(result.content.matchAll(criticMarkupRegex));
        console.log('🔍 DIAGNOSTIC: CriticMarkup regex test:', {
          matchCount: matches.length,
          matches: matches.slice(0, 3).map(m => ({
            fullMatch: m[0].substring(0, 50),
            marks: m[1],
            innerPreview: m[2]?.substring(0, 30)
          }))
        });
      }

      if (result.success && result.content) {
        console.log('🎭 AISuggestionsPanel: Entering edit mode...');
        onEnterEditMode?.();
        console.log('🎭 AISuggestionsPanel: Edit mode entered, calling onContentChange...');
        onContentChange?.(result.content);
        console.log('🎭 AISuggestionsPanel: onContentChange called successfully');
      } else {
        console.error('🎭 AISuggestionsPanel: Result not successful or no content', {
          success: result.success,
          hasContent: !!result.content,
          error: result.error
        });
        setError(result.error || 'Failed to generate suggestions');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unexpected error occurred';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
      setProgressState(null);
    }
  }, [userPrompt, currentContent, onContentChange, handleProgressUpdate, onEnterEditMode, sessionData]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="bg-[var(--surface-secondary)] border-l border-[var(--border-default)] w-80 flex flex-col h-full shadow-warm-lg">
      {/* Panel Header - Marginalia style */}
      <div className="p-4 border-b border-[var(--border-default)] flex items-center justify-between bg-[var(--surface-elevated)]">
        <div className="flex items-center gap-2">
          {/* Quill icon */}
          <svg
            className="w-5 h-5 text-[var(--accent-gold)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M12 19l7-7 3 3-7 7-3-3z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 2l7.586 7.586" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="11" cy="11" r="2" fill="currentColor" />
          </svg>
          <h3 className="text-lg font-display font-semibold text-[var(--text-primary)]">
            Edit article
          </h3>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--accent-copper)] transition-colors rounded-page hover:bg-[var(--surface-primary)]"
            aria-label="Close suggestions panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Panel Content */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* Input Area - Note card style */}
        <div className="scholar-card p-4">
          <label htmlFor="ai-prompt" className="block text-sm font-sans font-medium text-[var(--text-secondary)] mb-2">
            What would you like to improve?
          </label>
          <textarea
            id="ai-prompt"
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="Describe your desired changes..."
            className="w-full h-24 px-3 py-2 border border-[var(--border-default)] rounded-page shadow-page focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:border-[var(--accent-gold)] bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] placeholder:italic font-serif text-sm resize-none transition-all duration-200"
            disabled={isLoading}
          />
        </div>

        {/* Submit Button - Scholar style */}
        <button
          onClick={handleSubmit}
          disabled={isLoading || !userPrompt.trim() || !currentContent.trim()}
          className="w-full py-2.5 px-4 font-sans font-medium text-sm rounded-page transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)] focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] hover:shadow-warm-md hover:-translate-y-0.5 active:translate-y-0"
        >
          <span className="flex items-center justify-center gap-2">
            {isLoading ? (
              <>
                <Spinner variant="quill" size={18} />
                <span>Composing...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <span>Get Suggestions</span>
              </>
            )}
          </span>
        </button>

        {/* Loading State with Progress - Parchment style */}
        {isLoading && progressState && (
          <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
            <div className="flex items-center mb-3">
              <Spinner variant="quill" size={20} className="mr-2" />
              <span className="text-sm font-sans font-medium text-[var(--accent-gold)]">
                The Scholar is Writing...
              </span>
            </div>
            <p className="text-sm font-serif italic text-[var(--text-muted)] mb-3">
              {progressState.step}
            </p>
            <div className="w-full bg-[var(--surface-primary)] rounded-full h-2 border border-[var(--border-default)]">
              <div
                className="bg-gradient-to-r from-[var(--accent-gold)] to-[var(--accent-copper)] h-full rounded-full transition-all duration-300"
                style={{ width: `${progressState.progress}%` }}
              />
            </div>
            <p className="text-xs font-sans text-[var(--text-muted)] mt-2 text-right">
              {progressState.progress}% complete
            </p>
          </div>
        )}

        {/* Error Display - Scholarly warning */}
        {error && (
          <div className="bg-[var(--surface-elevated)] border-l-4 border-l-[var(--destructive)] border border-[var(--border-default)] rounded-r-page p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-[var(--destructive)] mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-sans font-medium text-[var(--destructive)]">
                Error
              </span>
            </div>
            <p className="text-sm font-serif text-[var(--text-secondary)] mt-2">
              {error}
            </p>
          </div>
        )}

        {/* Success Message - Scholarly confirmation */}
        {lastResult?.success && !isLoading && (
          <div className="bg-[var(--surface-elevated)] border-l-4 border-l-[var(--accent-gold)] border border-[var(--border-default)] rounded-r-page p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-[var(--accent-gold)] mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-sans font-medium text-[var(--accent-gold)]">
                Revisions Applied
              </span>
            </div>
            <p className="text-sm font-serif text-[var(--text-secondary)] mt-2">
              Your manuscript has been updated with scholarly suggestions.
            </p>
            {process.env.NODE_ENV === 'development' && lastResult.session_id && sessionData && (
              <div className="mt-3">
                <a
                  href={`/editorTest?explanation_id=${sessionData.explanation_id}&session_id=${lastResult.session_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-3 py-1.5 text-xs font-sans font-medium text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] rounded-page transition-all duration-200 hover:shadow-warm"
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-2M7 13l3 3 7-7" />
                  </svg>
                  Debug in EditorTest
                </a>
              </div>
            )}
          </div>
        )}

        {/* Instructions - Scholarly tips */}
        <div className="border-t border-[var(--border-default)] pt-4 mt-4">
          <h4 className="text-xs font-sans font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
            Scholarly Notes
          </h4>
          <ul className="text-xs font-serif text-[var(--text-muted)] space-y-1.5">
            <li className="flex items-start gap-1.5">
              <span className="text-[var(--accent-gold)]">•</span>
              <span>Describe the improvements you&apos;d like to see</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-[var(--accent-gold)]">•</span>
              <span>The AI will analyze and enhance your content</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-[var(--accent-gold)]">•</span>
              <span>Changes will be applied directly to your manuscript</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
