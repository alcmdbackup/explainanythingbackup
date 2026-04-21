// 2-step strategy creation wizard: configure strategy settings, then define iteration sequence.
// Follows the ExperimentForm step-navigation pattern (progress bar, Back/Next).

'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MODEL_OPTIONS } from '@/lib/utils/modelOptions';
import { DEFAULT_JUDGE_MODEL } from '@/config/modelRegistry';
import { createStrategyAction } from '@evolution/services/strategyRegistryActions';
import { TACTICS_BY_CATEGORY, TACTIC_PALETTE, DEFAULT_TACTICS } from '@evolution/lib/core/tactics';
import { estimateAgentCost } from '@evolution/lib/pipeline/infra/estimateCosts';

// ─── Types ──────────────────────────────────────────────────────

type Step = 'config' | 'iterations';
const STEPS: Step[] = ['config', 'iterations'];
const STEP_LABELS: Record<Step, string> = { config: 'Strategy Config', iterations: 'Iterations + Submit' };

type BudgetFloorMode = 'fraction' | 'agentMultiple';

interface IterationRow {
  agentType: 'generate' | 'swiss';
  budgetPercent: number;
  maxAgents?: number;
  /** Phase 2: parent-article source for this generate iteration. Defaults to 'seed'.
   *  Not applicable to swiss. First iteration is locked to 'seed' by schema refine. */
  sourceMode?: 'seed' | 'pool';
  /** Phase 2: quality cutoff for pool-mode. Required when sourceMode==='pool'. */
  qualityCutoffMode?: 'topN' | 'topPercent';
  qualityCutoffValue?: number;
  /** Per-iteration tactic guidance. Overrides strategy-level for this iteration. */
  tacticGuidance?: Array<{ tactic: string; percent: number }>;
}

interface StrategyFormState {
  name: string;
  description: string;
  generationModel: string;
  judgeModel: string;
  generationTemperature: string;
  budgetUsd: string;
  maxComparisonsPerVariant: string;
  budgetFloorMode: BudgetFloorMode;
  parallelFloorValue: string;
  sequentialFloorValue: string;
}

const DEFAULT_MAX_AGENTS = 100;

const DEFAULT_ITERATIONS: IterationRow[] = [
  { agentType: 'generate', budgetPercent: 60, maxAgents: DEFAULT_MAX_AGENTS },
  { agentType: 'swiss', budgetPercent: 40 },
];

// ─── Tactic Guidance Popover ────────────────────────────────────

/** Inline popover for configuring per-iteration tactic weights. */
function TacticGuidanceEditor({
  guidance,
  onChange,
  onClose,
}: {
  guidance: Array<{ tactic: string; percent: number }>;
  onChange: (g: Array<{ tactic: string; percent: number }>) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const entry of guidance) map[entry.tactic] = entry.percent;
    return map;
  });

  const total = Object.values(local).reduce((s, v) => s + v, 0);
  const isValid = Math.abs(total - 100) < 0.01;
  const allTactics = Object.entries(TACTICS_BY_CATEGORY);

  const setPercent = (tactic: string, pct: number) => {
    setLocal(prev => ({ ...prev, [tactic]: Math.max(0, Math.min(100, pct)) }));
  };

  const applyPreset = (preset: 'even' | 'core' | 'clear') => {
    if (preset === 'clear') {
      // Clear removes all guidance and closes the editor
      onChange([]);
      onClose();
      return;
    }
    const allNames = allTactics.flatMap(([, names]) => names);
    const coreNames = TACTICS_BY_CATEGORY['core'] ?? [];
    const map: Record<string, number> = {};
    if (preset === 'even') {
      const each = Math.floor(100 / allNames.length);
      const rem = 100 - each * allNames.length;
      allNames.forEach((n, i) => { map[n] = each + (i === 0 ? rem : 0); });
    } else if (preset === 'core') {
      const each = Math.floor(100 / coreNames.length);
      const rem = 100 - each * coreNames.length;
      coreNames.forEach((n, i) => { map[n] = each + (i === 0 ? rem : 0); });
    }
    setLocal(map);
  };

  const handleApply = () => {
    const entries = Object.entries(local)
      .filter(([, pct]) => pct > 0)
      .map(([tactic, percent]) => ({ tactic, percent }));
    onChange(entries);
    onClose();
  };

  return (
    <div className="mt-2 ml-8 p-3 rounded-page border border-[var(--accent-gold)]/40 bg-[var(--surface-elevated)] space-y-3" data-testid="tactic-guidance-editor">
      <div className="flex items-center justify-between">
        <span className="text-xs font-ui font-medium text-[var(--text-secondary)]">Configure Tactics</span>
        <span className={`text-xs font-mono ${isValid ? 'text-[var(--status-success)]' : 'text-[var(--status-error)]'}`}>
          Total: {total.toFixed(0)}%
        </span>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {allTactics.map(([category, names]) => (
          <div key={category}>
            <span className="text-xs font-ui uppercase tracking-wide text-[var(--text-muted)]">{category}</span>
            <div className="space-y-0.5 mt-0.5">
              {names.map(name => (
                <div key={name} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: TACTIC_PALETTE[name] ?? '#888' }} />
                  <span className="text-xs font-ui text-[var(--text-primary)] flex-1 truncate" title={name}>{name}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={local[name] ?? 0}
                    onChange={e => setPercent(name, parseInt(e.target.value) || 0)}
                    className="w-12 px-1 py-0.5 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded text-right focus:border-[var(--accent-gold)] focus:outline-none"
                  />
                  <span className="text-xs text-[var(--text-muted)]">%</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-[var(--border-default)]">
        <button type="button" onClick={() => applyPreset('even')} className="text-xs font-ui text-[var(--accent-gold)] hover:underline">Even</button>
        <button type="button" onClick={() => applyPreset('core')} className="text-xs font-ui text-[var(--accent-gold)] hover:underline">Core only</button>
        <button type="button" onClick={() => applyPreset('clear')} className="text-xs font-ui text-[var(--accent-gold)] hover:underline">Clear</button>
        <div className="flex-1" />
        <button type="button" onClick={onClose} className="px-2 py-1 text-xs font-ui text-[var(--text-muted)] hover:underline">Cancel</button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!isValid}
          className="px-2 py-1 text-xs font-ui bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────

export default function NewStrategyPage(): JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState<Step>('config');
  const [submitting, setSubmitting] = useState(false);
  const [configSubmitted, setConfigSubmitted] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [form, setForm] = useState<StrategyFormState>({
    name: '',
    description: '',
    generationModel: '',
    judgeModel: DEFAULT_JUDGE_MODEL,
    generationTemperature: '',
    budgetUsd: '0.05',
    maxComparisonsPerVariant: '5',
    budgetFloorMode: 'agentMultiple',
    parallelFloorValue: '2',
    sequentialFloorValue: '',
  });

  const [iterations, setIterations] = useState<IterationRow[]>([...DEFAULT_ITERATIONS]);
  const [tacticEditorIdx, setTacticEditorIdx] = useState<number | null>(null);

  useEffect(() => { document.title = 'New Strategy | Evolution'; }, []);

  const updateForm = useCallback((patch: Partial<StrategyFormState>) => {
    setForm(prev => ({ ...prev, ...patch }));
  }, []);

  // ─── Validation ─────────────────────────────────────────────

  const configErrors = useMemo(() => {
    const errors: string[] = [];
    if (!form.name.trim()) errors.push('Name is required');
    if (!form.generationModel) errors.push('Select a generation model');
    if (!form.judgeModel) errors.push('Select a judge model');
    const budget = parseFloat(form.budgetUsd);
    if (isNaN(budget) || budget < 0.01) errors.push('Budget must be at least $0.01');
    if (budget > 100) errors.push('Budget cannot exceed $100');
    const temp = form.generationTemperature ? parseFloat(form.generationTemperature) : null;
    if (temp !== null && (isNaN(temp) || temp < 0 || temp > 2)) errors.push('Temperature must be 0-2');
    return errors;
  }, [form]);

  const totalBudget = parseFloat(form.budgetUsd) || 0;
  const totalPercent = iterations.reduce((sum, it) => sum + it.budgetPercent, 0);
  const percentValid = Math.abs(totalPercent - 100) < 0.01;

  // Dispatch preview: reuses estimateAgentCost() from the pipeline for accurate model-aware estimates.
  // Recalculates when budget, iteration percentages, maxAgents, model, or floor settings change.
  const dispatchEstimates = useMemo(() => {
    const pFloor = form.parallelFloorValue ? parseFloat(form.parallelFloorValue) : 0;
    const sFloor = form.sequentialFloorValue ? parseFloat(form.sequentialFloorValue) : 0;
    const floorMode = form.budgetFloorMode;
    const maxComp = form.maxComparisonsPerVariant ? parseInt(form.maxComparisonsPerVariant) : 15;
    const defaultTactic = DEFAULT_TACTICS[0]!;
    const seedChars = 5000; // typical seed article length for preview

    const estPerAgent = (form.generationModel && form.judgeModel)
      ? estimateAgentCost(seedChars, defaultTactic, form.generationModel, form.judgeModel, 1, maxComp)
      : 0.01; // fallback if no model selected

    return iterations.map(it => {
      if (it.agentType !== 'generate') return null;
      const iterBudget = totalBudget * (it.budgetPercent / 100);
      const maxAgents = it.maxAgents ?? DEFAULT_MAX_AGENTS;

      const parallelFloorUsd = floorMode === 'fraction' ? iterBudget * pFloor : estPerAgent * pFloor;
      const availForParallel = Math.max(0, iterBudget - parallelFloorUsd);
      const uncappedParallel = Math.floor(availForParallel / estPerAgent);
      const parallel = Math.min(maxAgents, Math.max(1, uncappedParallel));

      // Detect why agent count is limited
      const floorConstrained = uncappedParallel < 1 && pFloor > 0;
      const maxAgentsCapped = uncappedParallel > maxAgents;

      const sequentialFloorUsd = floorMode === 'fraction' ? iterBudget * sFloor : estPerAgent * sFloor;
      const remainAfterParallel = Math.max(0, iterBudget - parallel * estPerAgent);
      const availForSequential = Math.max(0, remainAfterParallel - sequentialFloorUsd);
      const sequential = Math.max(0, Math.floor(availForSequential / estPerAgent));

      return { parallel, sequential, estPerAgent, iterBudget, floorConstrained, maxAgentsCapped };
    });
  }, [iterations, totalBudget, form.generationModel, form.judgeModel, form.maxComparisonsPerVariant, form.parallelFloorValue, form.sequentialFloorValue, form.budgetFloorMode]);

  const iterationErrors = useMemo(() => {
    const errors: string[] = [];
    if (iterations.length === 0) errors.push('At least one iteration is required');
    if (iterations.length > 0 && iterations[0]?.agentType !== 'generate') errors.push('First iteration must be generate');
    if (!percentValid) errors.push(`Budget percentages must sum to 100% (currently ${totalPercent.toFixed(1)}%)`);
    // Check swiss doesn't precede all generates
    let hasGenerate = false;
    for (const it of iterations) {
      if (it.agentType === 'generate') hasGenerate = true;
      if (it.agentType === 'swiss' && !hasGenerate) {
        errors.push('Swiss iteration cannot precede all generate iterations');
        break;
      }
    }
    // Phase 2: first-iteration and pool-mode validation.
    if (iterations.length > 0 && iterations[0]?.sourceMode === 'pool') {
      errors.push('First iteration cannot use pool-mode (pool is empty at start); use seed mode');
    }
    iterations.forEach((it, i) => {
      if (it.sourceMode === 'pool' && (it.qualityCutoffValue == null || it.qualityCutoffValue <= 0)) {
        errors.push(`Iteration ${i + 1}: pool mode requires a positive quality-cutoff value`);
      }
      if (it.tacticGuidance && it.tacticGuidance.length > 0) {
        const tacticSum = it.tacticGuidance.reduce((s, g) => s + g.percent, 0);
        if (Math.abs(tacticSum - 100) > 0.01) {
          errors.push(`Iteration ${i + 1}: tactic percentages must sum to 100% (currently ${tacticSum.toFixed(0)}%)`);
        }
      }
    });
    return errors;
  }, [iterations, percentValid, totalPercent]);

  // ─── Iteration helpers ──────────────────────────────────────

  const updateIteration = useCallback((idx: number, patch: Partial<IterationRow>) => {
    setIterations(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, ...patch };
      // Clear generate-only fields for swiss.
      if (updated.agentType === 'swiss') {
        delete updated.maxAgents;
        delete updated.sourceMode;
        delete updated.qualityCutoffMode;
        delete updated.qualityCutoffValue;
        delete updated.tacticGuidance;
      }
      // Clear cutoff fields when sourceMode isn't pool.
      if (updated.sourceMode !== 'pool') {
        delete updated.qualityCutoffMode;
        delete updated.qualityCutoffValue;
      }
      return updated;
    }));
  }, []);

  const addIteration = useCallback(() => {
    setIterations(prev => [...prev, { agentType: 'generate', budgetPercent: 0, maxAgents: DEFAULT_MAX_AGENTS }]);
  }, []);

  const removeIteration = useCallback((idx: number) => {
    setIterations(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const splitEvenly = useCallback(() => {
    setIterations(prev => {
      const count = prev.length;
      if (count === 0) return prev;
      const each = Math.floor(100 / count);
      const remainder = 100 - each * count;
      return prev.map((it, i) => ({
        ...it,
        budgetPercent: each + (i === 0 ? remainder : 0),
      }));
    });
  }, []);

  // ─── Submit ─────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (iterationErrors.length > 0 || configErrors.length > 0) return;
    setSubmitting(true);
    try {
      const budgetFloorFields: Record<string, number | undefined> = {};
      const pVal = form.parallelFloorValue ? parseFloat(form.parallelFloorValue) : undefined;
      const sVal = form.sequentialFloorValue ? parseFloat(form.sequentialFloorValue) : undefined;
      if (form.budgetFloorMode === 'fraction') {
        budgetFloorFields.minBudgetAfterParallelFraction = pVal;
        budgetFloorFields.minBudgetAfterSequentialFraction = sVal;
      } else {
        budgetFloorFields.minBudgetAfterParallelAgentMultiple = pVal;
        budgetFloorFields.minBudgetAfterSequentialAgentMultiple = sVal;
      }

      const result = await createStrategyAction({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        generationModel: form.generationModel,
        judgeModel: form.judgeModel,
        budgetUsd: parseFloat(form.budgetUsd),
        iterationConfigs: iterations.map(it => ({
          agentType: it.agentType,
          budgetPercent: it.budgetPercent,
          ...(it.maxAgents != null && it.agentType === 'generate' ? { maxAgents: it.maxAgents } : {}),
          ...(it.agentType === 'generate' && it.sourceMode ? { sourceMode: it.sourceMode } : {}),
          ...(it.agentType === 'generate' && it.sourceMode === 'pool'
              && it.qualityCutoffMode && it.qualityCutoffValue != null && it.qualityCutoffValue > 0
            ? { qualityCutoff: { mode: it.qualityCutoffMode, value: it.qualityCutoffValue } }
            : {}),
          ...(it.agentType === 'generate' && it.tacticGuidance && it.tacticGuidance.length > 0
            ? { generationGuidance: it.tacticGuidance.filter(g => g.percent > 0) }
            : {}),
        })),
        maxComparisonsPerVariant: form.maxComparisonsPerVariant ? Number(form.maxComparisonsPerVariant) : undefined,
        generationTemperature: form.generationTemperature ? Number(form.generationTemperature) : undefined,
        ...budgetFloorFields,
      });

      if (!result.success) throw new Error(result.error?.message ?? 'Create failed');
      toast.success(`Strategy "${form.name}" created`);
      router.push(`/admin/evolution/strategies/${result.data!.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render helpers ─────────────────────────────────────────

  const baseInputClasses = 'w-full px-3 py-2 text-sm font-ui bg-[var(--surface-primary)] rounded-page text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-gold)] focus:outline-none';
  const inputCls = (hasError?: boolean) => `${baseInputClasses} border ${hasError ? 'border-[var(--status-error)]' : 'border-[var(--border-default)]'}`;
  const labelClasses = 'block text-sm font-ui font-medium text-[var(--text-secondary)] mb-1';

  const currentIdx = STEPS.indexOf(step);

  return (
    <div className="max-w-3xl mx-auto">
      <Card className="bg-[var(--surface-secondary)] paper-texture">
        <CardHeader>
          <CardTitle className="text-xl font-display text-[var(--text-primary)]">
            New Strategy
          </CardTitle>
          {/* Progress bar */}
          <div className="flex gap-1 mt-2">
            {STEPS.map((s, i) => {
              const isCompleted = i < currentIdx;
              return (
                <div key={s} className="flex-1 text-center">
                  <div
                    className={`h-1 rounded-full transition-colors ${
                      i <= currentIdx ? 'bg-[var(--accent-gold)]' : 'bg-[var(--border-default)]'
                    }`}
                  />
                  <span
                    className={`text-xs font-ui mt-0.5 block ${
                      i <= currentIdx ? 'text-[var(--accent-gold)]' : 'text-[var(--text-muted)]'
                    } ${isCompleted ? 'cursor-pointer hover:underline' : ''}`}
                    role={isCompleted ? 'button' : undefined}
                    tabIndex={isCompleted ? 0 : undefined}
                    onClick={isCompleted ? () => setStep(s) : undefined}
                    onKeyDown={isCompleted ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStep(s); } } : undefined}
                  >
                    {isCompleted ? '\u2713' : i === currentIdx ? '\u25CF' : '\u25CB'} {STEP_LABELS[s]}
                  </span>
                </div>
              );
            })}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* ── Step 1: Strategy Config ─────────────────────────── */}
          {step === 'config' && (
            <>
              <div>
                <label htmlFor="strategy-name" className={labelClasses}>Name</label>
                <input
                  id="strategy-name"
                  type="text"
                  value={form.name}
                  onChange={e => updateForm({ name: e.target.value })}
                  placeholder="Strategy name"
                  className={inputCls(configSubmitted && !form.name.trim())}
                />
                {configSubmitted && !form.name.trim() && (
                  <p className="text-xs font-body text-[var(--status-error)] mt-0.5">Name is required</p>
                )}
              </div>

              <div>
                <label htmlFor="strategy-description" className={labelClasses}>Description</label>
                <textarea
                  id="strategy-description"
                  value={form.description}
                  onChange={e => updateForm({ description: e.target.value })}
                  placeholder="Optional description"
                  rows={3}
                  className={inputCls()}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="generation-model" className={labelClasses}>Generation Model</label>
                  <select
                    id="generation-model"
                    value={form.generationModel}
                    onChange={e => updateForm({ generationModel: e.target.value })}
                    className={inputCls(configSubmitted && !form.generationModel)}
                  >
                    <option value="">Select a model...</option>
                    {MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="judge-model" className={labelClasses}>Judge Model</label>
                  <select
                    id="judge-model"
                    value={form.judgeModel}
                    onChange={e => updateForm({ judgeModel: e.target.value })}
                    className={inputCls(configSubmitted && !form.judgeModel)}
                  >
                    <option value="">Select a model...</option>
                    {MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="generation-temperature" className={labelClasses}>Generation Temperature (0-2)</label>
                  <input
                    id="generation-temperature"
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={form.generationTemperature}
                    onChange={e => updateForm({ generationTemperature: e.target.value })}
                    placeholder="Provider default"
                    className={inputCls()}
                  />
                </div>
                <div>
                  <label htmlFor="budget-usd" className={labelClasses}>Total Budget (USD)</label>
                  <input
                    id="budget-usd"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="100"
                    value={form.budgetUsd}
                    onChange={e => updateForm({ budgetUsd: e.target.value })}
                    className={inputCls()}
                  />
                </div>
              </div>

              {/* Advanced section */}
              <details
                open={showAdvanced}
                onToggle={e => setShowAdvanced((e.target as HTMLDetailsElement).open)}
              >
                <summary className="text-sm font-ui font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-secondary)]">
                  Advanced Settings
                </summary>
                <div className="mt-3 space-y-4 pl-2 border-l-2 border-[var(--border-default)]">
                  <div>
                    <label htmlFor="max-comparisons" className={labelClasses}>Max Comparisons per Variant</label>
                    <input
                      id="max-comparisons"
                      type="number"
                      min="1"
                      max="100"
                      value={form.maxComparisonsPerVariant}
                      onChange={e => updateForm({ maxComparisonsPerVariant: e.target.value })}
                      placeholder="5 (default)"
                      className={inputCls()}
                    />
                  </div>

                  <div>
                    <label className={labelClasses}>Budget Floor Mode</label>
                    <select
                      value={form.budgetFloorMode}
                      onChange={e => updateForm({
                        budgetFloorMode: e.target.value as BudgetFloorMode,
                        parallelFloorValue: '',
                        sequentialFloorValue: '',
                      })}
                      className={inputCls()}
                    >
                      <option value="fraction">Fraction of budget</option>
                      <option value="agentMultiple">Multiple of agent cost</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="parallel-floor" className={labelClasses}>
                        Parallel Floor {form.budgetFloorMode === 'fraction' ? '(0-1)' : '(>= 0)'}
                      </label>
                      <input
                        id="parallel-floor"
                        type="number"
                        step={form.budgetFloorMode === 'fraction' ? '0.05' : '0.5'}
                        min="0"
                        max={form.budgetFloorMode === 'fraction' ? '1' : undefined}
                        value={form.parallelFloorValue}
                        onChange={e => updateForm({ parallelFloorValue: e.target.value })}
                        placeholder="Not set"
                        className={inputCls()}
                      />
                    </div>
                    <div>
                      <label htmlFor="sequential-floor" className={labelClasses}>
                        Sequential Floor {form.budgetFloorMode === 'fraction' ? '(0-1)' : '(>= 0)'}
                      </label>
                      <input
                        id="sequential-floor"
                        type="number"
                        step={form.budgetFloorMode === 'fraction' ? '0.05' : '0.5'}
                        min="0"
                        max={form.budgetFloorMode === 'fraction' ? '1' : undefined}
                        value={form.sequentialFloorValue}
                        onChange={e => updateForm({ sequentialFloorValue: e.target.value })}
                        placeholder="Not set"
                        className={inputCls()}
                      />
                    </div>
                  </div>
                </div>
              </details>

              {configSubmitted && configErrors.length > 0 && (
                <div role="alert" aria-live="polite" className="rounded-book bg-[var(--status-error)]/10 p-2 font-ui text-sm text-[var(--status-error)]">
                  {configErrors.join('. ')}
                </div>
              )}

              <button
                onClick={() => {
                  setConfigSubmitted(true);
                  if (configErrors.length === 0) setStep('iterations');
                }}
                className="w-full py-2.5 font-ui text-sm font-medium bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 transition-opacity"
              >
                Next: Configure Iterations
              </button>
            </>
          )}

          {/* ── Step 2: Iterations + Submit ─────────────────────── */}
          {step === 'iterations' && (
            <>
              {/* Reference header */}
              <div className="rounded-page bg-[var(--surface-elevated)] p-3 space-y-1">
                <div className="flex justify-between text-xs font-ui text-[var(--text-muted)]">
                  <span>Total Budget</span>
                  <span className="font-mono text-[var(--accent-gold)]">${totalBudget.toFixed(2)}</span>
                </div>
                {(form.parallelFloorValue || form.sequentialFloorValue) && (
                  <div className="flex justify-between text-xs font-ui text-[var(--text-muted)]">
                    <span>Floor Mode</span>
                    <span className="font-mono">{form.budgetFloorMode === 'fraction' ? 'Fraction' : 'Agent Multiple'}</span>
                  </div>
                )}
                {form.parallelFloorValue && (
                  <div className="flex justify-between text-xs font-ui text-[var(--text-muted)]">
                    <span>Parallel Floor</span>
                    <span className="font-mono">{form.parallelFloorValue}</span>
                  </div>
                )}
                {form.sequentialFloorValue && (
                  <div className="flex justify-between text-xs font-ui text-[var(--text-muted)]">
                    <span>Sequential Floor</span>
                    <span className="font-mono">{form.sequentialFloorValue}</span>
                  </div>
                )}
              </div>

              {/* Iteration list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-ui font-medium text-[var(--text-secondary)]">Iterations</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={splitEvenly}
                      className="px-3 py-1 text-xs font-ui text-[var(--accent-gold)] border border-[var(--accent-gold)] rounded-page hover:bg-[var(--accent-gold)]/10 transition-colors"
                    >
                      Split Evenly
                    </button>
                    <button
                      type="button"
                      onClick={addIteration}
                      disabled={iterations.length >= 20}
                      className="px-3 py-1 text-xs font-ui text-[var(--accent-gold)] border border-[var(--accent-gold)] rounded-page hover:bg-[var(--accent-gold)]/10 disabled:opacity-40 transition-colors"
                    >
                      + Add Iteration
                    </button>
                  </div>
                </div>

                {iterations.map((it, idx) => {
                  const dollarAmount = totalBudget * (it.budgetPercent / 100);
                  return (
                    <div
                      key={idx}
                      className="p-3 rounded-page border border-[var(--border-default)] bg-[var(--surface-primary)]"
                    >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[var(--text-muted)] w-6 text-center shrink-0">
                        #{idx + 1}
                      </span>

                      <select
                        value={it.agentType}
                        onChange={e => updateIteration(idx, { agentType: e.target.value as 'generate' | 'swiss' })}
                        disabled={idx === 0}
                        className="w-28 shrink-0 px-2 py-1.5 text-xs font-ui bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none disabled:opacity-60"
                        title={idx === 0 ? 'First iteration must be generate' : undefined}
                      >
                        <option value="generate">Generate</option>
                        <option value="swiss">Swiss</option>
                      </select>

                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={it.budgetPercent}
                          onChange={e => updateIteration(idx, { budgetPercent: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
                          className="w-16 px-2 py-1.5 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                        />
                        <span className="text-xs font-ui text-[var(--text-muted)]">%</span>
                      </div>

                      <span className="text-xs font-mono text-[var(--text-muted)] w-16 text-right shrink-0">
                        = ${dollarAmount.toFixed(2)}
                      </span>

                      {it.agentType === 'generate' && (
                        <div className="flex items-center gap-1 ml-2">
                          <span className="text-xs font-ui text-[var(--text-muted)]">Agents:</span>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={it.maxAgents ?? ''}
                            onChange={e => {
                              const val = e.target.value ? parseInt(e.target.value) : undefined;
                              updateIteration(idx, { maxAgents: val });
                            }}
                            placeholder="auto"
                            className="w-14 px-2 py-1.5 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          />
                        </div>
                      )}

                      {/* Dispatch preview — recalculates on budget, percent, maxAgents, or floor changes */}
                      {it.agentType === 'generate' && dispatchEstimates[idx] && (() => {
                        const est = dispatchEstimates[idx]!;
                        const constraint = est.floorConstrained
                          ? 'budget floor limits parallel dispatch'
                          : est.maxAgentsCapped
                            ? `capped by max agents (${it.maxAgents})`
                            : null;
                        return (
                          <span
                            className={`text-xs font-ui ml-2 shrink-0 ${est.floorConstrained ? 'text-[var(--status-warning)]' : 'text-[var(--text-muted)]'}`}
                            data-testid={`dispatch-preview-${idx}`}
                            title={`$${est.iterBudget.toFixed(2)} iteration budget · $${est.estPerAgent.toFixed(2)}/agent est. · ${est.parallel} parallel${est.sequential > 0 ? ` + ${est.sequential} sequential` : ''}${constraint ? ` · ${constraint}` : ''}`}
                          >
                            {est.parallel} parallel{est.sequential > 0 ? ` + ${est.sequential} sequential` : ''}
                            {est.floorConstrained && ' ⚠'}
                          </span>
                        );
                      })()}

                      <button
                        type="button"
                        onClick={() => removeIteration(idx)}
                        disabled={iterations.length <= 1}
                        className="ml-auto text-xs font-ui text-[var(--status-error)] hover:underline disabled:opacity-30 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                    {it.agentType === 'generate' && idx > 0 && (
                      <div
                        className="mt-2 pl-8 flex flex-wrap items-center gap-2 text-xs font-ui"
                        data-testid={`iteration-source-controls-${idx}`}
                      >
                        <span className="text-[var(--text-muted)]">Source:</span>
                        <select
                          value={it.sourceMode ?? 'seed'}
                          onChange={e => updateIteration(idx, { sourceMode: e.target.value as 'seed' | 'pool' })}
                          className="px-2 py-1 text-xs font-ui bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`source-mode-select-${idx}`}
                        >
                          <option value="seed">Seed article</option>
                          <option value="pool">This run&apos;s top variants</option>
                        </select>
                        {it.sourceMode === 'pool' && (
                          <>
                            <span className="ml-2 text-[var(--text-muted)]">Take top</span>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              step={1}
                              value={it.qualityCutoffValue ?? ''}
                              onChange={e => {
                                const v = e.target.value ? Number(e.target.value) : undefined;
                                updateIteration(idx, { qualityCutoffValue: v });
                              }}
                              placeholder="5"
                              className="w-16 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                              data-testid={`cutoff-value-${idx}`}
                            />
                            <select
                              value={it.qualityCutoffMode ?? 'topN'}
                              onChange={e => updateIteration(idx, { qualityCutoffMode: e.target.value as 'topN' | 'topPercent' })}
                              className="px-2 py-1 text-xs font-ui bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
                              data-testid={`cutoff-mode-${idx}`}
                            >
                              <option value="topN">variants</option>
                              <option value="topPercent">%</option>
                            </select>
                            <span className="text-[var(--text-muted)]" title="When to use pool-sourcing">
                              &nbsp;· picks a random parent from the top of the run&apos;s ranked pool
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    {/* Tactic guidance button + inline editor */}
                    {it.agentType === 'generate' && (
                      <div className="mt-2 pl-8">
                        <button
                          type="button"
                          onClick={() => setTacticEditorIdx(tacticEditorIdx === idx ? null : idx)}
                          className="text-xs font-ui text-[var(--accent-gold)] hover:underline flex items-center gap-1"
                          data-testid={`tactic-guidance-btn-${idx}`}
                        >
                          ⚔️ Tactics{it.tacticGuidance && it.tacticGuidance.length > 0 ? ' ✓' : ''}
                        </button>
                        {it.tacticGuidance && it.tacticGuidance.length > 0 && tacticEditorIdx !== idx && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {it.tacticGuidance.map(g => (
                              <span key={g.tactic} className="text-xs font-mono text-[var(--text-muted)] px-1 py-0.5 rounded bg-[var(--surface-primary)] border border-[var(--border-default)]">
                                <span className="inline-block w-1.5 h-1.5 rounded-full mr-0.5" style={{ backgroundColor: TACTIC_PALETTE[g.tactic] ?? '#888' }} />
                                {g.tactic}: {g.percent}%
                              </span>
                            ))}
                          </div>
                        )}
                        {tacticEditorIdx === idx && (
                          <TacticGuidanceEditor
                            guidance={it.tacticGuidance ?? []}
                            onChange={g => updateIteration(idx, { tacticGuidance: g.length > 0 ? g : undefined })}
                            onClose={() => setTacticEditorIdx(null)}
                          />
                        )}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>

              {/* Allocation bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs font-ui">
                  <span className="text-[var(--text-muted)]">Budget Allocation</span>
                  <span className={`font-mono font-semibold ${percentValid ? 'text-[var(--status-success)]' : 'text-[var(--status-error)]'}`}>
                    {totalPercent.toFixed(0)}% / 100% = ${totalBudget.toFixed(2)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--surface-primary)] border border-[var(--border-default)] overflow-hidden">
                  <div className="flex h-full">
                    {iterations.map((it, idx) => (
                      <div
                        key={idx}
                        className={`h-full transition-all ${
                          it.agentType === 'generate'
                            ? 'bg-[var(--accent-gold)]'
                            : 'bg-[var(--accent-copper)]'
                        }`}
                        style={{ width: `${Math.min(it.budgetPercent, 100)}%` }}
                        title={`#${idx + 1} ${it.agentType}: ${it.budgetPercent}%`}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 text-xs font-ui text-[var(--text-muted)]">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent-gold)]" /> Generate
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent-copper)]" /> Swiss
                  </span>
                </div>
              </div>

              {iterationErrors.length > 0 && (
                <div role="alert" aria-live="polite" className="rounded-book bg-[var(--status-error)]/10 p-2 font-ui text-sm text-[var(--status-error)]">
                  {iterationErrors.join('. ')}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('config')}
                  className="flex-1 py-2.5 font-ui text-sm font-medium border border-[var(--border-default)] text-[var(--text-secondary)] rounded-page hover:bg-[var(--surface-elevated)] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || iterationErrors.length > 0}
                  className="flex-1 py-2.5 font-ui text-sm font-medium bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-[var(--surface-primary)] border-t-transparent rounded-full animate-spin" />
                      Creating...
                    </span>
                  ) : (
                    'Create Strategy'
                  )}
                </button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
