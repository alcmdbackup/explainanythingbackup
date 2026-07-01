'use client';
// Client child of /edit page. Handles strategy picker + textarea + Submit.
// Submits via submitPublicEditAction, navigates to /edit/runs/[runId] on success.
//
// Refactored by improvements_to_edit_page_evolution_20260630 Phase 2:
// - Radio-card list → searchable Combobox with renderOption
// - Per-option [Show config] button → modal Dialog rendering StrategyConfigDisplay
// - Warning badge when strategy's budgetUsd > $0.10
// - Config fetched lazily via getPublicStrategyConfigAction on modal open

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { submitPublicEditAction } from './publicEditActions';
import {
  getPublicStrategyConfigAction,
  type PublicStrategySummary,
} from '@evolution/services/strategyRegistryActions';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StrategyConfigDisplay } from '@/components/strategy/StrategyConfigDisplay';
import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types';

interface EditFormProps {
  initialStrategies: PublicStrategySummary[];
}

const MAX_ARTICLE_CHARS = 50_000;
const BUDGET_WARNING_THRESHOLD_USD = 0.10;

interface StrategyComboboxOption extends ComboboxOption {
  strategy: PublicStrategySummary;
}

export default function EditForm({ initialStrategies }: EditFormProps): JSX.Element {
  const router = useRouter();
  const [articleText, setArticleText] = useState('');
  const [strategyId, setStrategyId] = useState<string>(initialStrategies[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Hydration proof: Rule 18 hydration gate for the combobox POM.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Config modal state.
  const [configModalStrategyId, setConfigModalStrategyId] = useState<string | null>(null);
  const [configModalConfig, setConfigModalConfig] = useState<StrategyConfig | null>(null);
  const [configModalLoading, setConfigModalLoading] = useState(false);
  const [configModalError, setConfigModalError] = useState<string | null>(null);

  const openConfigModal = useCallback(async (id: string) => {
    setConfigModalStrategyId(id);
    setConfigModalConfig(null);
    setConfigModalError(null);
    setConfigModalLoading(true);
    try {
      const result = await getPublicStrategyConfigAction(id);
      if (result?.success && result.data) {
        setConfigModalConfig(result.data);
      } else {
        setConfigModalError(result?.error?.message ?? 'Failed to load strategy config.');
      }
    } catch (err) {
      setConfigModalError(err instanceof Error ? err.message : 'Failed to load strategy config.');
    } finally {
      setConfigModalLoading(false);
    }
  }, []);

  const closeConfigModal = useCallback(() => {
    setConfigModalStrategyId(null);
    setConfigModalConfig(null);
    setConfigModalError(null);
  }, []);

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

  // Build combobox options + a lookup index.
  const strategiesById = new Map<string, PublicStrategySummary>(
    initialStrategies.map((s) => [s.id, s]),
  );
  const options: StrategyComboboxOption[] = initialStrategies.map((s) => ({
    value: s.id,
    label: s.label || s.name,
    keywords: [s.description ?? '', s.generationModel, s.judgeModel].filter(Boolean),
    strategy: s,
  }));

  const selectedStrategy = strategiesById.get(strategyId) ?? initialStrategies[0]!;
  const configModalStrategy = configModalStrategyId
    ? strategiesById.get(configModalStrategyId)
    : null;

  return (
    <form data-testid="edit-form" onSubmit={handleSubmit} className="w-full">
      <fieldset className="mb-6">
        <legend className="atlas-ui text-sm font-medium text-[var(--text-primary)] mb-3">
          How should we improve it?
        </legend>
        <div data-testid="strategy-picker" className="space-y-2">
          {hydrated && (
            <span data-testid="strategy-combobox-hydrated" style={{ display: 'none' }} />
          )}
          <Combobox
            options={options}
            value={strategyId}
            onChange={setStrategyId}
            placeholder="Search strategies..."
            idPrefix="strategy-combobox"
            testId="strategy-combobox-trigger"
            aria-label="Strategy"
            inputClassName="w-full"
            listboxClassName="w-full"
            className="w-full"
            renderOption={(opt) => {
              const s = (opt as StrategyComboboxOption).strategy;
              const overBudget = s.budgetUsd > BUDGET_WARNING_THRESHOLD_USD;
              return (
                <div className="flex items-start gap-2 py-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="atlas-ui text-sm font-medium text-[var(--text-primary)]">
                        {s.label || s.name}
                      </span>
                      <span className="atlas-ui text-xs text-[var(--text-muted)]">
                        · {s.generationModel} · ${s.budgetUsd.toFixed(2)}
                      </span>
                      {overBudget && (
                        <span
                          data-testid={`strategy-option-budget-warning-${s.id}`}
                          className="atlas-ui text-xs px-1.5 py-0.5 rounded bg-[var(--status-warning)]/20 text-[var(--status-warning)]"
                          title="Budget above $0.10 per run"
                        >
                          ⚠ ${s.budgetUsd.toFixed(2)}
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <div className="atlas-body text-xs text-[var(--text-muted)] mt-0.5 truncate">
                        {s.description}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    data-testid={`strategy-option-show-config-${s.id}`}
                    onMouseDown={(e) => {
                      // Stop the Combobox from selecting the option before we open the modal.
                      e.preventDefault();
                      e.stopPropagation();
                      void openConfigModal(s.id);
                    }}
                    className="atlas-ui text-xs px-2 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] flex-shrink-0"
                    aria-label={`Show config for ${s.name}`}
                  >
                    Show config
                  </button>
                </div>
              );
            }}
          />
          {selectedStrategy && selectedStrategy.budgetUsd > BUDGET_WARNING_THRESHOLD_USD && (
            <div
              data-testid="selected-strategy-budget-warning"
              className="atlas-ui text-xs text-[var(--status-warning)] flex items-center gap-1"
            >
              ⚠ This strategy runs at ${selectedStrategy.budgetUsd.toFixed(2)} — above the usual $0.10 cap.
            </div>
          )}
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

      <Dialog open={configModalStrategyId !== null} onOpenChange={(open) => { if (!open) closeConfigModal(); }}>
        <DialogContent data-testid="strategy-config-modal" className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {configModalStrategy ? (configModalStrategy.label || configModalStrategy.name) : 'Strategy config'}
            </DialogTitle>
          </DialogHeader>
          {configModalStrategy && configModalStrategy.budgetUsd > BUDGET_WARNING_THRESHOLD_USD && (
            <div
              data-testid="strategy-config-modal-budget-warning"
              className="mb-3 p-3 rounded-book border border-[var(--status-warning)] bg-[var(--surface-secondary)] text-[var(--status-warning)] atlas-body text-sm"
            >
              ⚠ Budget above $0.10 — this rewrite may cost more than usual (up to ${configModalStrategy.budgetUsd.toFixed(2)} per run).
            </div>
          )}
          {configModalLoading && (
            <div data-testid="strategy-config-modal-loading" className="atlas-body text-[var(--text-muted)] text-sm">
              Loading…
            </div>
          )}
          {configModalError && (
            <div data-testid="strategy-config-modal-error" className="atlas-body text-[var(--status-error)] text-sm">
              {configModalError}
            </div>
          )}
          {configModalConfig && (
            <StrategyConfigDisplay config={configModalConfig} />
          )}
        </DialogContent>
      </Dialog>
    </form>
  );
}
