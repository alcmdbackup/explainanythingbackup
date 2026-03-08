'use client';
/**
 * Experiment creation form: name/prompt → select strategies → review & start.
 * Strategies are picked from the active registry; each gets a configurable run count.
 */

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  createManualExperimentAction,
  addRunToExperimentAction,
  startManualExperimentAction,
} from '@evolution/services/experimentActions';
import { getPromptsAction } from '@evolution/services/promptRegistryActions';
import { getStrategiesAction } from '@evolution/services/strategyRegistryActions';
import type { PromptMetadata } from '@evolution/lib/types';
import type { StrategyConfigRow } from '@evolution/lib/core/strategyConfig';
import { StrategyConfigDisplay } from './StrategyConfigDisplay';

interface ExperimentFormProps {
  onStarted?: (experimentId: string) => void;
}

type Step = 'setup' | 'strategies' | 'review';
const STEPS: Step[] = ['setup', 'strategies', 'review'];

const MAX_EXPERIMENT_BUDGET = 10.00;

interface StrategySelection {
  strategyId: string;
  runsCount: number;
}

export function ExperimentForm({ onStarted }: ExperimentFormProps): JSX.Element {
  const [step, setStep] = useState<Step>('setup');

  const [name, setName] = useState('');
  const [availablePrompts, setAvailablePrompts] = useState<PromptMetadata[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  const [budgetPerRun, setBudgetPerRun] = useState(0.50);
  const [loading, setLoading] = useState(true);

  const [strategies, setStrategies] = useState<StrategyConfigRow[]>([]);
  const [selections, setSelections] = useState<StrategySelection[]>([]);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [promptsRes, strategiesRes] = await Promise.all([
        getPromptsAction({ status: 'active' }),
        getStrategiesAction(),
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
        .filter(s => !s.config.budgetCapUsd || s.config.budgetCapUsd <= budgetPerRun)
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
      const createResult = await createManualExperimentAction({
        name: name.trim(),
        promptId: selectedPromptId,
      });
      if (!createResult.success || !createResult.data) {
        toast.error(createResult.error?.message ?? 'Failed to create experiment');
        setSubmitting(false);
        return;
      }

      const experimentId = createResult.data.experimentId;

      for (const sel of selections) {
        const strategy = strategies.find(s => s.id === sel.strategyId);
        if (!strategy) continue;

        for (let i = 0; i < sel.runsCount; i++) {
          const addResult = await addRunToExperimentAction({
            experimentId,
            config: {
              generationModel: strategy.config.generationModel,
              judgeModel: strategy.config.judgeModel,
              enabledAgents: strategy.config.enabledAgents,
              budgetCapUsd: budgetPerRun,
              maxIterations: strategy.config.iterations,
            },
          });
          if (!addResult.success) {
            toast.error(addResult.error?.message ?? 'Failed to add run');
            setSubmitting(false);
            return;
          }
        }
      }

      const startResult = await startManualExperimentAction({ experimentId });
      if (!startResult.success) {
        toast.error(startResult.error?.message ?? 'Failed to start experiment');
        setSubmitting(false);
        return;
      }

      toast.success(`Experiment started: ${experimentId}`);
      onStarted?.(experimentId);
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
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= STEPS.indexOf(step)
                  ? 'bg-[var(--accent-gold)]'
                  : 'bg-[var(--border-default)]'
              }`}
            />
          ))}
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
                            {p.title}
                          </span>
                          <span className="text-xs font-body text-[var(--text-muted)] ml-2 truncate">
                            — {p.prompt.length > 80 ? p.prompt.slice(0, 80) + '...' : p.prompt}
                          </span>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
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

            {setupErrors.length > 0 && (
              <ul className="text-xs font-body text-[var(--status-error)] space-y-0.5">
                {setupErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}

            <button
              onClick={() => setStep('strategies')}
              disabled={setupErrors.length > 0}
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
                          {s.config.budgetCapUsd != null && (
                            <span className="ml-1 text-[var(--accent-copper)]">
                              (${s.config.budgetCapUsd.toFixed(2)}/run)
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
                  <h4 className="text-xs font-ui font-medium text-[var(--text-muted)]">
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
                    Starting...
                  </span>
                ) : (
                  'Start Experiment'
                )}
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
