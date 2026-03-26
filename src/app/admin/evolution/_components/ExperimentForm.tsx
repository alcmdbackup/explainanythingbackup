// Experiment creation wizard: name/prompt setup, strategy selection, review, and submit.
// Uses V2 actions -- experiment auto-starts when first run is added.
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  createExperimentWithRunsAction,
  getPromptsAction,
  getStrategiesAction,
} from '@evolution/services/experimentActions';
import { createPromptAction } from '@evolution/services/arenaActions';
import { FormDialog, type FieldDef } from '@evolution/components/evolution/FormDialog';
import { StrategyConfigDisplay } from './StrategyConfigDisplay';

interface ExperimentFormProps {
  onCreated?: (experimentId: string) => void;
}

type Step = 'setup' | 'strategies' | 'review';
const STEPS: Step[] = ['setup', 'strategies', 'review'];
const STEP_LABELS: Record<Step, string> = { setup: 'Setup', strategies: 'Strategies', review: 'Review' };

const MAX_EXPERIMENT_BUDGET = 10.00;

interface StrategySelection {
  strategyId: string;
  runsCount: number;
}

export function ExperimentForm({ onCreated }: ExperimentFormProps): JSX.Element {
  const [step, setStep] = useState<Step>('setup');

  const [name, setName] = useState('');
  const [availablePrompts, setAvailablePrompts] = useState<Array<{ id: string; prompt: string; name: string }>>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  const [budgetPerRun, setBudgetPerRun] = useState(0.05);
  const [loading, setLoading] = useState(true);

  const [strategies, setStrategies] = useState<Array<{ id: string; name: string; label: string; config: Record<string, unknown> }>>([]);
  const [selections, setSelections] = useState<StrategySelection[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [setupSubmitted, setSetupSubmitted] = useState(false);
  const [showCreatePrompt, setShowCreatePrompt] = useState(false);

  const createPromptFields: FieldDef[] = useMemo(() => [
    { name: 'name', label: 'Prompt Name', type: 'text', required: true, placeholder: 'e.g., Explain gravity for kids' },
    { name: 'prompt', label: 'Prompt Text', type: 'textarea', required: true, placeholder: 'Enter the prompt text...' },
  ], []);

  const validateCreatePrompt = useCallback((values: Record<string, unknown>): string | null => {
    const nameVal = (typeof values.name === 'string' ? values.name : '').trim();
    const promptVal = (typeof values.prompt === 'string' ? values.prompt : '').trim();
    if (!nameVal) return 'Name is required';
    if (nameVal.length > 200) return `Name must be at most 200 characters (currently ${nameVal.length})`;
    if (!promptVal) return 'Prompt text is required';
    if (promptVal.length > 2000) return `Prompt text must be at most 2000 characters (currently ${promptVal.length})`;
    return null;
  }, []);

  const handleCreatePrompt = useCallback(async (values: Record<string, unknown>) => {
    const nameVal = (typeof values.name === 'string' ? values.name : '').trim();
    const promptVal = (typeof values.prompt === 'string' ? values.prompt : '').trim();
    const result = await createPromptAction({ name: nameVal, prompt: promptVal });
    if (!result.success || !result.data) {
      throw new Error(result.error?.message ?? 'Failed to create prompt');
    }
    const newPrompt = result.data as { id: string; name: string; prompt: string };
    setAvailablePrompts(prev => [newPrompt, ...prev]);
    setSelectedPromptId(newPrompt.id);
    toast.success(`Prompt "${newPrompt.name}" created`);
  }, []);

  useEffect(() => {
    (async () => {
      const [promptsRes, strategiesRes] = await Promise.all([
        getPromptsAction({ status: 'active', filterTestContent: true }),
        getStrategiesAction({ status: 'active', filterTestContent: true }),
      ]);
      if (promptsRes.success && promptsRes.data) {
        setAvailablePrompts(promptsRes.data);
      }
      if (strategiesRes.success && strategiesRes.data) {
        setStrategies(strategiesRes.data);
      }
      setLoading(false);
    })();
  }, []);

  const setupErrors: string[] = [];
  if (!name.trim()) setupErrors.push('Enter an experiment name');
  if (!selectedPromptId) setupErrors.push('Select a prompt');

  const eligibleStrategyIds = useMemo(() => {
    return new Set(
      strategies
        .filter(s => {
          const budget = s.config.budgetUsd as number | undefined;
          return !budget || budget <= budgetPerRun;
        })
        .map(s => s.id)
    );
  }, [strategies, budgetPerRun]);

  const totalRuns = selections.reduce((sum, s) => sum + s.runsCount, 0);
  const totalBudget = totalRuns * budgetPerRun;
  const overBudget = totalBudget > MAX_EXPERIMENT_BUDGET;

  const toggleStrategy = (strategyId: string) => {
    setSelections(prev => {
      const exists = prev.find(s => s.strategyId === strategyId);
      if (exists) return prev.filter(s => s.strategyId !== strategyId);
      return [...prev, { strategyId, runsCount: 1 }];
    });
  };

  const updateRunsCount = (strategyId: string, count: number) => {
    setSelections(prev =>
      prev.map(s => s.strategyId === strategyId ? { ...s, runsCount: Math.max(1, count) } : s)
    );
  };

  const handleSubmit = async () => {
    if (setupErrors.length > 0 || selections.length === 0 || overBudget) return;
    setSubmitting(true);

    try {
      const runs: Array<{ strategy_id: string; budget_cap_usd: number }> = [];
      for (const sel of selections) {
        for (let i = 0; i < sel.runsCount; i++) {
          runs.push({ strategy_id: sel.strategyId, budget_cap_usd: budgetPerRun });
        }
      }

      const result = await createExperimentWithRunsAction({
        name: name.trim(),
        promptId: selectedPromptId,
        runs,
      });

      if (!result.success || !result.data) {
        toast.error(result.error?.message ?? 'Failed to create experiment');
        setSubmitting(false);
        return;
      }

      toast.success(`Experiment created with ${totalRuns} run(s): ${result.data.experimentId}`);
      onCreated?.(result.data.experimentId);
    } catch (error) {
      toast.error(String(error));
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardContent className="p-8">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
            <span className="font-ui">Loading...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[var(--surface-secondary)] paper-texture">
      <CardHeader>
        <CardTitle className="text-xl font-display text-[var(--text-primary)]">
          New Experiment
        </CardTitle>
        <div className="flex gap-1 mt-2">
          {STEPS.map((s, i) => {
            return (
              <div key={s} className="flex-1 text-center">
                <div
                  className={`h-1 rounded-full transition-colors ${
                    i <= STEPS.indexOf(step)
                      ? 'bg-[var(--accent-gold)]'
                      : 'bg-[var(--border-default)]'
                  }`}
                />
                <span className={`text-xs font-ui mt-0.5 block ${
                  i <= STEPS.indexOf(step) ? 'text-[var(--accent-gold)]' : 'text-[var(--text-muted)]'
                }`}>{STEP_LABELS[s]}</span>
              </div>
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {step === 'setup' && (
          <>
            <div>
              <label className="block text-sm font-ui font-medium text-[var(--text-secondary)] mb-1">
                Experiment Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Model comparison Q1"
                className="w-full px-3 py-2 text-sm font-ui bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-gold)] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-ui font-medium text-[var(--text-secondary)] mb-2">
                Prompt
              </label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {availablePrompts.length === 0 ? (
                  <p className="text-xs font-ui text-[var(--text-muted)] py-3 text-center">
                    No active prompts in library
                  </p>
                ) : (
                  availablePrompts.map((p) => {
                    const isSelected = selectedPromptId === p.id;
                    return (
                      <label
                        key={p.id}
                        className={`flex items-start gap-3 p-3 border rounded-page cursor-pointer transition-colors ${
                          isSelected
                            ? 'border-[var(--accent-gold)] bg-[var(--surface-elevated)]'
                            : 'border-[var(--border-default)] bg-[var(--surface-primary)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="prompt"
                          checked={isSelected}
                          onChange={() => setSelectedPromptId(p.id)}
                          className="w-4 h-4 mt-0.5 accent-[var(--accent-gold)]"
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-ui font-medium text-[var(--text-primary)]">
                            {p.name}
                          </span>
                          <span className="text-xs font-body text-[var(--text-muted)] ml-2 truncate">
                            — {p.prompt.length > 80 ? p.prompt.slice(0, 80) + '...' : p.prompt}
                          </span>
                        </div>
                      </label>
                    );
                  })
                )}
                <button
                  type="button"
                  onClick={() => setShowCreatePrompt(true)}
                  data-testid="create-prompt-btn"
                  className="flex items-center gap-2 w-full p-3 border border-dashed border-[var(--border-default)] rounded-page text-sm font-ui font-medium text-[var(--accent-gold)] hover:bg-[var(--surface-elevated)] transition-colors"
                >
                  <span className="text-lg leading-none">+</span>
                  Create new prompt
                </button>
              </div>
              <FormDialog
                open={showCreatePrompt}
                onClose={() => setShowCreatePrompt(false)}
                title="Create New Prompt"
                fields={createPromptFields}
                onSubmit={handleCreatePrompt}
                validate={validateCreatePrompt}
              />
            </div>

            <div>
              <label className="block text-sm font-ui font-medium text-[var(--text-secondary)] mb-1">
                Budget per Run ($)
              </label>
              <input
                type="number"
                step="0.01"
                min={0.01}
                max={1.00}
                value={budgetPerRun}
                onChange={(e) => setBudgetPerRun(Number(e.target.value))}
                className="w-32 px-3 py-2 text-sm font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
              />
              <p className="text-xs font-body text-[var(--text-muted)] mt-1">
                Each run gets the same budget. Max $1.00 per run.
              </p>
            </div>

            {setupSubmitted && setupErrors.length > 0 && (
              <ul className="text-xs font-body text-[var(--status-error)] space-y-0.5">
                {setupErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}

            <button
              onClick={() => {
                setSetupSubmitted(true);
                if (setupErrors.length === 0) setStep('strategies');
              }}
              className="w-full py-2.5 font-ui text-sm font-medium bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Next: Select Strategies
            </button>
          </>
        )}

        {step === 'strategies' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-ui font-medium text-[var(--text-secondary)]">
                Select Strategies
              </span>
              <span className="text-xs font-ui text-[var(--text-muted)]">
                {selections.length} selected, {totalRuns} total runs
              </span>
            </div>

            {strategies.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-ui text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selections.length > 0 && selections.length === strategies.filter(s => eligibleStrategyIds.has(s.id)).length}
                  onChange={() => {
                    const eligible = strategies.filter(s => eligibleStrategyIds.has(s.id));
                    if (selections.length === eligible.length) {
                      setSelections([]);
                    } else {
                      setSelections(eligible.map(s => ({ strategyId: s.id, runsCount: selections.find(x => x.strategyId === s.id)?.runsCount ?? 1 })));
                    }
                  }}
                  className="w-4 h-4 accent-[var(--accent-gold)]"
                />
                {selections.length === strategies.filter(s => eligibleStrategyIds.has(s.id)).length ? 'Deselect all' : 'Select all'}
              </label>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {strategies.length === 0 ? (
                <p className="text-xs font-ui text-[var(--text-muted)] py-3 text-center">
                  No active strategies available
                </p>
              ) : (
                strategies.map((s) => {
                  const isEligible = eligibleStrategyIds.has(s.id);
                  const sel = selections.find(x => x.strategyId === s.id);
                  const isSelected = !!sel;

                  return (
                    <div
                      key={s.id}
                      className={`flex items-center gap-3 p-3 border rounded-page transition-colors ${
                        !isEligible
                          ? 'border-[var(--border-default)] bg-[var(--surface-primary)] opacity-40'
                          : isSelected
                            ? 'border-[var(--accent-gold)] bg-[var(--surface-elevated)]'
                            : 'border-[var(--border-default)] bg-[var(--surface-primary)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!isEligible}
                        onChange={() => toggleStrategy(s.id)}
                        className="w-4 h-4 accent-[var(--accent-gold)]"
                        data-testid={`strategy-check-${s.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-ui font-medium text-[var(--text-primary)] truncate">
                          {s.name}
                        </div>
                        <div className="text-xs font-ui text-[var(--text-muted)] truncate">
                          {s.label}
                          {s.config.budgetUsd != null && (
                            <span className="ml-1 text-[var(--accent-copper)]">
                              (${Number(s.config.budgetUsd).toFixed(2)}/run)
                            </span>
                          )}
                          {!isEligible && (
                            <span className="ml-1 text-[var(--status-warning)]">
                              — over budget
                            </span>
                          )}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-ui text-[var(--text-muted)]">Runs:</label>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={sel.runsCount}
                            onChange={(e) => updateRunsCount(s.id, Number(e.target.value))}
                            className="w-14 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
                            data-testid={`runs-count-${s.id}`}
                          />
                          <span className="text-xs font-mono text-[var(--text-muted)]">
                            ${(sel.runsCount * budgetPerRun).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between text-sm font-ui">
              <span className="text-[var(--text-secondary)]">Total estimated cost:</span>
              <span className={`font-mono font-semibold ${overBudget ? 'text-[var(--status-error)]' : 'text-[var(--text-primary)]'}`}>
                ${totalBudget.toFixed(2)} / ${MAX_EXPERIMENT_BUDGET.toFixed(2)}
              </span>
            </div>
            {overBudget && (
              <p className="text-xs font-body text-[var(--status-error)]">
                Total budget exceeds ${MAX_EXPERIMENT_BUDGET.toFixed(2)} cap. Reduce runs or budget per run.
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep('setup')}
                className="flex-1 py-2.5 font-ui text-sm font-medium border border-[var(--border-default)] text-[var(--text-secondary)] rounded-page hover:bg-[var(--surface-elevated)] transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep('review')}
                disabled={selections.length === 0 || overBudget}
                className="flex-1 py-2.5 font-ui text-sm font-medium bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                Review
              </button>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <div className="space-y-2 text-sm font-ui text-[var(--text-secondary)]">
              <div><span className="text-[var(--text-muted)]">Name:</span> {name}</div>
              <div><span className="text-[var(--text-muted)]">Strategies:</span> {selections.length}</div>
              <div><span className="text-[var(--text-muted)]">Total runs:</span> {totalRuns}</div>
              <div><span className="text-[var(--text-muted)]">Est. total budget:</span> ${totalBudget.toFixed(2)}</div>
            </div>

            <div className="border border-[var(--border-default)] rounded-page overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="bg-[var(--surface-elevated)] text-[var(--text-muted)]">
                    <th className="px-2 py-1 text-left">Strategy</th>
                    <th className="px-2 py-1 text-right">Runs</th>
                    <th className="px-2 py-1 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selections.map((sel) => {
                    const strategy = strategies.find(s => s.id === sel.strategyId);
                    return (
                      <tr key={sel.strategyId} className="border-t border-[var(--border-default)]">
                        <td className="px-2 py-1">{strategy?.name ?? sel.strategyId.slice(0, 8)}</td>
                        <td className="px-2 py-1 text-right">{sel.runsCount}</td>
                        <td className="px-2 py-1 text-right">${(sel.runsCount * budgetPerRun).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selections.map((sel) => {
              const strategy = strategies.find(s => s.id === sel.strategyId);
              if (!strategy) return null;
              return (
                <div key={sel.strategyId} className="space-y-2">
                  <h4 className="text-lg font-display font-medium text-[var(--text-muted)]">
                    {strategy.name} config
                  </h4>
                  <StrategyConfigDisplay config={strategy.config} />
                </div>
              );
            })}

            <div className="flex gap-3">
              <button
                onClick={() => setStep('strategies')}
                className="flex-1 py-2.5 font-ui text-sm font-medium border border-[var(--border-default)] text-[var(--text-secondary)] rounded-page hover:bg-[var(--surface-elevated)] transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || overBudget}
                data-testid="experiment-submit-btn"
                className="flex-1 py-2.5 font-ui text-sm font-medium bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-[var(--surface-primary)] border-t-transparent rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  'Create Experiment'
                )}
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
