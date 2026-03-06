'use client';
/**
 * Manual experiment creation form: name/prompt → configure runs → review & start.
 * Each run has its own model, judge, agents, and budget configuration.
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  createManualExperimentAction,
  addRunToExperimentAction,
  startManualExperimentAction,
} from '@evolution/services/experimentActions';
import { getPromptsAction } from '@evolution/services/promptRegistryActions';
import type { PromptMetadata } from '@evolution/lib/types';
import { OPTIONAL_AGENTS } from '@evolution/lib/core/agentConfiguration';
import {
  MODEL_OPTIONS,
  DEFAULT_RUN_STATE,
  runFormToConfig,
  type RunFormState,
} from './runFormUtils';

interface ExperimentFormProps {
  onStarted?: (experimentId: string) => void;
}

type Step = 'setup' | 'runs' | 'review';
const STEPS: Step[] = ['setup', 'runs', 'review'];

export function ExperimentForm({ onStarted }: ExperimentFormProps): JSX.Element {
  const [step, setStep] = useState<Step>('setup');

  const [name, setName] = useState('');
  const [availablePrompts, setAvailablePrompts] = useState<PromptMetadata[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>('');
  const [budgetPerRun, setBudgetPerRun] = useState(0.50);
  const [promptsLoading, setPromptsLoading] = useState(true);
  const [runs, setRuns] = useState<RunFormState[]>([{ ...DEFAULT_RUN_STATE }]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await getPromptsAction({ status: 'active' });
      if (result.success && result.data) {
        setAvailablePrompts(result.data);
      }
      setPromptsLoading(false);
    })();
  }, []);

  const setupErrors: string[] = [];
  if (!name.trim()) setupErrors.push('Enter an experiment name');
  if (!selectedPromptId) setupErrors.push('Select a prompt');

  const totalBudget = budgetPerRun * runs.length;

  const handleAddRun = () => {
    setRuns(prev => [...prev, { ...DEFAULT_RUN_STATE }]);
  };

  const handleRemoveRun = (index: number) => {
    setRuns(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateRun = (index: number, updates: Partial<RunFormState>) => {
    setRuns(prev => prev.map((r, i) => i === index ? { ...r, ...updates } : r));
  };

  const toggleRunAgent = (index: number, agent: string) => {
    setRuns(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const has = r.enabledAgents.includes(agent);
      return {
        ...r,
        enabledAgents: has
          ? r.enabledAgents.filter(a => a !== agent)
          : [...r.enabledAgents, agent],
      };
    }));
  };

  const handleSubmit = async () => {
    if (setupErrors.length > 0 || runs.length === 0) return;
    setSubmitting(true);

    try {
      const createResult = await createManualExperimentAction({
        name: name.trim(),
        promptId: selectedPromptId,
      });
      if (!createResult.success || !createResult.data) {
        toast.error(createResult.error?.message ?? 'Failed to create experiment');
        return;
      }

      const experimentId = createResult.data.experimentId;

      for (const run of runs) {
        const addResult = await addRunToExperimentAction({
          experimentId,
          config: { ...runFormToConfig(run), budgetCapUsd: budgetPerRun },
        });
        if (!addResult.success) {
          toast.error(addResult.error?.message ?? 'Failed to add run');
          return;
        }
      }

      const startResult = await startManualExperimentAction({ experimentId });
      if (!startResult.success) {
        toast.error(startResult.error?.message ?? 'Failed to start experiment');
        return;
      }

      toast.success(`Experiment started: ${experimentId}`);
      onStarted?.(experimentId);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (promptsLoading) {
    return (
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardContent className="p-8">
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <div className="w-4 h-4 border-2 border-[var(--accent-gold)] border-t-transparent rounded-full animate-spin" />
            <span className="font-ui">Loading prompts...</span>
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
              onClick={() => setStep('runs')}
              disabled={setupErrors.length > 0}
              className="w-full py-2.5 font-ui text-sm font-medium bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Next: Configure Runs
            </button>
          </>
        )}

        {step === 'runs' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-ui font-medium text-[var(--text-secondary)]">
                Runs ({runs.length})
              </span>
              <button
                onClick={handleAddRun}
                className="text-xs font-ui text-[var(--accent-gold)] hover:underline"
              >
                + Add Run
              </button>
            </div>

            <div className="space-y-4">
              {runs.map((run, index) => (
                <div
                  key={index}
                  className="p-3 border border-[var(--border-default)] rounded-page bg-[var(--surface-primary)] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-ui font-medium text-[var(--text-muted)]">
                      Run {index + 1}
                    </span>
                    {runs.length > 1 && (
                      <button
                        onClick={() => handleRemoveRun(index)}
                        className="text-xs font-ui text-[var(--status-error)] hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-ui text-[var(--text-muted)] mb-1">
                        Generation Model
                      </label>
                      <select
                        value={run.generationModel}
                        onChange={(e) => handleUpdateRun(index, { generationModel: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs font-mono bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
                      >
                        {MODEL_OPTIONS.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-ui text-[var(--text-muted)] mb-1">
                        Judge Model
                      </label>
                      <select
                        value={run.judgeModel}
                        onChange={(e) => handleUpdateRun(index, { judgeModel: e.target.value })}
                        className="w-full px-2 py-1.5 text-xs font-mono bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
                      >
                        {MODEL_OPTIONS.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-ui text-[var(--text-muted)] mb-1">
                      Optional Agents
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {OPTIONAL_AGENTS.map(agent => {
                        const isOn = run.enabledAgents.includes(agent);
                        return (
                          <button
                            key={agent}
                            type="button"
                            onClick={() => toggleRunAgent(index, agent)}
                            className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${
                              isOn
                                ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
                                : 'bg-[var(--surface-secondary)] text-[var(--text-muted)] border border-[var(--border-default)]'
                            }`}
                          >
                            {agent}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('setup')}
                className="flex-1 py-2.5 font-ui text-sm font-medium border border-[var(--border-default)] text-[var(--text-secondary)] rounded-page hover:bg-[var(--surface-elevated)] transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep('review')}
                disabled={runs.length === 0}
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
              <div><span className="text-[var(--text-muted)]">Runs:</span> {runs.length}</div>
              <div><span className="text-[var(--text-muted)]">Est. total budget:</span> ${totalBudget.toFixed(2)}</div>
            </div>

            <div className="border border-[var(--border-default)] rounded-page overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="bg-[var(--surface-elevated)] text-[var(--text-muted)]">
                    <th className="px-2 py-1 text-left">#</th>
                    <th className="px-2 py-1 text-left">Model</th>
                    <th className="px-2 py-1 text-left">Judge</th>
                    <th className="px-2 py-1 text-left">Agents</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run, i) => (
                    <tr key={i} className="border-t border-[var(--border-default)]">
                      <td className="px-2 py-1">{i + 1}</td>
                      <td className="px-2 py-1">{run.generationModel}</td>
                      <td className="px-2 py-1">{run.judgeModel}</td>
                      <td className="px-2 py-1 text-[var(--text-muted)]">
                        {run.enabledAgents.length > 0 ? run.enabledAgents.join(', ') : 'defaults'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('runs')}
                className="flex-1 py-2.5 font-ui text-sm font-medium border border-[var(--border-default)] text-[var(--text-secondary)] rounded-page hover:bg-[var(--surface-elevated)] transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
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
