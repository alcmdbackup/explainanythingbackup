/**
 * Import panel for the home page Import tab.
 * Allows pasting AI content with auto-detection of source.
 */
'use client';

import { useState, useCallback } from 'react';
import { type ImportSource } from '@/lib/schemas/schemas';
import { processImport, detectImportSource } from '@/actions/importActions';
import { supabase_browser } from '@/lib/supabase';
import { Spinner } from '@/components/ui/spinner';

interface ImportData {
  title: string;
  content: string;
  source: ImportSource;
}

interface HomeImportPanelProps {
  onProcessed: (data: ImportData) => void;
  className?: string;
}

type PanelState = 'idle' | 'detecting' | 'processing' | 'error';

const SOURCE_LABELS: Record<ImportSource, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  other: 'Other AI',
  generated: 'Generated',
};

export default function HomeImportPanel({
  onProcessed,
  className = ''
}: HomeImportPanelProps) {
  const [content, setContent] = useState('');
  const [source, setSource] = useState<ImportSource>('other');
  const [state, setState] = useState<PanelState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [wasAutoDetected, setWasAutoDetected] = useState(false);

  const handleContentChange = useCallback(async (value: string) => {
    setContent(value);
    setError(null);

    // Auto-detect source when content is pasted (100+ characters)
    if (value.trim().length > 100) {
      setState('detecting');
      try {
        const result = await detectImportSource(value);
        if (!result.error) {
          setSource(result.source);
          setWasAutoDetected(true);
        }
      } catch {
        // Ignore detection errors
      }
      setState('idle');
    } else {
      setWasAutoDetected(false);
    }
  }, []);

  const handleSourceChange = useCallback((newSource: ImportSource) => {
    setSource(newSource);
    setWasAutoDetected(false); // User manually selected, so remove auto-detected hint
  }, []);

  const handleProcess = useCallback(async () => {
    if (!content.trim()) {
      setError('Please paste some content to import');
      return;
    }

    if (content.trim().length < 100) {
      setError('Content must be at least 100 characters');
      return;
    }

    setState('processing');
    setError(null);

    try {
      // Get user ID
      const { data: userData, error: userError } = await supabase_browser.auth.getUser();
      if (userError || !userData?.user?.id) {
        throw new Error('Please log in to import content');
      }

      const result = await processImport(content, userData.user.id, source);

      if (!result.success || !result.data) {
        throw new Error(result.error?.message || 'Failed to process content');
      }

      // Pass to preview
      onProcessed({
        title: result.data.title,
        content: result.data.content,
        source: result.data.detectedSource,
      });

      // Reset form
      setContent('');
      setSource('other');
      setState('idle');
      setWasAutoDetected(false);
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  }, [content, source, onProcessed]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Enter or Ctrl+Enter to submit
    if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
      e.preventDefault();
      handleProcess();
    }
  };

  const isProcessing = state === 'processing';
  const canProcess = content.trim().length >= 100 && !isProcessing;

  return (
    <div
      role="tabpanel"
      id="import-panel"
      aria-labelledby="import-tab"
      className={`w-full ${className}`}
    >
      {/* Content textarea - larger for import */}
      <textarea
        value={content}
        onChange={(e) => handleContentChange(e.target.value)}
        onKeyDown={handleKeyDown}
        data-testid="home-import-input"
        className="w-full bg-[var(--surface-primary)] border border-[var(--border-default)] focus:border-[var(--accent-gold)] px-6 py-4 text-base text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors duration-200 atlas-body resize-none rounded-none search-focus-glow"
        placeholder="Paste content from ChatGPT, Claude, or Gemini..."
        rows={5}
        disabled={isProcessing}
      />

      {/* Source selector row */}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-sm text-[var(--text-muted)]">Source:</span>
        <select
          value={source}
          onChange={(e) => handleSourceChange(e.target.value as ImportSource)}
          disabled={isProcessing}
          data-testid="home-import-source"
          className="bg-[var(--surface-secondary)] border border-[var(--border-default)] text-[var(--text-primary)] text-sm px-3 py-1.5 rounded-page focus:outline-none focus:border-[var(--accent-gold)] disabled:opacity-50"
        >
          <option value="chatgpt">{SOURCE_LABELS.chatgpt}</option>
          <option value="claude">{SOURCE_LABELS.claude}</option>
          <option value="gemini">{SOURCE_LABELS.gemini}</option>
          <option value="other">{SOURCE_LABELS.other}</option>
        </select>
        {state === 'detecting' && (
          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            <Spinner variant="circle" size={12} />
            Detecting...
          </span>
        )}
        {wasAutoDetected && state === 'idle' && (
          <span className="text-xs text-[var(--text-muted)]">(auto-detected)</span>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div
          data-testid="home-import-error"
          className="mt-3 text-sm text-[var(--destructive)] bg-[var(--destructive)]/10 px-4 py-2 rounded-page"
        >
          {error}
        </div>
      )}

      {/* Process button - centered */}
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={handleProcess}
          disabled={!canProcess}
          data-testid="home-import-submit"
          className="atlas-button disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <span className="flex items-center gap-2">
              <Spinner variant="circle" size={16} />
              Processing...
            </span>
          ) : (
            'Process'
          )}
        </button>
      </div>
    </div>
  );
}
