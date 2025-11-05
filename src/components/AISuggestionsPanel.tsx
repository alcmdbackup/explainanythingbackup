'use client';

import { useState, useCallback } from 'react';
import { runAISuggestionsPipelineAction } from '../editorFiles/actions/actions';

interface AISuggestionsPanelProps {
  isVisible: boolean;
  onClose?: () => void;
  currentContent: string;
  editorRef: React.RefObject<unknown>; // LexicalEditorRef
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

export default function AISuggestionsPanel({
  isVisible,
  onClose,
  currentContent,
  editorRef,
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
      // Prepare session data if we have it from the results page
      // Don't include session_id - let getAndApplyAISuggestions generate it
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

      // Note: Progress updates not supported with server actions, so we'll simulate progress
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
        // Enter edit mode before applying the AI suggestions
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
  }, [userPrompt, currentContent, editorRef, onContentChange, handleProgressUpdate, onEnterEditMode, sessionData]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 w-80 flex flex-col h-full">
      {/* Panel Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          AI Suggestions
        </h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close suggestions panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Panel Content */}
      <div className="flex-1 p-4 space-y-4">
        {/* Input Area */}
        <div>
          <label htmlFor="ai-prompt" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            What would you like to improve?
          </label>
          <textarea
            id="ai-prompt"
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="Describe what you'd like to improve about this content..."
            className="w-full h-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
            disabled={isLoading}
          />
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={isLoading || !userPrompt.trim() || !currentContent.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-md transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {isLoading ? 'Generating...' : 'Get AI Suggestions'}
        </button>

        {/* Loading State with Progress */}
        {isLoading && progressState && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4">
            <div className="flex items-center mb-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
              <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Processing AI Suggestions
              </span>
            </div>
            <p className="text-sm text-blue-600 dark:text-blue-400 mb-2">
              {progressState.step}
            </p>
            <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progressState.progress}%` }}
              />
            </div>
            <p className="text-xs text-blue-500 dark:text-blue-400 mt-1">
              {progressState.progress}% complete
            </p>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium text-red-800 dark:text-red-200">
                Error
              </span>
            </div>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {error}
            </p>
          </div>
        )}

        {/* Success Message */}
        {lastResult?.success && !isLoading && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-4">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-green-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium text-green-800 dark:text-green-200">
                Suggestions Applied
              </span>
            </div>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
              Your content has been updated with AI suggestions.
            </p>
            {lastResult.session_id && sessionData && (
              <div className="mt-3">
                <a
                  href={`/editorTest?explanation_id=${sessionData.explanation_id}&session_id=${lastResult.session_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md transition-colors"
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

        {/* Instructions */}
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <p>• Describe the improvements you&apos;d like to see</p>
          <p>• AI will analyze and enhance your content</p>
          <p>• Changes will be applied directly to the editor</p>
        </div>
      </div>
    </div>
  );
}