// 2-step strategy creation wizard: configure strategy settings, then define iteration sequence.
// Follows the ExperimentForm step-navigation pattern (progress bar, Back/Next).

'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MODEL_OPTIONS } from '@/lib/utils/modelOptions';
import { DEFAULT_JUDGE_MODEL, modelSupportsReasoning, MODEL_REGISTRY } from '@/config/modelRegistry';
import { createStrategyAction } from '@evolution/services/strategyRegistryActions';
import {
  getLastUsedPromptAction,
  getStrategyDispatchPreviewAction,
} from '@evolution/services/strategyPreviewActions';
import type { LastUsedPromptResult, IterationPlanEntryClient } from '@evolution/services/strategyPreviewActions';
import type { IterationAgentType } from '@evolution/lib/schemas';

// Mirrors DEFAULT_SEED_CHARS in evolution/src/lib/pipeline/loop/projectDispatchPlan.ts.
// Inlined here because a `"use server"` file (strategyPreviewActions) can only export
// async functions — it cannot re-export the constant for client-side consumption.
const DEFAULT_SEED_CHARS = 8000;
import { TACTICS_BY_CATEGORY, TACTIC_PALETTE } from '@evolution/lib/core/tactics';
import { DispatchPlanView } from '@evolution/components/evolution/DispatchPlanView';
import { listCriteriaAction, type CriteriaListItem } from '@evolution/services/criteriaActions';
import { listJudgeRubricsAction, type JudgeRubricListItem } from '@evolution/services/judgeRubricActions';
import { CriteriaMultiSelect } from './CriteriaMultiSelect';

// ─── Types ──────────────────────────────────────────────────────

type Step = 'config' | 'iterations';
const STEPS: Step[] = ['config', 'iterations'];
const STEP_LABELS: Record<Step, string> = { config: 'Strategy Config', iterations: 'Iterations + Submit' };

type BudgetFloorMode = 'fraction' | 'agentMultiple';

interface IterationRow {
  agentType: IterationAgentType;
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
   *  valid when agentType === 'iterative_editing' (or proposer_approver, fixed at 1). */
  editingMaxCycles?: number;
  /** Eligibility cutoff for editing — caps how many top-Elo variants are eligible
   *  per iteration. Default {topN: 10}. Valid for iterative_editing and
   *  proposer_approver_criteria_generate. */
  editingCutoffMode?: 'topN' | 'topPercent';
  editingCutoffValue?: number;
  /** Criteria UUIDs to evaluate. Required for all 3 criteria-based agent types. */
  criteriaIds?: string[];
  /** Number of weakest criteria to focus suggestions on (1-5). Default 1. */
  weakestK?: number;
  /** Tightened size-ratio cap for proposer/approver edits (default 1.10). Only
   *  valid when agentType === 'proposer_approver_criteria_generate'. */
  lengthCapRatio?: number;
  /** Trigram-Jaccard threshold rejecting edits whose newText overlaps too much
   *  with the rest of the article. Default 0.35. Valid for the 2 new criteria
   *  agents only. */
  redundancyJaccardThreshold?: number;
  /** When false, skips the mirror-approver pass and applies forward-accepted
   *  groups directly. Default true (run mirror). Only valid when
   *  agentType === 'proposer_approver_criteria_generate'. */
  includesMirrorApprover?: boolean;
  /** Per-iteration override for debate judge reasoning effort. Only valid when
   *  agentType === 'debate_and_generate' AND the strategy's judgeModel has
   *  supportsReasoning=true (Phase 1.14 cross-field refinement enforces both). */
  debateJudgeReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  /** rank_individual_paragraphs_evolution_20260525 — paragraph_recombine knobs.
   *  Only valid when agentType === 'paragraph_recombine'. */
  rewritesPerParagraph?: number;
  maxComparisonsPerParagraph?: number;
  maxParagraphsPerInvocation?: number;
  paragraphRewriteModel?: string;
  /** investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 — Phase 8 (L).
   *  Multi-dispatch + per-invocation cap controls. maxDispatches caps how many
   *  parallel paragraph_recombine invocations dispatch per iteration; default 1
   *  matches pre-J behavior. perInvocationCapUsd is a safety cap, not a spend
   *  target — keeps existing strategy behavior identical when unset. */
  maxDispatches?: number;
  perInvocationCapUsd?: number;
}

// Paragraph_recombine wizard defaults — match agent constants.
const PARAGRAPH_RECOMBINE_DEFAULTS = {
  rewritesPerParagraph: 3,
  maxComparisonsPerParagraph: 8,
  maxParagraphsPerInvocation: 12,
  // Phase 8 (L): multi-dispatch defaults to single-dispatch for back-compat.
  // Users opt into multi-dispatch by raising this above 1.
  maxDispatches: 1,
  // Phase 8 (L): default safety cap matches DEFAULT_PER_INVOCATION_CAP_USD in
  // ParagraphRecombineAgent.ts (Option F: 0.40 → 0.05).
  perInvocationCapUsd: 0.05,
} as const;

// Default cutoff applied when user switches a generate iteration to sourceMode='pool'.
// Matches the "top X articles" language; topN=5 is a sensible middle ground.
const POOL_DEFAULT_CUTOFF_MODE = 'topN' as const;
const POOL_DEFAULT_CUTOFF_VALUE = 5;

interface StrategyFormState {
  name: string;
  description: string;
  generationModel: string;
  judgeModel: string;
  /** Optional rubric-set id for rubric-based judging. Empty → holistic judging. */
  judgeRubricId: string;
  /** Phase 1d (Fix 5b): per-paragraph rubric-set id. Empty → hardcoded paragraph
   *  rubric. Distinct from judgeRubricId — that one applies at article level only. */
  paragraphJudgeRubricId: string;
  /** Iterative-editing Proposer model. Empty string → falls back to generationModel. */
  editingModel: string;
  /** Iterative-editing Approver model. Empty string → falls back to editingModel.
   *  When resolved value === editingModel resolved value, the wizard surfaces a
   *  rubber-stamping warning per Decisions §16. */
  approverModel: string;
  /** Phase 5 / 5a-1: which seed picks the parent originalText when the topic
   *  has multiple seeds. Empty → 'highest_elo' (pre-Phase-5 default). 'random'
   *  picks a deterministic per-run seed via SHA-256(run.id), spreading parent
   *  selection across the seed pool for canaries. */
  seedSelection: '' | 'highest_elo' | 'random';
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
  agentType: IterationAgentType;
  budgetPercent: number;
  sourceMode?: 'seed' | 'pool';
  qualityCutoff?: { mode: 'topN' | 'topPercent'; value: number };
  generationGuidance?: Array<{ tactic: string; percent: number }>;
  reflectionTopN?: number;
  editingMaxCycles?: number;
  editingEligibilityCutoff?: { mode: 'topN' | 'topPercent'; value: number };
  criteriaIds?: string[];
  weakestK?: number;
  lengthCapRatio?: number;
  redundancyJaccardThreshold?: number;
  includesMirrorApprover?: boolean;
  debateJudgeReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  rewritesPerParagraph?: number;
  maxComparisonsPerParagraph?: number;
  maxParagraphsPerInvocation?: number;
  paragraphRewriteModel?: string;
  maxDispatches?: number;
  perInvocationCapUsd?: number;
}

/** Variant-producing agent types share the same parent-article source machinery
 *  (sourceMode, qualityCutoff). Editing has its own per-cycle parent-selection
 *  mechanism (editingEligibilityCutoff); swiss has none.
 *
 *  proposer_approver_criteria_generate is also variant-producing — it runs the
 *  same resolveParent() flow in runIterationLoop.ts (sourceMode='seed' default
 *  picks the run's seed; sourceMode='pool' picks from the configured cutoff).
 *  Its own editingEligibilityCutoff is a SEPARATE layer that controls which
 *  groups inside a proposed-edit set survive the approver pass, not which
 *  parent variants get drawn from the pool. Omitting propose/approve here
 *  silently forced every wizard-created propose/approve strategy to default
 *  to sourceMode='seed' with no way to override from the UI. Phase 7 staging
 *  surfaced this — added 2026-05-09. */
function isVariantProducing(
  agentType: IterationRow['agentType'],
): agentType is 'generate' | 'reflect_and_generate' | 'criteria_and_generate' | 'single_pass_evaluate_criteria_and_generate' | 'proposer_approver_criteria_generate' | 'paragraph_recombine' {
  return agentType === 'generate'
    || agentType === 'reflect_and_generate'
    || agentType === 'criteria_and_generate'
    || agentType === 'single_pass_evaluate_criteria_and_generate'
    || agentType === 'proposer_approver_criteria_generate'
    || agentType === 'paragraph_recombine';
}

/** Agent types eligible to be the FIRST iteration (must produce variants on an
 *  empty pool). Editing requires existing variants; swiss only re-ranks.
 *  proposer_approver_criteria_generate uses an editing-style flow that needs a
 *  parent variant in the pool, so it cannot be first. */
function canBeFirstIteration(agentType: IterationRow['agentType']): boolean {
  return agentType === 'generate'
    || agentType === 'reflect_and_generate'
    || agentType === 'criteria_and_generate'
    || agentType === 'single_pass_evaluate_criteria_and_generate'
    || agentType === 'paragraph_recombine';
}

/** True for any of the 3 criteria-based agent types. Used to gate
 *  criteriaIds + weakestK controls. */
function isCriteriaBased(agentType: IterationRow['agentType']): boolean {
  return agentType === 'criteria_and_generate'
    || agentType === 'single_pass_evaluate_criteria_and_generate'
    || agentType === 'proposer_approver_criteria_generate';
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
    ...((it.agentType === 'iterative_editing' || it.agentType === 'iterative_editing_rewrite')
      && it.editingMaxCycles != null
      ? { editingMaxCycles: it.editingMaxCycles }
      : {}),
    ...((it.agentType === 'iterative_editing'
        || it.agentType === 'iterative_editing_rewrite'
        || it.agentType === 'proposer_approver_criteria_generate')
        && it.editingCutoffMode && it.editingCutoffValue != null
      ? { editingEligibilityCutoff: { mode: it.editingCutoffMode, value: it.editingCutoffValue } }
      : {}),
    // criteriaIds + weakestK valid for all 3 criteria-based agent types.
    ...(isCriteriaBased(it.agentType) && it.criteriaIds && it.criteriaIds.length > 0
      ? { criteriaIds: it.criteriaIds }
      : {}),
    ...(isCriteriaBased(it.agentType) && it.weakestK
      ? { weakestK: it.weakestK }
      : {}),
    // Proposer/approver-only fields.
    ...(it.agentType === 'proposer_approver_criteria_generate' && it.lengthCapRatio != null
      ? { lengthCapRatio: it.lengthCapRatio }
      : {}),
    // Redundancy threshold valid for the 2 new criteria agents.
    ...((it.agentType === 'single_pass_evaluate_criteria_and_generate'
        || it.agentType === 'proposer_approver_criteria_generate')
        && it.redundancyJaccardThreshold != null
      ? { redundancyJaccardThreshold: it.redundancyJaccardThreshold }
      : {}),
    // includesMirrorApprover: emit ONLY when explicitly false (default-on stays
    // implicit so the strategy hash doesn't drift on default-config strategies).
    ...(it.agentType === 'proposer_approver_criteria_generate' && it.includesMirrorApprover === false
      ? { includesMirrorApprover: false }
      : {}),
    // bring_back_debate_agent_20260506 Phase 4.6 — debate-only field.
    ...(it.agentType === 'debate_and_generate' && it.debateJudgeReasoningEffort
      ? { debateJudgeReasoningEffort: it.debateJudgeReasoningEffort }
      : {}),
    // rank_individual_paragraphs_evolution_20260525 — paragraph_recombine knobs.
    ...(it.agentType === 'paragraph_recombine' && it.rewritesPerParagraph != null
      ? { rewritesPerParagraph: it.rewritesPerParagraph }
      : {}),
    ...(it.agentType === 'paragraph_recombine' && it.maxComparisonsPerParagraph != null
      ? { maxComparisonsPerParagraph: it.maxComparisonsPerParagraph }
      : {}),
    ...(it.agentType === 'paragraph_recombine' && it.maxParagraphsPerInvocation != null
      ? { maxParagraphsPerInvocation: it.maxParagraphsPerInvocation }
      : {}),
    ...(it.agentType === 'paragraph_recombine' && it.paragraphRewriteModel
      ? { paragraphRewriteModel: it.paragraphRewriteModel }
      : {}),
    // investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 Phase 8 (L):
    // maxDispatches + perInvocationCapUsd opt-in fields. Emit only when explicitly
    // set so default-1 strategies hash identically to pre-Phase-8 wizard output
    // (canonicalizeIterationConfig also gates on `!== undefined` per J1.5).
    ...(it.agentType === 'paragraph_recombine' && it.maxDispatches != null && it.maxDispatches !== PARAGRAPH_RECOMBINE_DEFAULTS.maxDispatches
      ? { maxDispatches: it.maxDispatches }
      : {}),
    ...(it.agentType === 'paragraph_recombine' && it.perInvocationCapUsd != null && it.perInvocationCapUsd !== PARAGRAPH_RECOMBINE_DEFAULTS.perInvocationCapUsd
      ? { perInvocationCapUsd: it.perInvocationCapUsd }
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
    judgeRubricId: '',
    paragraphJudgeRubricId: '',
    editingModel: '',
    approverModel: '',
    seedSelection: '',
    generationTemperature: '',
    budgetUsd: '0.05',
    maxComparisonsPerVariant: '5',
    budgetFloorMode: 'agentMultiple',
    parallelFloorValue: '2',
    sequentialFloorValue: '',
  });

  const [iterations, setIterations] = useState<IterationRow[]>([...DEFAULT_ITERATIONS]);
  const [tacticEditorIdx, setTacticEditorIdx] = useState<number | null>(null);
  const [criteriaEditorIdx, setCriteriaEditorIdx] = useState<number | null>(null);
  const [availableCriteria, setAvailableCriteria] = useState<CriteriaListItem[]>([]);
  const [availableRubrics, setAvailableRubrics] = useState<JudgeRubricListItem[]>([]);

  // Fetch active criteria + judge rubrics once on mount.
  useEffect(() => {
    (async () => {
      const result = await listCriteriaAction({ status: 'active', filterTestContent: true, limit: 200 });
      if (result.success && result.data) setAvailableCriteria(result.data.items);
      const rubrics = await listJudgeRubricsAction({ status: 'active', filterTestContent: true, limit: 200 });
      if (rubrics.success && rubrics.data) setAvailableRubrics(rubrics.data.items);
    })();
  }, []);

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
            ...(form.editingModel ? { editingModel: form.editingModel } : {}),
            ...(form.approverModel ? { approverModel: form.approverModel } : {}),
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
      errors.push('First iteration must produce variants on an empty pool (generate, reflect_and_generate, a criteria agent, or paragraph_recombine)');
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
      // Criteria-based agents require criteriaIds (any of the 3 types).
      if (isCriteriaBased(it.agentType) && (!it.criteriaIds || it.criteriaIds.length === 0)) {
        errors.push(`Iteration ${i + 1}: criteria-based agent requires at least one selected criterion`);
      }
      if (isCriteriaBased(it.agentType) && it.weakestK && it.criteriaIds && it.weakestK > it.criteriaIds.length) {
        errors.push(`Iteration ${i + 1}: weakestK (${it.weakestK}) cannot exceed selected criteria (${it.criteriaIds.length})`);
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
        delete updated.criteriaIds;
        delete updated.weakestK;
        delete updated.lengthCapRatio;
        delete updated.redundancyJaccardThreshold;
        delete updated.includesMirrorApprover;
        delete updated.debateJudgeReasoningEffort;
        return updated;
      }
      // Debate selects parents internally; reject sourceMode + qualityCutoff per Phase 4.7.
      if (updated.agentType === 'debate_and_generate') {
        delete updated.sourceMode;
        delete updated.qualityCutoffMode;
        delete updated.qualityCutoffValue;
        delete updated.tacticGuidance;
        delete updated.reflectionTopN;
        delete updated.criteriaIds;
        delete updated.weakestK;
        delete updated.editingMaxCycles;
        delete updated.editingCutoffMode;
        delete updated.editingCutoffValue;
        delete updated.lengthCapRatio;
        delete updated.redundancyJaccardThreshold;
        delete updated.includesMirrorApprover;
        return updated;
      }
      // iterative_editing + iterative_editing_rewrite: keep editingMaxCycles + editingCutoff*; drop variant-flow fields.
      if (updated.agentType === 'iterative_editing' || updated.agentType === 'iterative_editing_rewrite') {
        delete updated.tacticGuidance;
        delete updated.reflectionTopN;
        delete updated.criteriaIds;
        delete updated.weakestK;
        delete updated.lengthCapRatio;
        delete updated.redundancyJaccardThreshold;
        delete updated.includesMirrorApprover;
      } else if (updated.agentType === 'proposer_approver_criteria_generate') {
        // Single-cycle propose/approve agent. editingMaxCycles fixed at 1.
        delete updated.tacticGuidance;
        delete updated.reflectionTopN;
        updated.criteriaIds ??= [];
        updated.weakestK ??= 1;
        updated.editingMaxCycles = 1;
        updated.editingCutoffMode ??= 'topN';
        updated.editingCutoffValue ??= 10;
        // Defaults: 1.10 length cap, 0.35 redundancy threshold, mirror on.
        updated.lengthCapRatio ??= 1.10;
        updated.redundancyJaccardThreshold ??= 0.35;
        updated.includesMirrorApprover ??= true;
      } else if (updated.agentType === 'single_pass_evaluate_criteria_and_generate') {
        delete updated.tacticGuidance;
        delete updated.reflectionTopN;
        delete updated.editingMaxCycles;
        delete updated.editingCutoffMode;
        delete updated.editingCutoffValue;
        delete updated.lengthCapRatio;
        delete updated.includesMirrorApprover;
        updated.criteriaIds ??= [];
        updated.weakestK ??= 1;
        updated.redundancyJaccardThreshold ??= 0.35;
      } else if (updated.agentType === 'reflect_and_generate') {
        // Shape A: tacticGuidance is generate-only. Switching to reflect_and_generate
        // clears any guidance so the schema mutex stays satisfied.
        delete updated.tacticGuidance;
        delete updated.criteriaIds;
        delete updated.weakestK;
        delete updated.lengthCapRatio;
        delete updated.redundancyJaccardThreshold;
        delete updated.includesMirrorApprover;
        delete updated.debateJudgeReasoningEffort;
        updated.reflectionTopN ??= 3;
      } else if (updated.agentType === 'criteria_and_generate') {
        delete updated.tacticGuidance;
        delete updated.reflectionTopN;
        delete updated.lengthCapRatio;
        delete updated.redundancyJaccardThreshold;
        delete updated.includesMirrorApprover;
        delete updated.debateJudgeReasoningEffort;
        updated.criteriaIds ??= [];
        updated.weakestK ??= 1;
      } else if (updated.agentType === 'paragraph_recombine') {
        // Clear unrelated criteria/editing/reflection/debate fields.
        delete updated.tacticGuidance;
        delete updated.reflectionTopN;
        delete updated.editingMaxCycles;
        delete updated.editingCutoffMode;
        delete updated.editingCutoffValue;
        delete updated.criteriaIds;
        delete updated.weakestK;
        delete updated.lengthCapRatio;
        delete updated.redundancyJaccardThreshold;
        delete updated.includesMirrorApprover;
        delete updated.debateJudgeReasoningEffort;
        updated.rewritesPerParagraph ??= PARAGRAPH_RECOMBINE_DEFAULTS.rewritesPerParagraph;
        updated.maxComparisonsPerParagraph ??= PARAGRAPH_RECOMBINE_DEFAULTS.maxComparisonsPerParagraph;
        updated.maxParagraphsPerInvocation ??= PARAGRAPH_RECOMBINE_DEFAULTS.maxParagraphsPerInvocation;
        // Phase 8 (L): default the new multi-dispatch + cap fields when switching
        // into paragraph_recombine. Stays at default unless user changes them, and
        // payload emission skips defaults so back-compat hash is preserved.
        updated.maxDispatches ??= PARAGRAPH_RECOMBINE_DEFAULTS.maxDispatches;
        updated.perInvocationCapUsd ??= PARAGRAPH_RECOMBINE_DEFAULTS.perInvocationCapUsd;
      } else {
        // generate: drop reflection + criteria + debate + paragraph fields (stale from prior selection).
        delete updated.reflectionTopN;
        delete updated.criteriaIds;
        delete updated.weakestK;
        delete updated.lengthCapRatio;
        delete updated.redundancyJaccardThreshold;
        delete updated.includesMirrorApprover;
        delete updated.debateJudgeReasoningEffort;
        delete updated.rewritesPerParagraph;
        delete updated.maxComparisonsPerParagraph;
        delete updated.maxParagraphsPerInvocation;
        delete updated.paragraphRewriteModel;
        delete updated.maxDispatches;
        delete updated.perInvocationCapUsd;
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
        judgeRubricId: form.judgeRubricId || undefined,
        paragraphJudgeRubricId: form.paragraphJudgeRubricId || undefined,
        editingModel: form.editingModel || undefined,
        approverModel: form.approverModel || undefined,
        seedSelection: form.seedSelection || undefined,
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
                <div>
                  <label htmlFor="judge-rubric" className={labelClasses}>Judge Rubric (optional)</label>
                  <select
                    id="judge-rubric"
                    data-testid="judge-rubric-select"
                    value={form.judgeRubricId}
                    onChange={e => updateForm({ judgeRubricId: e.target.value })}
                    className={inputCls(false)}
                  >
                    <option value="">Holistic (no rubric)</option>
                    {availableRubrics.map(r => (
                      <option key={r.id} value={r.id}>{r.name} ({r.dimension_count} dims)</option>
                    ))}
                  </select>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Used for ARTICLE-level ranking. The hardcoded article rubric
                    (Clarity / Structure / Engagement / Style / Effectiveness) is
                    used when no rubric is selected.
                  </p>
                </div>
                <div>
                  <label htmlFor="paragraph-judge-rubric" className={labelClasses}>
                    Paragraph Judge Rubric (optional)
                  </label>
                  <select
                    id="paragraph-judge-rubric"
                    data-testid="paragraph-judge-rubric-select"
                    value={form.paragraphJudgeRubricId}
                    onChange={e => updateForm({ paragraphJudgeRubricId: e.target.value })}
                    className={inputCls(false)}
                  >
                    <option value="">Default paragraph rubric (Clarity, Conciseness, Coherence, Sentence fluency, Usefulness (cost-balanced), Fit with prior context, Setup)</option>
                    {availableRubrics.map(r => (
                      <option key={r.id} value={r.id}>{r.name} ({r.dimension_count} dims)</option>
                    ))}
                  </select>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Used by per-slot paragraph ranking in paragraph_recombine. Design dimensions
                    that apply to a single paragraph (avoid article-scaled criteria like
                    &quot;overall structure&quot;). The Default rubric covers Clarity, Conciseness,
                    Coherence, Sentence fluency, Usefulness (cost-balanced), Fit with prior
                    context, and Setup of the next paragraph — custom rubrics should consider
                    including similar paragraph-shaped dimensions, especially Conciseness and
                    Coherence which guard against paragraph-by-paragraph padding accumulation.
                    Leave on Default to use the built-in rubric.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="editing-model" className={labelClasses}>Editing Model (optional)</label>
                  <select
                    id="editing-model"
                    value={form.editingModel}
                    onChange={e => updateForm({ editingModel: e.target.value })}
                    className={inputCls()}
                    data-testid="editing-model-select"
                  >
                    <option value="">Inherit from Generation Model</option>
                    {MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Used by Iterative Editing&apos;s Proposer LLM call. Leave on &apos;Inherit&apos; to share the Generation model.</p>
                </div>
                <div>
                  <label htmlFor="approver-model" className={labelClasses}>Approver Model (optional)</label>
                  <select
                    id="approver-model"
                    value={form.approverModel}
                    onChange={e => updateForm({ approverModel: e.target.value })}
                    className={inputCls()}
                    data-testid="approver-model-select"
                  >
                    <option value="">Inherit from Editing Model</option>
                    {MODEL_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Used by Iterative Editing&apos;s Approver LLM call. For maximum auditability, choose a model different from the Editing Model.</p>
                  {(() => {
                    // Rubber-stamping warning per Decisions §16: resolve actual values and
                    // compare. editingModel falls back to generationModel; approverModel
                    // falls back to editingModel (which itself falls back to generationModel).
                    const resolvedEditing = form.editingModel || form.generationModel;
                    const resolvedApprover = form.approverModel || form.editingModel || form.generationModel;
                    if (resolvedEditing && resolvedApprover && resolvedEditing === resolvedApprover) {
                      return (
                        <p
                          data-testid="rubber-stamping-warning"
                          className="text-xs mt-1 px-2 py-1 rounded border bg-[var(--status-warning)]/15 text-[var(--status-warning)] border-[var(--status-warning)]/40"
                        >
                          ⚠️ Proposer and Approver are using the same model. Auditability is reduced — accepts may rubber-stamp edits.
                        </p>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>

              <div>
                <label htmlFor="seed-selection" className={labelClasses}>
                  Seed Selection (optional)
                </label>
                <select
                  id="seed-selection"
                  data-testid="seed-selection-select"
                  value={form.seedSelection}
                  onChange={e => updateForm({ seedSelection: e.target.value as '' | 'highest_elo' | 'random' })}
                  className={inputCls(false)}
                >
                  <option value="">Default (Highest Elo)</option>
                  <option value="highest_elo">Highest Elo (explicit)</option>
                  <option value="random">Random per run (multi-seed topics)</option>
                </select>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  When the topic has multiple seed variants (e.g. Federal Reserve 3), this
                  controls which seed becomes the run&apos;s parent <code>originalText</code>.
                  <strong> Highest Elo</strong> (default) preserves pre-Phase-5 behavior — same
                  seed every run. <strong>Random per run</strong> picks a deterministic seed via
                  SHA-256 of <code>run.id</code>, so a canary&apos;s 6+ invocations sample across the
                  pool while remaining reproducible. Single-seed topics are unaffected.
                </p>
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
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Caps binary-search ranking depth for <code>generate</code>, <code>reflect_and_generate</code>,
                      and <code>iterative_editing</code> iterations uniformly. Lower values reduce per-agent cost
                      (especially noticeable for editing iterations, where ranking can dominate). Default 5.
                    </p>
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
                        <option value="criteria_and_generate">Evaluate Criteria + Generate</option>
                        <option value="single_pass_evaluate_criteria_and_generate">Single-Pass Criteria w/ Guardrails</option>
                        <option value="proposer_approver_criteria_generate" disabled={idx === 0} title={idx === 0 ? 'First iteration must produce variants — propose/approve edits an existing parent' : undefined}>Proposer-Approver Criteria w/ Mirror</option>
                        <option value="debate_and_generate" disabled={idx === 0} title={idx === 0 ? 'First iteration must produce variants on an empty pool' : 'Debate top-2 pool variants then synthesize'}>Debate + Generate</option>
                        <option value="iterative_editing" disabled={idx === 0} title={idx === 0 ? 'First iteration must produce variants' : undefined}>Iterative Editing (Markup)</option>
                        <option value="iterative_editing_rewrite" disabled={idx === 0} title={idx === 0 ? 'First iteration must produce variants' : 'Mode B: proposer rewrites; markup computed mechanically'}>Iterative Editing (Rewrite)</option>
                        <option value="paragraph_recombine" title="Decompose article into paragraphs, generate M rewrites per slot, rank pairwise, recombine winners">Paragraph Recombine</option>
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
                    {(it.agentType === 'iterative_editing' || it.agentType === 'iterative_editing_rewrite' || it.agentType === 'proposer_approver_criteria_generate') && (
                      <div
                        className="mt-2 pl-8 flex flex-wrap items-center gap-2 text-xs font-ui"
                        data-testid={`iteration-editing-controls-${idx}`}
                      >
                        <span className="text-[var(--text-primary)]">
                          {it.agentType === 'proposer_approver_criteria_generate'
                            ? '✏️ Cycles per parent: 1 (single-pass fixed)'
                            : '✏️ Cycles per parent:'}
                        </span>
                        {(it.agentType === 'iterative_editing' || it.agentType === 'iterative_editing_rewrite') && (
                          <input
                            type="number"
                            min={1}
                            max={5}
                            step={1}
                            value={it.editingMaxCycles ?? 3}
                            onChange={e => {
                              const v = e.target.value === '' ? undefined : Number(e.target.value);
                              updateIteration(idx, { editingMaxCycles: v });
                            }}
                            className="w-14 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                            data-testid={`editing-max-cycles-${idx}`}
                            title="How many propose-review-apply rounds run per parent (1-5). More = more refinement, higher cost."
                          />
                        )}
                        <span className="ml-2 text-[var(--text-primary)]">· Eligibility cutoff: top</span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          step={1}
                          value={it.editingCutoffValue ?? 10}
                          onChange={e => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value);
                            updateIteration(idx, { editingCutoffValue: v });
                          }}
                          className="w-16 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`editing-cutoff-value-${idx}`}
                        />
                        <select
                          value={it.editingCutoffMode ?? 'topN'}
                          onChange={e => updateIteration(idx, { editingCutoffMode: e.target.value as 'topN' | 'topPercent' })}
                          className="px-2 py-1 text-xs font-ui bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`editing-cutoff-mode-${idx}`}
                        >
                          <option value="topN">variants</option>
                          <option value="topPercent">%</option>
                        </select>
                        <span className="text-[var(--text-muted)]" title="Caps how many top-Elo variants from the pool can be edited this iteration. Default 10 — most strategies are budget-bound first.">
                          &nbsp;· caps editable variants per iteration
                        </span>
                      </div>
                    )}
                    {isCriteriaBased(it.agentType) && (
                      <div
                        className="mt-2 pl-8 flex flex-wrap items-center gap-2 text-xs font-ui"
                        data-testid={`iteration-criteria-controls-${idx}`}
                      >
                        <span className="text-[var(--text-primary)]">🎯 Criteria:</span>
                        <button
                          type="button"
                          onClick={() => setCriteriaEditorIdx(idx)}
                          className="px-2 py-1 text-xs border border-[var(--border-default)] rounded hover:bg-[var(--bg-elevated)]"
                          data-testid={`criteria-select-button-${idx}`}
                        >
                          {it.criteriaIds && it.criteriaIds.length > 0
                            ? `${it.criteriaIds.length} selected`
                            : 'Select criteria...'}
                        </button>
                        <span className="text-[var(--text-primary)] ml-2">Weakest K:</span>
                        <input
                          type="number"
                          min={1}
                          max={Math.min(5, Math.max(1, it.criteriaIds?.length ?? 5))}
                          step={1}
                          value={it.weakestK ?? 1}
                          onChange={e => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value);
                            updateIteration(idx, { weakestK: v });
                          }}
                          className="w-14 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`weakest-k-input-${idx}`}
                          title={it.criteriaIds && it.weakestK && it.weakestK > it.criteriaIds.length
                            ? `weakestK (${it.weakestK}) cannot exceed selected criteria (${it.criteriaIds.length})`
                            : ''}
                        />
                      </div>
                    )}
                    {(it.agentType === 'single_pass_evaluate_criteria_and_generate'
                      || it.agentType === 'proposer_approver_criteria_generate') && (
                      <div
                        className="mt-2 pl-8 flex flex-wrap items-center gap-2 text-xs font-ui"
                        data-testid={`iteration-guardrails-controls-${idx}`}
                      >
                        <span className="text-[var(--text-primary)]">🛡️ Redundancy threshold:</span>
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.05}
                          value={it.redundancyJaccardThreshold ?? 0.35}
                          onChange={e => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value);
                            updateIteration(idx, { redundancyJaccardThreshold: v });
                          }}
                          className="w-16 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`redundancy-threshold-input-${idx}`}
                          title="Trigram-Jaccard threshold (0-1). Reject edits whose newText shares more than this fraction of trigrams with the rest of the article. Default 0.35."
                        />
                        {it.agentType === 'proposer_approver_criteria_generate' && (
                          <>
                            <span className="ml-2 text-[var(--text-primary)]">· Length cap ratio:</span>
                            <input
                              type="number"
                              min={1.01}
                              max={1.50}
                              step={0.05}
                              value={it.lengthCapRatio ?? 1.10}
                              onChange={e => {
                                const v = e.target.value === '' ? undefined : Number(e.target.value);
                                updateIteration(idx, { lengthCapRatio: v });
                              }}
                              className="w-16 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                              data-testid={`length-cap-ratio-input-${idx}`}
                              title="Tightened size-ratio cap. Edits whose newText > this × oldText length get dropped. Default 1.10 (±10%)."
                            />
                            <label className="ml-2 inline-flex items-center gap-1 cursor-pointer" title="When checked, the approver runs twice (forward + mirror) and applies edits only when forward=ACCEPT and mirror=REJECT. When unchecked, applies forward-accepted edits directly.">
                              <input
                                type="checkbox"
                                checked={it.includesMirrorApprover ?? true}
                                onChange={e => updateIteration(idx, { includesMirrorApprover: e.target.checked })}
                                className="cursor-pointer"
                                data-testid={`includes-mirror-approver-${idx}`}
                              />
                              <span className="text-[var(--text-primary)]">Include mirror approver</span>
                            </label>
                          </>
                        )}
                      </div>
                    )}
                    {criteriaEditorIdx === idx && (
                      <CriteriaMultiSelect
                        availableCriteria={availableCriteria}
                        selected={it.criteriaIds ?? []}
                        onChange={(ids) => updateIteration(idx, { criteriaIds: ids })}
                        onClose={() => setCriteriaEditorIdx(null)}
                      />
                    )}
                    {it.agentType === 'debate_and_generate' && (() => {
                      // bring_back_debate_agent_20260506 Phase 4.6 — debate iteration controls.
                      // Reasoning-effort dropdown is conditionally enabled by the strategy's
                      // judgeModel.supportsReasoning flag. Disabled state shows a help-text chip
                      // listing reasoning-capable models from the registry.
                      const judgeModel = form.judgeModel;
                      const judgeSupportsReasoning = modelSupportsReasoning(judgeModel);
                      const reasoningCapableModels = Object.entries(MODEL_REGISTRY)
                        .filter(([, m]) => m.supportsReasoning)
                        .map(([id]) => id);
                      const registryDefault = MODEL_REGISTRY[judgeModel]?.defaultReasoningEffort;
                      return (
                        <div
                          className="mt-2 pl-8 flex flex-wrap items-center gap-2 text-xs font-ui"
                          data-testid={`iteration-debate-controls-${idx}`}
                        >
                          <span className="text-[var(--text-primary)]" data-testid={`debate-info-chip-${idx}`}>
                            🥊 Uses strategy Judge model for analyze+judge / Generation model for synthesis · Judge reasoning effort:
                          </span>
                          <select
                            value={it.debateJudgeReasoningEffort ?? ''}
                            disabled={!judgeSupportsReasoning}
                            onChange={e => {
                              const v = e.target.value === '' ? undefined : (e.target.value as 'none' | 'low' | 'medium' | 'high');
                              updateIteration(idx, { debateJudgeReasoningEffort: v });
                            }}
                            className="px-2 py-1 text-xs font-ui bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            data-testid={`debate-reasoning-effort-${idx}`}
                          >
                            <option value="">
                              {judgeSupportsReasoning
                                ? `Inherit (${registryDefault ?? 'none'})`
                                : `Not supported by ${judgeModel}`}
                            </option>
                            <option value="none">none</option>
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                          {!judgeSupportsReasoning && (
                            <span className="text-[var(--text-muted)] italic" data-testid={`debate-reasoning-help-chip-${idx}`}>
                              Pick a reasoning-capable model ({reasoningCapableModels.join(', ')}) on Step 1 to enable thinking.
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    {it.agentType === 'paragraph_recombine' && (
                      <div
                        className="mt-2 pl-8 flex flex-wrap items-center gap-2 text-xs font-ui"
                        data-testid={`iteration-paragraph-controls-${idx}`}
                      >
                        <span className="text-[var(--text-primary)]">Rewrites/slot:</span>
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={it.rewritesPerParagraph ?? PARAGRAPH_RECOMBINE_DEFAULTS.rewritesPerParagraph}
                          onChange={e => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value);
                            updateIteration(idx, { rewritesPerParagraph: v });
                          }}
                          className="w-14 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`rewrites-per-paragraph-${idx}`}
                          title="Number of parallel rewrites per paragraph slot (1-6). Default 3."
                        />
                        <span className="ml-2 text-[var(--text-primary)]">· Max comparisons/slot:</span>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={it.maxComparisonsPerParagraph ?? PARAGRAPH_RECOMBINE_DEFAULTS.maxComparisonsPerParagraph}
                          onChange={e => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value);
                            updateIteration(idx, { maxComparisonsPerParagraph: v });
                          }}
                          className="w-14 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`max-comparisons-per-paragraph-${idx}`}
                          title="Maximum pairwise comparisons within a single slot's ranking phase (1-20). Default 8."
                        />
                        <span className="ml-2 text-[var(--text-primary)]">· Max slots/invocation:</span>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={it.maxParagraphsPerInvocation ?? PARAGRAPH_RECOMBINE_DEFAULTS.maxParagraphsPerInvocation}
                          onChange={e => {
                            const v = e.target.value === '' ? undefined : Number(e.target.value);
                            updateIteration(idx, { maxParagraphsPerInvocation: v });
                          }}
                          className="w-14 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`max-paragraphs-per-invocation-${idx}`}
                          title="Caps the number of paragraph slots processed in one invocation (1-50). Default 12."
                        />
                        <span className="ml-2 text-[var(--text-primary)]">· Rewrite model:</span>
                        <input
                          type="text"
                          value={it.paragraphRewriteModel ?? ''}
                          placeholder="(inherit generation model)"
                          onChange={e => updateIteration(idx, { paragraphRewriteModel: e.target.value || undefined })}
                          className="w-44 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`paragraph-rewrite-model-${idx}`}
                          title="Override model used for paragraph rewriting LLM calls. Empty = inherit strategy generation model."
                        />
                        {/* investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 Phase 8 (L):
                            multi-dispatch + per-invocation safety cap inputs. Default 1 / $0.05
                            preserves pre-J back-compat (toIterationConfigsPayload skips emission
                            when values equal defaults so config_hash stays stable). */}
                        <span className="ml-2 text-[var(--text-primary)]">· Max dispatches:</span>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={it.maxDispatches ?? PARAGRAPH_RECOMBINE_DEFAULTS.maxDispatches}
                          onChange={e => {
                            const v = e.target.value === '' ? undefined : Math.max(1, Math.min(10, Number(e.target.value) || 1));
                            updateIteration(idx, { maxDispatches: v });
                          }}
                          className="w-14 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`max-dispatches-${idx}`}
                          title="Cap on parallel paragraph_recombine invocations per iteration (1-10). Default 1 reproduces pre-J single-dispatch behavior. >1 requires sourceMode='pool' + qualityCutoff to take effect at runtime."
                        />
                        <span className="ml-2 text-[var(--text-primary)]">· Per-invocation cap $:</span>
                        <input
                          type="number"
                          step="0.001"
                          min={0.001}
                          max={0.5}
                          value={it.perInvocationCapUsd ?? PARAGRAPH_RECOMBINE_DEFAULTS.perInvocationCapUsd}
                          onChange={e => {
                            const v = e.target.value === '' ? undefined : Math.max(0.001, Math.min(0.5, Number(e.target.value) || 0.05));
                            updateIteration(idx, { perInvocationCapUsd: v });
                          }}
                          className="w-20 px-2 py-1 text-xs font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page text-[var(--text-primary)] text-right focus:border-[var(--accent-gold)] focus:outline-none"
                          data-testid={`per-invocation-cap-usd-${idx}`}
                          title="Per-invocation safety cap (USD). Default $0.05 (Option F). Caps a runaway invocation; not a spend target."
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
