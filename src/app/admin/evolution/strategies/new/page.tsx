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
import {
  getLastUsedPromptAction,
  getStrategyDispatchPreviewAction,
} from '@evolution/services/strategyPreviewActions';
import type { LastUsedPromptResult, IterationPlanEntryClient } from '@evolution/services/strategyPreviewActions';

// Mirrors DEFAULT_SEED_CHARS in evolution/src/lib/pipeline/loop/projectDispatchPlan.ts.
// Inlined here because a `"use server"` file (strategyPreviewActions) can only export
// async functions — it cannot re-export the constant for client-side consumption.
const DEFAULT_SEED_CHARS = 8000;
import { TACTICS_BY_CATEGORY, TACTIC_PALETTE } from '@evolution/lib/core/tactics';
import { DispatchPlanView } from '@evolution/components/evolution/DispatchPlanView';

// ─── Types ──────────────────────────────────────────────────────

type Step = 'config' | 'iterations';
const STEPS: Step[] = ['config', 'iterations'];
const STEP_LABELS: Record<Step, string> = { config: 'Strategy Config', iterations: 'Iterations + Submit' };

type BudgetFloorMode = 'fraction' | 'agentMultiple';

interface IterationRow {
  agentType: 'generate' | 'reflect_and_generate' | 'iterative_editing' | 'swiss';
  budgetPercent: number;
  /** Phase 2: parent-article source for generate iterations. Undefined for swiss/editing.
   *  First iteration is locked to 'seed' by schema refine. */
  sourceMode?: 'seed' | 'pool';
  /** Phase 2: quality cutoff for pool-mode. Initialized to 'topN'/5 when sourceMode
   *  transitions to 'pool' (see updateIteration) so Zod validation always passes. */
  qualityCutoffMode?: 'topN' | 'topPercent';
  qualityCutoffValue?: number;
  /** Per-iteration tactic guidance. Overrides strategy-level for this iteration. */
  tacticGuidance?: Array<{ tactic: string; percent: number }>;
  /** Top N tactics the reflection LLM ranks (1-10, default 3). Only valid when
   *  agentType === 'reflect_and_generate'. */
  reflectionTopN?: number;
  /** Number of propose-review-apply cycles per parent (1-5, default 3). Only
   *  valid when agentType === 'iterative_editing'. */
  editingMaxCycles?: number;
  /** Eligibility cutoff for editing — caps how many top-Elo variants are eligible
   *  per iteration. Default {topN: 10}. Only valid when agentType === 'iterative_editing'. */
  editingCutoffMode?: 'topN' | 'topPercent';
  editingCutoffValue?: number;
}

// Default cutoff applied when user switches a generate iteration to sourceMode='pool'.
// Matches the "top X articles" language; topN=5 is a sensible middle ground.
const POOL_DEFAULT_CUTOFF_MODE = 'topN' as const;
const POOL_DEFAULT_CUTOFF_VALUE = 5;

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

const DEFAULT_ITERATIONS: IterationRow[] = [
  { agentType: 'generate', budgetPercent: 60, sourceMode: 'seed' },
  { agentType: 'swiss', budgetPercent: 40 },
];

// ─── Form → payload helpers ─────────────────────────────────────

interface IterationConfigPayload {
  agentType: 'generate' | 'reflect_and_generate' | 'iterative_editing' | 'swiss';
  budgetPercent: number;
  sourceMode?: 'seed' | 'pool';
  qualityCutoff?: { mode: 'topN' | 'topPercent'; value: number };
  generationGuidance?: Array<{ tactic: string; percent: number }>;
  reflectionTopN?: number;
  editingMaxCycles?: number;
  editingEligibilityCutoff?: { mode: 'topN' | 'topPercent'; value: number };
}

/** Agent types that take parent-article source machinery (sourceMode, qualityCutoff).
 *  This is generate / reflect_and_generate ONLY — editing has its own per-cycle parent-
 *  selection mechanism (editingEligibilityCutoff), and swiss has none. */
function isVariantProducing(agentType: IterationRow['agentType']): agentType is 'generate' | 'reflect_and_generate' {
  return agentType === 'generate' || agentType === 'reflect_and_generate';
}

/** Agent types eligible to be the FIRST iteration (must produce variants on an
 *  empty pool). Editing requires existing variants; swiss only re-ranks. */
function canBeFirstIteration(agentType: IterationRow['agentType']): boolean {
  return agentType === 'generate' || agentType === 'reflect_and_generate';
}

/** Map UI iteration rows to the iterationConfigs payload accepted by the server
 *  actions (createStrategyAction + getStrategyDispatchPreviewAction). Drops
 *  variant-only fields for swiss rows; drops tacticGuidance for reflect_and_generate
 *  (the reflection LLM picks the tactic, mutex enforced by schema).
 *
 *  Invariant: when `sourceMode === 'pool'`, updateIteration guarantees
 *  `qualityCutoffMode` and `qualityCutoffValue` are both defined, so qualityCutoff
 *  is always emitted for pool iterations. */
function toIterationConfigsPayload(iterations: IterationRow[]): IterationConfigPayload[] {
  return iterations.map((it) => ({
    agentType: it.agentType,
    budgetPercent: it.budgetPercent,
    ...(isVariantProducing(it.agentType) && it.sourceMode ? { sourceMode: it.sourceMode } : {}),
    ...(isVariantProducing(it.agentType) && it.sourceMode === 'pool'
        && it.qualityCutoffMode && it.qualityCutoffValue != null && it.qualityCutoffValue > 0
      ? { qualityCutoff: { mode: it.qualityCutoffMode, value: it.qualityCutoffValue } }
      : {}),
    // Tactic guidance is generate-only — reflect_and_generate has its own tactic
    // selection (the reflection LLM picks among all 24); the schema rejects guidance
    // on reflect_and_generate iterations.
    ...(it.agentType === 'generate'
        && it.tacticGuidance && it.tacticGuidance.length > 0
      ? { generationGuidance: it.tacticGuidance.filter((g) => g.percent > 0) }
      : {}),
    // reflectionTopN only meaningful for reflect_and_generate iterations.
    ...(it.agentType === 'reflect_and_generate'
      ? { reflectionTopN: it.reflectionTopN ?? 3 }
      : {}),
    // Editing-only fields.
    ...(it.agentType === 'iterative_editing' && it.editingMaxCycles != null
      ? { editingMaxCycles: it.editingMaxCycles }
      : {}),
    ...(it.agentType === 'iterative_editing' && it.editingCutoffMode && it.editingCutoffValue != null
      ? { editingEligibilityCutoff: { mode: it.editingCutoffMode, value: it.editingCutoffValue } }
      : {}),
  }));
}

/** Resolve parallel + sequential floor values into the correct Fraction vs
 *  AgentMultiple fields based on the active floor mode. */
function toBudgetFloorFields(
  mode: BudgetFloorMode,
  parallelRaw: string,
  sequentialRaw: string,
): Record<string, number | undefined> {
  const pVal = parallelRaw ? parseFloat(parallelRaw) : undefined;
  const sVal = sequentialRaw ? parseFloat(sequentialRaw) : undefined;
  if (mode === 'fraction') {
    return {
      minBudgetAfterParallelFraction: pVal,
      minBudgetAfterSequentialFraction: sVal,
    };
  }
  return {
    minBudgetAfterParallelAgentMultiple: pVal,
    minBudgetAfterSequentialAgentMultiple: sVal,
  };
}

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

  // Phase 3: smart-default prompt context. On mount, fetch the last-used prompt from any
  // non-test-content run. Strategies aren't prompt-bound; the promptId just gives the
  // preview an accurate arena count instead of assuming empty.
  const [lastUsedPrompt, setLastUsedPrompt] = useState<LastUsedPromptResult | null>(null);
  // Dispatch plan + its inputs. Refreshed via getStrategyDispatchPreviewAction below
  // whenever config or prompt changes (debounced + AbortController).
  const [dispatchPlan, setDispatchPlan] = useState<IterationPlanEntryClient[] | null>(null);
  const [arenaCount, setArenaCount] = useState<number>(0);
  const [seedArticleChars, setSeedArticleChars] = useState<number>(DEFAULT_SEED_CHARS);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => { document.title = 'New Strategy | Evolution'; }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getLastUsedPromptAction();
      if (cancelled) return;
      if (res.success && res.data) setLastUsedPrompt(res.data);
    })();
    return () => { cancelled = true; };
  }, []);

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

  // Dispatch preview via server action (Phase 3 full implementation).
  // Debounced 300ms; AbortController cancels stale requests so rapid form edits don't
  // land out-of-order. Replaces the previous inline estimateAgentCost memo.
  useEffect(() => {
    if (!form.generationModel || !form.judgeModel || iterations.length === 0) {
      setDispatchPlan(null);
      return;
    }
    const budget = parseFloat(form.budgetUsd);
    if (!Number.isFinite(budget) || budget <= 0) {
      setDispatchPlan(null);
      return;
    }
    if (Math.abs(totalPercent - 100) >= 0.01) {
      // Don't fire preview until percentages sum to 100 — prevents server-action validation errors.
      return;
    }

    const floorFields = toBudgetFloorFields(form.budgetFloorMode, form.parallelFloorValue, form.sequentialFloorValue);
    const maxComp = form.maxComparisonsPerVariant ? parseInt(form.maxComparisonsPerVariant) : undefined;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (controller.signal.aborted) return;
      setPreviewLoading(true);
      try {
        const res = await getStrategyDispatchPreviewAction({
          config: {
            generationModel: form.generationModel,
            judgeModel: form.judgeModel,
            budgetUsd: budget,
            maxComparisonsPerVariant: maxComp,
            iterationConfigs: toIterationConfigsPayload(iterations),
            ...floorFields,
          },
          promptId: lastUsedPrompt?.id,
          seedArticleChars,
        });
        if (controller.signal.aborted) return;
        if (res.success && res.data) {
          setDispatchPlan(res.data.plan);
          setArenaCount(res.data.arenaCount);
        } else {
          setDispatchPlan(null);
        }
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [
    form.generationModel, form.judgeModel, form.budgetUsd, form.maxComparisonsPerVariant,
    form.parallelFloorValue, form.sequentialFloorValue, form.budgetFloorMode,
    iterations, lastUsedPrompt, seedArticleChars, totalPercent,
  ]);

  const iterationErrors = useMemo(() => {
    const errors: string[] = [];
    if (iterations.length === 0) errors.push('At least one iteration is required');
    if (iterations.length > 0 && !canBeFirstIteration(iterations[0]!.agentType)) {
      errors.push('First iteration must be generate or reflect_and_generate');
    }
    if (!percentValid) errors.push(`Budget percentages must sum to 100% (currently ${totalPercent.toFixed(1)}%)`);
    // Check swiss doesn't precede all variant-producing iterations
    let hasVariantProducing = false;
    for (const it of iterations) {
      if (isVariantProducing(it.agentType)) hasVariantProducing = true;
      if (it.agentType === 'swiss' && !hasVariantProducing) {
        errors.push('Swiss iteration cannot precede all generate / reflect_and_generate iterations');
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
      // Clear variant-only fields for swiss.
      if (updated.agentType === 'swiss') {
        delete updated.sourceMode;
        delete updated.qualityCutoffMode;
        delete updated.qualityCutoffValue;
        delete updated.tacticGuidance;
        delete updated.reflectionTopN;
        return updated;
      }
      // Shape A: tacticGuidance is generate-only. Switching to reflect_and_generate
      // (or starting there) clears any guidance so the schema mutex stays satisfied.
      // The reflection LLM picks the tactic — guidance would be ignored anyway.
      if (updated.agentType === 'reflect_and_generate') {
        delete updated.tacticGuidance;
        // Default reflectionTopN when entering reflect_and_generate without one set.
        updated.reflectionTopN ??= 3;
      } else {
        // generate: drop reflectionTopN (stale value from a prior reflect_and_generate
        // selection — re-entering reflect_and_generate will re-default).
        delete updated.reflectionTopN;
      }
      // Variant-producing: ensure sourceMode is always set so payload emission is deterministic.
      updated.sourceMode ??= 'seed';
      // Pool mode: initialize cutoff fields if unset. This is the Bug 1 fix — without
      // explicit state, toIterationConfigsPayload dropped qualityCutoff entirely when
      // qualityCutoffMode stayed undefined (render-time `?? 'topN'` was display-only).
      if (updated.sourceMode === 'pool') {
        updated.qualityCutoffMode ??= POOL_DEFAULT_CUTOFF_MODE;
        updated.qualityCutoffValue ??= POOL_DEFAULT_CUTOFF_VALUE;
      } else {
        // Seed mode: clear cutoff fields so re-toggling to pool picks up the defaults.
        delete updated.qualityCutoffMode;
        delete updated.qualityCutoffValue;
      }
      return updated;
    }));
  }, []);

  const addIteration = useCallback(() => {
    setIterations(prev => [...prev, { agentType: 'generate', budgetPercent: 0, sourceMode: 'seed' }]);
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
      const budgetFloorFields = toBudgetFloorFields(form.budgetFloorMode, form.parallelFloorValue, form.sequentialFloorValue);

      const result = await createStrategyAction({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        generationModel: form.generationModel,
        judgeModel: form.judgeModel,
        budgetUsd: parseFloat(form.budgetUsd),
        iterationConfigs: toIterationConfigsPayload(iterations),
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

                {/* Phase 3: smart-default prompt context + editable seed-chars override. */}
                <div
                  className="p-2 rounded-page bg-[var(--surface-base)] border border-[var(--border-subtle)] text-xs font-ui text-[var(--text-muted)] flex flex-wrap gap-2 items-center"
                  data-testid="wizard-prompt-context"
                >
                  <span>
                    {lastUsedPrompt ? (
                      <>
                        Preview uses prompt <span className="text-[var(--text-primary)]">{lastUsedPrompt.name}</span>{' '}
                        (arena size: <span className="font-mono text-[var(--text-primary)]">{arenaCount}</span>).
                      </>
                    ) : (
                      <>Preview assumes empty arena (no qualifying past runs).</>
                    )}
                  </span>
                  <span className="inline-flex items-center gap-1 ml-auto">
                    <span>Seed chars:</span>
                    <input
                      type="number"
                      min={100}
                      max={100000}
                      step={500}
                      value={seedArticleChars}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (Number.isFinite(v) && v >= 100) setSeedArticleChars(v);
                      }}
                      className="w-20 px-1.5 py-0.5 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                      data-testid="wizard-seed-chars"
                    />
                  </span>
                </div>

                {/* Phase 6b: shared DispatchPlanView renders the full per-iteration plan. */}
                {dispatchPlan && dispatchPlan.length > 0 && (
                  <div className="p-2 rounded-page bg-[var(--surface-base)] border border-[var(--border-subtle)]">
                    <DispatchPlanView
                      plan={dispatchPlan}
                      variant="wizard"
                      totalBudgetUsd={totalBudget}
                    />
                    {previewLoading && (
                      <p className="text-xs font-ui text-[var(--text-muted)] italic mt-1">Updating preview…</p>
                    )}
                  </div>
                )}

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
                        onChange={e => updateIteration(idx, { agentType: e.target.value as IterationRow['agentType'] })}
                        className="w-44 shrink-0 px-2 py-1.5 text-xs font-ui bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
                        data-testid={`agent-type-select-${idx}`}
                      >
                        <option value="generate">Generate</option>
                        <option value="reflect_and_generate">Reflect &amp; Generate</option>
                        <option value="iterative_editing" disabled={idx === 0} title={idx === 0 ? 'First iteration must produce variants' : undefined}>Iterative Editing</option>
                        <option value="swiss" disabled={idx === 0} title={idx === 0 ? 'First iteration must produce variants' : undefined}>Swiss</option>
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

                      {/* Per-row dispatch preview removed in Phase 6 — now consolidated into the
                          DispatchPlanView component rendered below the iteration list. */}

                      <button
                        type="button"
                        onClick={() => removeIteration(idx)}
                        disabled={iterations.length <= 1}
                        className="ml-auto text-xs font-ui text-[var(--status-error)] hover:underline disabled:opacity-30 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                    {isVariantProducing(it.agentType) && idx > 0 && (
                      <div
                        className="mt-2 pl-8 flex flex-wrap items-center gap-2 text-xs font-ui"
                        data-testid={`iteration-source-controls-${idx}`}
                      >
                        <span className="text-[var(--text-muted)]">Source:</span>
                        {/* `?? 'seed'` / `?? 'topN'` / `?? ''` below are defensive: updateIteration
                            guarantees these fields exist on every generate row, but the fallbacks
                            keep the controls controlled under TS's optional-field typing. */}
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
                    {/* Tactic guidance button + inline editor — generate-only.
                        reflect_and_generate has no tactic guidance UI: the reflection LLM
                        picks the tactic per call, so guidance would be ignored. */}
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
                    {/* Shape A: reflect_and_generate exposes a Top-N input (1-10, default 3)
                        controlling how many tactics the reflection LLM ranks. The reflection
                        agent picks the tactic itself — no guidance UI here, no toggle. */}
                    {it.agentType === 'reflect_and_generate' && (
                      <div
                        className="mt-2 pl-8 flex flex-wrap items-center gap-2 text-xs font-ui"
                        data-testid={`iteration-reflection-controls-${idx}`}
                      >
                        <span className="text-[var(--text-primary)]">🪞 Reflection picks tactic per parent · Top-N tactics:</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          step={1}
                          value={it.reflectionTopN ?? 3}
                          onChange={e => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value);
                            updateIteration(idx, { reflectionTopN: v });
                          }}
                          className="w-14 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`reflection-topn-input-${idx}`}
                        />
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
                    {iterations.map((it, idx) => {
                      const color = it.agentType === 'generate'
                        ? 'bg-[var(--accent-gold)]'
                        : it.agentType === 'reflect_and_generate'
                          ? 'bg-amber-500'
                          : 'bg-[var(--accent-copper)]';
                      return (
                        <div
                          key={idx}
                          className={`h-full transition-all ${color}`}
                          style={{ width: `${Math.min(it.budgetPercent, 100)}%` }}
                          title={`#${idx + 1} ${it.agentType}: ${it.budgetPercent}%`}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="flex gap-3 text-xs font-ui text-[var(--text-muted)]">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[var(--accent-gold)]" /> Generate
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" /> Reflect &amp; Generate
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
