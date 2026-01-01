'use client';

/**
 * AIEditorPanel - Collapsible sidebar for AI-powered editing with sources support
 * Enables users to provide URL sources for context and get AI-suggested edits
 */

import { useState, useCallback, useEffect } from 'react';
import { runAISuggestionsPipelineAction, getSessionValidationResultsAction } from '../editorFiles/actions/actions';
import { Spinner } from '@/components/ui/spinner';
import { SourceList } from '@/components/sources';
import type { SourceChipType } from '@/lib/schemas/schemas';
import type { PipelineValidationResults } from '../editorFiles/validation/pipelineValidation';

// ============================================================================
// Types
// ============================================================================

interface AIEditorPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  currentContent: string;
  editorRef?: React.RefObject<unknown>; // LexicalEditorRef
  onContentChange?: (content: string) => void;
  onEnterEditMode?: () => void;
  sessionData?: {
    explanation_id: number;
    explanation_title: string;
  };
  /** Optional session_id to load validation results for a previously run AI suggestion session */
  loadedSessionId?: string;
  /** Source URLs to provide additional context to AI */
  sources?: SourceChipType[];
  /** Callback when sources change */
  onSourcesChange?: (sources: SourceChipType[]) => void;
  /** User ID for source fetching (required if sources are provided) */
  userId?: string;
}

interface ProgressState {
  step: string;
  progress: number;
}

interface SuggestionHistoryItem {
  id: string;
  prompt: string;
  timestamp: Date;
  success: boolean;
  sessionId?: string;
}

interface QuickAction {
  id: string;
  label: string;
  prompt: string;
  icon: React.ReactNode;
}

// ============================================================================
// Quick Action Icons (SVG)
// ============================================================================

const SimplifyIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
    <path d="M12 3v12m0 0l-3-3m3 3l3-3" />
  </svg>
);

const ExpandIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);

const GrammarIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h6M4 12h8M4 17h4" />
    <path d="M15 17l2 2 4-4" />
  </svg>
);

const FormalIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l3 6-3 2-3-2 3-6z" />
    <path d="M9 8l-2 14h10l-2-14" />
  </svg>
);

const HistoryIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const ChevronLeftIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const ChevronRightIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const QuillIcon = () => (
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
);

// ============================================================================
// Quick Actions Configuration
// ============================================================================

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'simplify',
    label: 'Simplify',
    prompt: 'Simplify this text to make it easier to understand while preserving the key information. Use shorter sentences and simpler vocabulary.',
    icon: <SimplifyIcon />,
  },
  {
    id: 'expand',
    label: 'Expand',
    prompt: 'Expand this content with more details, examples, and explanations. Add context that helps readers understand the topic better.',
    icon: <ExpandIcon />,
  },
  {
    id: 'fix-grammar',
    label: 'Fix Grammar',
    prompt: 'Fix any grammar, spelling, punctuation, or syntax errors in this text. Ensure proper sentence structure and clarity.',
    icon: <GrammarIcon />,
  },
  {
    id: 'formal',
    label: 'Make Formal',
    prompt: 'Rewrite this text in a more formal, professional tone. Use appropriate academic or business language.',
    icon: <FormalIcon />,
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// Validation Badge Component
// ============================================================================

function ValidationBadge({ step, label }: { step: { valid: boolean; severity?: string; description?: string; issues?: string[] }; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
      step.valid
        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
        : step.severity === 'error'
          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
          : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
    }`} title={step.description}>
      <span>{step.valid ? '✓' : step.severity === 'error' ? '✗' : '⚠'}</span>
      <span>{label}</span>
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * AIEditorPanel - Collapsible sidebar for AI-powered editing with sources support
 * Visible by default with option to collapse
 */
export default function AIEditorPanel({
  isOpen,
  onOpenChange,
  currentContent,
  onContentChange,
  onEnterEditMode,
  sessionData,
  loadedSessionId,
  sources = [],
  onSourcesChange,
  userId
}: AIEditorPanelProps) {
  const [userPrompt, setUserPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progressState, setProgressState] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ success: boolean; content?: string; session_id?: string; validationResults?: PipelineValidationResults } | null>(null);

  // History state
  const [suggestionHistory, setSuggestionHistory] = useState<SuggestionHistoryItem[]>([]);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  // Loaded validation results for previously run sessions
  const [loadedValidationResults, setLoadedValidationResults] = useState<PipelineValidationResults | null>(null);

  // Load validation results for a previously run session
  useEffect(() => {
    if (loadedSessionId) {
      getSessionValidationResultsAction(loadedSessionId).then((result) => {
        if (result.success && result.data) {
          setLoadedValidationResults(result.data);
        }
      }).catch((err) => {
        console.error('Failed to load validation results for session:', loadedSessionId, err);
        // Show error state so user knows validation results couldn't be loaded
        setError('Could not load previous validation results');
      });
    } else {
      setLoadedValidationResults(null);
    }
  }, [loadedSessionId]);

  const handleProgressUpdate = useCallback((step: string, progress: number) => {
    setProgressState({ step, progress });
  }, []);

  const handleSubmit = useCallback(async (promptOverride?: string) => {
    const promptToUse = promptOverride || userPrompt;

    if (!promptToUse.trim() || !currentContent.trim()) {
      setError('Please enter a prompt and ensure there is content to edit');
      return;
    }

    setIsLoading(true);
    setError(null);
    setProgressState(null);
    setLastResult(null);

    try {
      // Prepare session data with sources (sources will be formatted server-side)
      handleProgressUpdate('Processing AI suggestions...', 20);

      const sessionRequestData = sessionData ? {
        explanation_id: sessionData.explanation_id,
        explanation_title: sessionData.explanation_title,
        user_prompt: promptToUse.trim(),
        // Pass raw sources to server action - formatting happens server-side
        rawSources: sources.length > 0 ? sources : undefined,
        userId: userId
      } : undefined;

      console.log('🎭 AIEditorPanel: Calling runAISuggestionsPipelineAction', {
        hasSessionData: !!sessionRequestData,
        sessionRequestData,
        userPrompt: promptToUse.trim(),
        contentLength: currentContent.length,
        sourceCount: sources?.length || 0
      });

      handleProgressUpdate('Processing AI suggestions...', 50);

      // Use API route in E2E tests (mockable JSON), server action in production (RSC format)
      let result;
      if (process.env.NEXT_PUBLIC_USE_AI_API_ROUTE === 'true') {
        const res = await fetch('/api/runAISuggestionsPipeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentContent,
            userPrompt: promptToUse.trim(),
            sessionData: sessionRequestData
          })
        });
        result = await res.json();
      } else {
        result = await runAISuggestionsPipelineAction(
          currentContent,
          promptToUse.trim(),
          sessionRequestData
        );
      }

      console.log('🎭 AIEditorPanel: runAISuggestionsPipelineAction result:', result);

      // Handle undefined result (server action may fail silently)
      if (!result) {
        const errorResult = { success: false, error: 'Server action returned no result' };
        setLastResult(errorResult);
        setError('Failed to get AI suggestions. Please try again.');
        setSuggestionHistory(prev => [{
          id: generateId(),
          prompt: promptToUse.trim(),
          timestamp: new Date(),
          success: false,
          sessionId: undefined
        }, ...prev].slice(0, 10));
        return;
      }

      setLastResult(result);

      // Add to history
      setSuggestionHistory(prev => [{
        id: generateId(),
        prompt: promptToUse.trim(),
        timestamp: new Date(),
        success: result.success,
        sessionId: result.session_id
      }, ...prev].slice(0, 10)); // Keep last 10

      console.log('🎭 AIEditorPanel: Processing result...', {
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
        const matches = Array.from(result.content.matchAll(criticMarkupRegex)) as RegExpMatchArray[];
        console.log('🔍 DIAGNOSTIC: CriticMarkup regex test:', {
          matchCount: matches.length,
          matches: matches.slice(0, 3).map((m: RegExpMatchArray) => ({
            fullMatch: m[0].substring(0, 50),
            marks: m[1],
            innerPreview: m[2]?.substring(0, 30)
          }))
        });
      }

      if (result.success && result.content) {
        console.log('🎭 AIEditorPanel: Entering edit mode...');
        onEnterEditMode?.();
        console.log('🎭 AIEditorPanel: Edit mode entered, calling onContentChange...');
        onContentChange?.(result.content);
        console.log('🎭 AIEditorPanel: onContentChange called successfully');
        // Clear prompt on success
        setUserPrompt('');
      } else {
        console.error('🎭 AIEditorPanel: Result not successful or no content', {
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
  }, [userPrompt, currentContent, onContentChange, handleProgressUpdate, onEnterEditMode, sessionData, sources, userId]);

  const handleQuickAction = useCallback((action: QuickAction) => {
    setUserPrompt(action.prompt);
  }, []);

  const handleHistoryItemClick = useCallback((item: SuggestionHistoryItem) => {
    setUserPrompt(item.prompt);
  }, []);

  return (
    <div
      className={`
        flex flex-col h-full
        bg-[var(--surface-secondary)]
        border-l border-l-[var(--border-default)]
        transition-all duration-300 ease-in-out
        ${isOpen ? 'w-[340px]' : 'w-0'}
        overflow-hidden
      `}
      role="complementary"
      aria-label="AI Suggestions Panel"
      data-testid="ai-suggestions-panel"
    >
      {/* Collapse/Expand Toggle - Scholarly subtle design */}
      <button
        onClick={() => onOpenChange(!isOpen)}
        className={`
          absolute top-1/2 -translate-y-1/2 z-10
          ${isOpen ? '-left-3' : '-left-6'}
          w-6 h-10
          flex items-center justify-center
          bg-[var(--surface-elevated)]
          text-[var(--text-muted)]
          border border-[var(--border-default)]
          rounded-l-md
          hover:bg-[var(--surface-secondary)]
          hover:text-[var(--text-secondary)]
          hover:border-[var(--border-strong)]
          transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/20 focus:ring-offset-1
        `}
        aria-label={isOpen ? 'Collapse AI panel' : 'Expand AI panel'}
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronRightIcon className="w-3.5 h-3.5" /> : <ChevronLeftIcon className="w-3.5 h-3.5" />}
      </button>

      {/* Panel Content */}
      <div className={`flex flex-col h-full ${isOpen ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}>
        {/* Header */}
        <div className="border-b border-[var(--border-default)] p-4">
          <div className="flex items-center gap-2">
            <QuillIcon />
            <h2 className="text-lg font-display font-semibold text-[var(--text-primary)]">Edit article</h2>
          </div>
          <p className="text-sm font-serif text-[var(--text-muted)] mt-1">
            Use AI to refine and improve your content
          </p>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Quick Actions */}
          <div className="space-y-2">
            <h4 className="text-xs font-ui font-medium text-[var(--text-muted)] uppercase tracking-wider">
              Quick Actions
            </h4>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  onClick={() => handleQuickAction(action)}
                  disabled={isLoading || !currentContent.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-ui
                    bg-[var(--surface-elevated)]
                    border border-[var(--border-default)]
                    rounded-md
                    text-[var(--text-secondary)]
                    hover:bg-[var(--surface-secondary)] hover:border-[var(--border-strong)]
                    hover:text-[var(--text-primary)]
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all duration-200"
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Input */}
          <div className="bg-[var(--surface-elevated)] rounded-lg p-3 border border-[var(--border-default)]">
            <label htmlFor="ai-prompt" className="block text-sm font-ui font-medium text-[var(--text-secondary)] mb-2">
              What would you like to improve?
            </label>
            <textarea
              id="ai-prompt"
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder="Describe your desired changes..."
              className="w-full h-20 px-3 py-2 border border-[var(--border-default)] rounded-md
                focus:ring-2 focus:ring-[var(--accent-gold)]/20 focus:border-[var(--accent-gold)]
                bg-[var(--surface-secondary)]
                text-[var(--text-primary)]
                placeholder:text-[var(--text-muted)]
                font-serif text-sm resize-none transition-all duration-200"
              disabled={isLoading}
            />
          </div>

          {/* Sources Section */}
          {onSourcesChange && (
            <div
              className="bg-[var(--surface-elevated)] rounded-lg p-3 border border-[var(--border-default)]"
              data-testid="sidebar-source-list"
            >
              <label className="block text-sm font-ui font-medium text-[var(--text-secondary)] mb-2">
                Reference Sources (optional)
              </label>
              <SourceList
                sources={sources}
                onSourceAdded={(source) => {
                  // Check if updating existing loading source
                  const existingIndex = sources.findIndex(
                    s => s.url === source.url && s.status === 'loading'
                  );
                  if (existingIndex >= 0 && source.status !== 'loading') {
                    // Replace loading source with completed one
                    const newSources = [...sources];
                    newSources[existingIndex] = source;
                    onSourcesChange(newSources);
                  } else if (!sources.some(s => s.url === source.url)) {
                    // Add new source
                    onSourcesChange([...sources, source]);
                  }
                }}
                onSourceRemoved={(index) => {
                  const newSources = sources.filter((_, i) => i !== index);
                  onSourcesChange(newSources);
                }}
                maxSources={5}
                disabled={isLoading}
              />
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={() => handleSubmit()}
            disabled={isLoading || !userPrompt.trim() || !currentContent.trim()}
            className="w-full py-2.5 px-4 font-ui font-medium text-sm rounded-md transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)] focus:ring-offset-2
              disabled:opacity-50 disabled:cursor-not-allowed
              text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)]
              hover:shadow-md hover:-translate-y-0.5
              active:translate-y-0"
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

          {/* Loading State with Progress */}
          {isLoading && progressState && (
            <div data-testid="suggestions-loading" className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-lg p-4">
              <div className="flex items-center mb-3">
                <Spinner variant="quill" size={20} className="mr-2" />
                <span className="text-sm font-ui font-medium text-[var(--accent-copper)]">
                  Processing...
                </span>
              </div>
              <p className="text-sm italic font-serif text-[var(--text-muted)] mb-3">
                {progressState.step}
              </p>
              <div className="w-full bg-[var(--border-default)] rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-[var(--accent-gold)] to-[var(--accent-copper)] h-full rounded-full transition-all duration-300"
                  style={{ width: `${progressState.progress}%` }}
                />
              </div>
              <p className="text-xs font-ui text-[var(--text-muted)] mt-2 text-right">
                {progressState.progress}% complete
              </p>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div data-testid="suggestions-error" className="bg-[var(--destructive)]/5 border-l-4 border-l-[var(--destructive)] border border-[var(--destructive)]/20 rounded-r-md p-4">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-[var(--destructive)] mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-ui font-medium text-[var(--destructive)]">
                  Error
                </span>
              </div>
              <p className="text-sm font-serif text-[var(--destructive)] mt-2">
                {error}
              </p>
            </div>
          )}

          {/* Loaded Session Validation Results */}
          {!lastResult && loadedValidationResults && (
            <div data-testid="loaded-validation-results" className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-lg p-4">
              <p className="text-xs font-ui font-medium text-[var(--text-muted)] mb-2">Previous Session Validation:</p>
              <div className="flex flex-wrap gap-1.5">
                {loadedValidationResults.step2 && (
                  <ValidationBadge step={loadedValidationResults.step2} label="B2" />
                )}
                {loadedValidationResults.step3 && (
                  <ValidationBadge step={loadedValidationResults.step3} label="B3" />
                )}
              </div>
              {/* Show issues if any */}
              {(loadedValidationResults.step2?.issues?.length || loadedValidationResults.step3?.issues?.length) ? (
                <details className="mt-2">
                  <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
                    View validation issues ({(loadedValidationResults.step2?.issues?.length || 0) + (loadedValidationResults.step3?.issues?.length || 0)})
                  </summary>
                  <ul className="mt-1 text-xs text-[var(--text-muted)] space-y-0.5 pl-3">
                    {loadedValidationResults.step2?.issues?.map((issue, i) => (
                      <li key={`s2-${i}`}>• B2: {issue}</li>
                    ))}
                    {loadedValidationResults.step3?.issues?.map((issue, i) => (
                      <li key={`s3-${i}`}>• B3: {issue}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          )}

          {/* Success Message */}
          {lastResult?.success && !isLoading && (
            <div data-testid="suggestions-success" className="bg-[var(--accent-gold)]/10 border-l-4 border-l-[var(--accent-gold)] border border-[var(--accent-gold)]/20 rounded-r-md p-4">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-[var(--accent-copper)] mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-ui font-medium text-[var(--accent-copper)]">
                  Revisions Applied
                </span>
              </div>
              <p className="text-sm font-serif text-[var(--text-secondary)] mt-2">
                Your content has been updated with AI suggestions.
              </p>

              {/* Validation Summary */}
              {lastResult.validationResults && (
                <div className="mt-3 pt-3 border-t border-[var(--border-default)]">
                  <p className="text-xs font-ui font-medium text-[var(--text-muted)] mb-2">Pipeline Validation:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {lastResult.validationResults.step2 && (
                      <ValidationBadge step={lastResult.validationResults.step2} label="B2" />
                    )}
                    {lastResult.validationResults.step3 && (
                      <ValidationBadge step={lastResult.validationResults.step3} label="B3" />
                    )}
                  </div>
                  {/* Show issues if any */}
                  {(lastResult.validationResults.step2?.issues?.length || lastResult.validationResults.step3?.issues?.length) ? (
                    <details className="mt-2">
                      <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
                        View validation issues ({(lastResult.validationResults.step2?.issues?.length || 0) + (lastResult.validationResults.step3?.issues?.length || 0)})
                      </summary>
                      <ul className="mt-1 text-xs text-[var(--text-muted)] space-y-0.5 pl-3">
                        {lastResult.validationResults.step2?.issues?.map((issue, i) => (
                          <li key={`s2-${i}`}>• B2: {issue}</li>
                        ))}
                        {lastResult.validationResults.step3?.issues?.map((issue, i) => (
                          <li key={`s3-${i}`}>• B3: {issue}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              )}

              {process.env.NODE_ENV === 'development' && lastResult.session_id && sessionData && (
                <div className="mt-3">
                  <a
                    href={`/editorTest?explanation_id=${sessionData.explanation_id}&session_id=${lastResult.session_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-3 py-1.5 text-xs font-ui font-medium text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] rounded-md transition-all duration-200 hover:shadow-md"
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
        </div>

        {/* History Section - Fixed at bottom */}
        {suggestionHistory.length > 0 && (
          <div className="border-t border-[var(--border-default)] p-4">
            <button
              onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
              className="w-full flex items-center justify-between text-sm font-ui text-[var(--text-muted)] hover:text-[var(--accent-copper)] transition-colors py-1"
            >
              <span className="flex items-center gap-2">
                <HistoryIcon />
                Recent Suggestions ({suggestionHistory.length})
              </span>
              <ChevronDownIcon className={`w-4 h-4 transition-transform duration-200 ${isHistoryExpanded ? 'rotate-180' : ''}`} />
            </button>

            {isHistoryExpanded && (
              <div className="mt-3 space-y-2 max-h-40 overflow-y-auto">
                {suggestionHistory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleHistoryItemClick(item)}
                    className="w-full text-left p-2.5 rounded-md bg-[var(--surface-elevated)] border border-[var(--border-default)] cursor-pointer hover:border-[var(--border-strong)] hover:shadow-sm transition-all duration-200"
                  >
                    <p className="text-sm font-serif text-[var(--text-secondary)] line-clamp-2">
                      {item.prompt}
                    </p>
                    <p className="text-xs font-ui text-[var(--text-muted)] mt-1.5 flex items-center gap-1">
                      <span>{formatTimeAgo(item.timestamp)}</span>
                      {item.success && (
                        <span className="ml-auto text-[var(--accent-copper)] flex items-center gap-0.5">
                          <CheckIcon />
                          <span>Applied</span>
                        </span>
                      )}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
