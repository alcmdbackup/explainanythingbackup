'use client';
// Client child of /edit page. Handles strategy picker + textarea + Submit.
// Submits via submitPublicEditAction, navigates to /edit/runs/[runId] on success.
// Style: mirrors HomeSearchPanel patterns (atlas-* classes, rounded-none textarea,
// atlas-button submit, atlas-loading-dots indicator).

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { submitPublicEditAction } from './publicEditActions';
import type { PublicStrategySummary } from '@evolution/services/strategyRegistryActions';

interface EditFormProps {
  initialStrategies: PublicStrategySummary[];
}

const MAX_ARTICLE_CHARS = 50_000;

export default function EditForm({ initialStrategies }: EditFormProps): JSX.Element {
  const router = useRouter();
  const [articleText, setArticleText] = useState('');
  const [strategyId, setStrategyId] = useState<string>(initialStrategies[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!articleText.trim() || !strategyId || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitPublicEditAction({ articleText, strategyId });
      if (result?.success && result.data) {
        router.push(`/edit/runs/${result.data.runId}`);
        return;
      }
      setSubmitError(result?.error?.message ?? 'Submission failed. Try again.');
      setSubmitting(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed. Try again.');
      setSubmitting(false);
    }
  }, [articleText, strategyId, submitting, router]);

  if (initialStrategies.length === 0) {
    return (
      <div data-testid="edit-form-no-strategies" className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture p-6">
        <p className="atlas-body text-[var(--text-muted)] text-center">
          No public strategies are currently available. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <form data-testid="edit-form" onSubmit={handleSubmit} className="w-full">
      <fieldset className="mb-6">
        <legend className="atlas-ui text-sm font-medium text-[var(--text-primary)] mb-3">
          How should we improve it?
        </legend>
        <div data-testid="strategy-picker" className="space-y-3">
          {initialStrategies.map((strategy) => (
            <label
              key={strategy.id}
              className={`scholar-card scholar-card-hover block cursor-pointer rounded-book border p-4 paper-texture transition-colors ${
                strategyId === strategy.id
                  ? 'border-[var(--accent-gold)] bg-[var(--surface-elevated)]'
                  : 'border-[var(--border-default)] bg-[var(--surface-secondary)]'
              }`}
              data-testid={`strategy-option-${strategy.id}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="strategyId"
                  value={strategy.id}
                  checked={strategyId === strategy.id}
                  onChange={(e) => setStrategyId(e.target.value)}
                  className="mt-1"
                  disabled={submitting}
                />
                <div className="flex-1">
                  <div className="atlas-ui text-base font-medium text-[var(--text-primary)]">
                    {strategy.label || strategy.name}
                  </div>
                  {strategy.description && (
                    <div className="atlas-body text-sm text-[var(--text-muted)] mt-1">
                      {strategy.description}
                    </div>
                  )}
                </div>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="relative group mb-6">
        <label htmlFor="edit-textarea" className="block atlas-ui text-sm font-medium text-[var(--text-primary)] mb-3">
          Your text
        </label>
        <textarea
          id="edit-textarea"
          data-testid="edit-textarea"
          value={articleText}
          onChange={(e) => setArticleText(e.target.value)}
          rows={12}
          maxLength={MAX_ARTICLE_CHARS}
          disabled={submitting}
          placeholder="Paste anything here. An article, an essay, a draft email…"
          className="w-full bg-[var(--surface-primary)] border border-[var(--border-default)] focus:border-[var(--accent-gold)] px-6 py-4 text-base text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none transition-colors duration-200 atlas-body resize-y rounded-none search-focus-glow"
        />
        <div className="atlas-ui text-xs text-[var(--text-muted)] text-right mt-1">
          {articleText.length.toLocaleString()} / {MAX_ARTICLE_CHARS.toLocaleString()}
        </div>
      </div>

      {submitError && (
        <div
          data-testid="edit-form-error"
          className="mb-4 p-4 rounded-book border border-[var(--status-error)] bg-[var(--surface-secondary)] text-[var(--status-error)] atlas-body text-sm"
        >
          {submitError}
        </div>
      )}

      <div className="flex justify-center">
        <button
          type="submit"
          data-testid="edit-submit"
          disabled={submitting || !articleText.trim() || !strategyId}
          className="atlas-button disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <span className="atlas-loading-dots">
              <span className="atlas-loading-dot"></span>
              <span className="atlas-loading-dot"></span>
              <span className="atlas-loading-dot"></span>
            </span>
          ) : (
            'Improve →'
          )}
        </button>
      </div>
    </form>
  );
}
