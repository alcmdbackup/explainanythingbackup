// runEditingCycle — extracted from IterativeEditingAgent.execute()'s per-cycle inner block.
// Shared between IterativeEditingAgent (Mode A + Mode B via the rewriteMode discriminator)
// and ParagraphRecombineWithCoherencePassAgent (single-cycle coherence pass with tight opts).
//
// paragraph_recombine_agent_with_coherence_pass_evolution_20260620 Phase 4.
//
// LOAD-BEARING INVARIANTS:
//   I1. Helper calls llm.complete() directly. Never instantiates an Agent class.
//   I2. Helper owns cost-snapshot bookkeeping. Reads costScope.getOwnSpent() before each
//       LLM call, returns proposeCostUsd / approveCostUsd / driftRecoveryCostUsd on the cycle.
//   I3. On LLM throw, helper returns { newText: input.text, cycle: <partial>, stopReason:
//       'helper_threw', errorPhase, errorMessage }. Caller pushes the partial cycle into its
//       cycles[] array. On unexpected internal throw (parser bug, etc.), the throw propagates
//       — caller's outer try/catch handles it the same way IterativeEditingAgent.execute()
//       always has.
//
// Helper behavior is BIT-IDENTICAL to the pre-refactor IterativeEditingAgent inner cycle
// when called with the defaults IterativeEditingAgent uses (validateOpts: undefined,
// driftRecovery: 'snap', proposerSystemPrompt: buildProposerSystemPrompt(), etc.).
//
// Verification: existing IterativeEditingAgent.test.ts + IterativeEditingRewriteAgent.test.ts
// continue to pass post-refactor (the extract delegates to this helper; observable behavior
// at the agent level is unchanged).

import type { EvolutionLLMClient } from '../../../types';
import type { AgentCostScope } from '../../../pipeline/infra/trackBudget';
import type { AgentName } from '../../agentNames';
import {
  parseProposedEdits,
} from './parseProposedEdits';
import { checkProposerDrift } from './checkProposerDrift';
import { validateEditGroups, type ValidateEditGroupsOptions } from './validateEditGroups';
import { parseReviewDecisions } from './parseReviewDecisions';
import { applyAcceptedGroups } from './applyAcceptedGroups';
import { classifyDriftMagnitude } from './recoverDrift';
import { snapDriftToSource } from './snapDriftToSource';
import { buildApproverSystemPrompt, buildApproverUserPrompt } from './approverPrompt';
import { splitRationaleAndRewrite } from './splitRationaleAndRewrite';
import { sanitizeForPriorContext } from '../paragraphRecombine/promptSafety';
import {
  computeMarkupFromRewrite,
  RewriteParseError,
  DiffEngineError,
  RewriteTooLargeError,
  serializeError,
} from './computeMarkupFromRewrite';
import { coalesceAdjacentGroups } from './coalesceAdjacentGroups';
import { capGroupsByMagnitude } from './capGroupsByMagnitude';
import type {
  EditingCycle,
  IterativeEditingStopReason,
} from './types';

/** Mode B (rewrite-then-diff) discriminator. Inner-cycle behavior for the
 *  IterativeEditingRewriteAgent path. */
export interface RewriteModeOptions {
  /** When true, apply coalesceAdjacentGroups + capGroupsByMagnitude post-parse.
   *  Now defaults to FALSE (max approver granularity) — set true only when a caller
   *  explicitly wants the post-parse bundling (e.g. legacy tests). */
  coalesceAndCap: boolean;
  capLimit?: number; // default 10 (only consulted when coalesceAndCap === true)
}

export interface RunEditingCycleArgs {
  /** Current article text (caller owns loop state). */
  text: string;
  /** Caller's per-invocation LLM client (I1 invariant). */
  llm: EvolutionLLMClient;
  /** Caller's per-invocation cost scope (I2 invariant — helper snapshots costs). */
  costScope: AgentCostScope;
  /** Per-invocation budget cap. Used for the per-cycle 0.9× entry gate. */
  perInvocationBudgetUsd: number;
  /** 1-indexed cycle number for labeling. Helper is otherwise stateless w.r.t. cycle count. */
  cycleNumber: number;
  /** AgentName labels routed to cost metrics. */
  proposerLabel: AgentName;
  approverLabel: AgentName;
  /** Per-call models. Caller resolves defaults (e.g. coherencePassProposerModel ?? generationModel). */
  models: { editing: string; approver: string };
  /** undefined → validateEditGroups uses its no-opts default (SIZE_RATIO_HARD_CAP=1.5). */
  validateOpts?: ValidateEditGroupsOptions;
  /** 'snap' = current IterativeEditingAgent drift snap; 'skip' = skip drift handling (coherence pass). */
  driftRecovery: 'snap' | 'skip';
  /** Mode A defaults: buildProposerSystemPrompt() / buildProposerUserPrompt(text).
   *  Callers can override (coherence pass uses inter-paragraph-seams variant). */
  proposerSystemPrompt: string;
  proposerUserPrompt: string;
  /** Mode B options. When set, helper switches to rewrite-then-diff proposer path
   *  (split rationale + compute markup from rewrite, etc.). When undefined → Mode A. */
  rewriteMode?: RewriteModeOptions;
}

/** Per-cycle budget abort fraction (matches PER_INVOCATION_BUDGET_ABORT_FRACTION in constants.ts). */
const PER_INVOCATION_BUDGET_ABORT_FRACTION = 0.9;

export interface RunEditingCycleResult {
  /** Post-apply text, or input.text on any failure path that returned a stopReason. */
  newText: string;
  /** Fully-populated cycle detail. Mode B context fields (rationale, rewriteText,
   *  computedMarkup, proposerMode) live in `modeBContext` — caller attaches them to the
   *  persisted cycle if needed. */
  cycle: EditingCycle;
  /**
   * When set, caller MUST stop looping. Mapping to IterativeEditingStopReason values:
   *   - 'invocation_budget_near_exhaustion' — per-cycle entry budget gate fired
   *   - 'helper_threw'                       — LLM call threw (errorPhase / errorMessage on result)
   *   - 'proposer_format_violation'          — Mode B proposer output missing required sections
   *   - 'rewrite_too_large' / 'rewrite_parse_failed' / 'diff_engine_failed' — Mode B compute errors
   *   - 'proposer_drift_major' / 'proposer_drift_unrecoverable' — drift handling failures
   *   - 'article_size_explosion'             — size-ratio guardrail aborted
   *   - 'parse_failed' / 'no_edits_proposed' — no edits to apply this cycle
   *   - 'all_edits_rejected'                 — approver rejected all
   *   - 'format_invalid'                     — apply produced format-invalid text
   *
   * When undefined, caller should continue with `current.text = result.newText` for next iter.
   */
  stopReason?: IterativeEditingStopReason;
  errorPhase?: 'propose' | 'parse' | 'approve' | 'recovery' | 'apply';
  errorMessage?: string;
  /** Helper-level success indicator. False when stopReason indicates a non-budget failure. */
  appliedAny: boolean;
  /** Mode B (rewrite-mode) only: split rationale + rewrite text + computed markup.
   *  Undefined on Mode A path or when Mode B failed before producing any of these. */
  modeBContext?: {
    rationale?: string;
    /** Truncated to 8KB by caller (matches existing IterativeEditingAgent behavior). */
    rewriteText?: string;
    computedMarkup?: string;
    /** Mode B's normalized source — the canonicalized parent text used by the diff engine.
     *  Caller must reassign `current.text` to this for the NEXT cycle so subsequent
     *  parses/applies operate on the same canonicalization. */
    normalizedSource?: string;
  };
}

/** Build a complete EditingCycle from accumulated state. Used to emit both normal-path
 *  cycle records and partial-cycle-on-throw records. */
function buildCycle(args: {
  cycleNumber: number;
  proposedMarkup: string;
  parseResult: ReturnType<typeof parseProposedEdits>;
  droppedPreApprover: EditingCycle['droppedPreApprover'];
  approverGroups: EditingCycle['approverGroups'];
  reviewDecisions: EditingCycle['reviewDecisions'];
  droppedPostApprover: EditingCycle['droppedPostApprover'];
  appliedGroups: EditingCycle['appliedGroups'];
  formatValid: boolean;
  parentText: string;
  childText?: string;
  proposeCostUsd: number;
  approveCostUsd: number;
  driftRecoveryCostUsd?: number;
  driftRecoveryDetails?: EditingCycle['driftRecovery'];
  sizeRatio: number;
  acceptedCount?: number;
  rejectedCount?: number;
  appliedCount?: number;
}): EditingCycle {
  return {
    cycleNumber: args.cycleNumber,
    proposedMarkup: args.proposedMarkup,
    proposedGroupsRaw: args.parseResult.groups,
    droppedPreApprover: args.droppedPreApprover,
    approverGroups: args.approverGroups,
    reviewDecisions: args.reviewDecisions,
    droppedPostApprover: args.droppedPostApprover,
    appliedGroups: args.appliedGroups,
    acceptedCount: args.acceptedCount ?? 0,
    rejectedCount: args.rejectedCount ?? 0,
    appliedCount: args.appliedCount ?? 0,
    formatValid: args.formatValid,
    parentText: args.parentText,
    ...(args.childText !== undefined ? { childText: args.childText } : {}),
    ...(args.driftRecoveryDetails !== undefined ? { driftRecovery: args.driftRecoveryDetails } : {}),
    proposeCostUsd: args.proposeCostUsd,
    approveCostUsd: args.approveCostUsd,
    ...(args.driftRecoveryCostUsd !== undefined ? { driftRecoveryCostUsd: args.driftRecoveryCostUsd } : {}),
    sizeRatio: args.sizeRatio,
  };
}

/** Run one propose-validate-review-apply cycle. See file header for invariants. */
export async function runEditingCycle(args: RunEditingCycleArgs): Promise<RunEditingCycleResult> {
  const {
    text, llm, costScope, perInvocationBudgetUsd, cycleNumber,
    proposerLabel, approverLabel, models, validateOpts, driftRecovery,
    proposerSystemPrompt, proposerUserPrompt, rewriteMode,
  } = args;

  const isRewriteMode = rewriteMode !== undefined;
  const emptyParse = { groups: [], dropped: [], recoveredSource: text };

  // I2: per-cycle entry budget gate.
  const spentBeforeCycle = costScope.getOwnSpent?.() ?? 0;
  if (spentBeforeCycle >= perInvocationBudgetUsd * PER_INVOCATION_BUDGET_ABORT_FRACTION) {
    return {
      newText: text,
      cycle: buildCycle({
        cycleNumber, proposedMarkup: '', parseResult: emptyParse,
        droppedPreApprover: [], approverGroups: [], reviewDecisions: [],
        droppedPostApprover: [], appliedGroups: [], formatValid: false,
        parentText: text, proposeCostUsd: 0, approveCostUsd: 0, sizeRatio: 1.0,
      }),
      stopReason: 'invocation_budget_near_exhaustion',
      appliedAny: false,
    };
  }

  // ── Proposer call ──
  const costBeforeProposeCall = costScope.getOwnSpent?.() ?? 0;
  let proposerOutput: string;
  try {
    proposerOutput = await llm.complete(
      `${proposerSystemPrompt}\n\n${proposerUserPrompt}`,
      proposerLabel,
      { model: models.editing },
    );
  } catch (err) {
    return {
      newText: text,
      cycle: buildCycle({
        cycleNumber, proposedMarkup: '', parseResult: emptyParse,
        droppedPreApprover: [], approverGroups: [], reviewDecisions: [],
        droppedPostApprover: [], appliedGroups: [], formatValid: false,
        parentText: text, proposeCostUsd: 0, approveCostUsd: 0, sizeRatio: 1.0,
      }),
      stopReason: 'helper_threw',
      errorPhase: 'propose',
      errorMessage: err instanceof Error ? err.message : String(err),
      appliedAny: false,
    };
  }
  const proposeCostUsd = (costScope.getOwnSpent?.() ?? 0) - costBeforeProposeCall;

  // ── Mode B output processing ──
  let proposedMarkup: string;
  let workingText = text;
  let modeBRationale: string | undefined;
  let modeBRewriteText: string | undefined;
  let modeBComputedMarkup: string | undefined;
  let modeBNormalizedSource: string | undefined;

  if (isRewriteMode) {
    const split = splitRationaleAndRewrite(proposerOutput);
    modeBRationale = split.rationale;
    // Truncate to 8KB to match existing IterativeEditingAgent behavior.
    modeBRewriteText = split.rewrite.slice(0, 8 * 1024);
    if (split.parseFailed && !split.rewrite) {
      return {
        newText: text,
        cycle: buildCycle({
          cycleNumber, proposedMarkup: '', parseResult: emptyParse,
          droppedPreApprover: [], approverGroups: [], reviewDecisions: [],
          droppedPostApprover: [], appliedGroups: [], formatValid: false,
          parentText: text,
          proposeCostUsd, approveCostUsd: 0, sizeRatio: 1.0,
        }),
        stopReason: 'proposer_format_violation',
        errorMessage: 'Proposer output missing both ## Rationale and ## Rewrite sections',
        appliedAny: false,
      };
    }
    try {
      const computeResult = await computeMarkupFromRewrite(text, split.rewrite);
      proposedMarkup = computeResult.markup;
      modeBComputedMarkup = computeResult.markup;
      workingText = computeResult.normalizedBefore; // canonicalize for the rest of the pipeline
      modeBNormalizedSource = computeResult.normalizedBefore;
    } catch (e) {
      let stopReason: IterativeEditingStopReason;
      let errorMessage: string;
      if (e instanceof RewriteTooLargeError) {
        stopReason = 'rewrite_too_large';
        errorMessage = e.message;
      } else if (e instanceof RewriteParseError) {
        stopReason = 'rewrite_parse_failed';
        errorMessage = e.message;
      } else if (e instanceof DiffEngineError) {
        stopReason = 'diff_engine_failed';
        errorMessage = e.message;
      } else {
        throw e;
      }
      const errCtx = e instanceof RewriteParseError || e instanceof DiffEngineError
        ? serializeError(e.originalError)
        : undefined;
      void errCtx; // Mode B agent stores in errorContext on the cycle; helper doesn't surface this field on EditingCycle
      return {
        newText: text,
        cycle: buildCycle({
          cycleNumber, proposedMarkup: '', parseResult: emptyParse,
          droppedPreApprover: [], approverGroups: [], reviewDecisions: [],
          droppedPostApprover: [], appliedGroups: [], formatValid: false,
          parentText: text,
          proposeCostUsd, approveCostUsd: 0, sizeRatio: 1.0,
        }),
        stopReason,
        errorMessage,
        appliedAny: false,
      };
    }
  } else {
    proposedMarkup = proposerOutput;
  }

  // ── Parse + (Mode B) coalesce/cap ──
  const parseResult = parseProposedEdits(proposedMarkup, workingText);
  if (isRewriteMode && rewriteMode.coalesceAndCap) {
    const coalesced = coalesceAdjacentGroups(parseResult.groups, workingText);
    const cap = capGroupsByMagnitude(coalesced, workingText, rewriteMode.capLimit ?? 10);
    parseResult.groups = cap.kept;
    parseResult.dropped = [...parseResult.dropped, ...cap.dropped];
  }

  // ── Mode A: pre-flight structural rejection ──
  if (!isRewriteMode) {
    const lenDelta = Math.abs(parseResult.recoveredSource.length - workingText.length);
    const lenDeltaRatio = lenDelta / Math.max(1, workingText.length);
    if (lenDeltaRatio > 0.50 && parseResult.groups.length < 3) {
      return {
        newText: text,
        cycle: buildCycle({
          cycleNumber, proposedMarkup, parseResult,
          droppedPreApprover: [...parseResult.dropped],
          approverGroups: [], reviewDecisions: [], droppedPostApprover: [],
          appliedGroups: [], formatValid: false, parentText: workingText,
          proposeCostUsd, approveCostUsd: 0, sizeRatio: 1.0,
        }),
        stopReason: 'structural_rewrite',
        appliedAny: false,
      };
    }
  }

  // ── Drift check (Mode A only; Mode B uses skip) ──
  const driftResult = (isRewriteMode || driftRecovery === 'skip')
    ? { drift: false as const, regions: [] }
    : checkProposerDrift(parseResult.recoveredSource, workingText);

  let approverGroupsRaw: typeof parseResult.groups;
  const droppedPreApprover = [...parseResult.dropped];
  let driftRecoveryCostUsd: number | undefined;
  let driftRecoveryDetails: EditingCycle['driftRecovery'] = undefined;
  let workingMarkup = proposedMarkup;

  if (driftResult.drift) {
    const magnitude = classifyDriftMagnitude(driftResult.regions, parseResult.groups);
    if (magnitude === 'major') {
      driftRecoveryDetails = {
        outcome: 'skipped_major_drift',
        regions: driftResult.regions,
        costUsd: 0,
      };
      return {
        newText: text,
        cycle: buildCycle({
          cycleNumber, proposedMarkup, parseResult,
          droppedPreApprover, approverGroups: [], reviewDecisions: [],
          droppedPostApprover: [], appliedGroups: [], formatValid: false,
          parentText: workingText,
          proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd: 0, driftRecoveryDetails,
          sizeRatio: 1.0,
        }),
        stopReason: 'proposer_drift_major',
        appliedAny: false,
      };
    }
    // Minor drift → snap-to-source (deterministic, zero cost).
    const snap = snapDriftToSource({
      regions: driftResult.regions,
      proposedMarkup,
      currentText: workingText,
    });
    driftRecoveryCostUsd = 0;
    if (snap.aborted) {
      driftRecoveryDetails = {
        outcome: 'unrecoverable_residual',
        regions: driftResult.regions,
        classifications: snap.classifications,
        costUsd: 0,
      };
      return {
        newText: text,
        cycle: buildCycle({
          cycleNumber, proposedMarkup, parseResult,
          droppedPreApprover, approverGroups: [], reviewDecisions: [],
          droppedPostApprover: [], appliedGroups: [], formatValid: false,
          parentText: workingText,
          proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd: 0, driftRecoveryDetails,
          sizeRatio: 1.0,
        }),
        stopReason: 'proposer_drift_unrecoverable',
        appliedAny: false,
      };
    }
    driftRecoveryDetails = {
      outcome: 'recovered',
      regions: driftResult.regions,
      classifications: snap.classifications,
      patchedMarkup: snap.patchedMarkup,
      costUsd: 0,
    };
    workingMarkup = snap.patchedMarkup;
    const repatched = parseProposedEdits(workingMarkup, workingText);
    const recheckDrift = checkProposerDrift(repatched.recoveredSource, workingText);
    if (recheckDrift.drift) {
      return {
        newText: text,
        cycle: buildCycle({
          cycleNumber, proposedMarkup: workingMarkup, parseResult,
          droppedPreApprover, approverGroups: [], reviewDecisions: [],
          droppedPostApprover: [], appliedGroups: [], formatValid: false,
          parentText: workingText,
          proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd: 0, driftRecoveryDetails,
          sizeRatio: 1.0,
        }),
        stopReason: 'proposer_drift_unrecoverable',
        appliedAny: false,
      };
    }
    approverGroupsRaw = repatched.groups;
    droppedPreApprover.push(...repatched.dropped);
  } else {
    approverGroupsRaw = parseResult.groups;
  }

  // ── Validate (hard rules + size-ratio guardrail) ──
  const validation = validateEditGroups(approverGroupsRaw, workingText, validateOpts);
  droppedPreApprover.push(...validation.droppedPreApprover);

  if (validation.sizeExplosion) {
    return {
      newText: text,
      cycle: buildCycle({
        cycleNumber, proposedMarkup: workingMarkup, parseResult,
        droppedPreApprover, approverGroups: [], reviewDecisions: [],
        droppedPostApprover: [], appliedGroups: [], formatValid: false,
        parentText: workingText,
        proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd, driftRecoveryDetails,
        sizeRatio: 1.5,
      }),
      stopReason: 'article_size_explosion',
      appliedAny: false,
    };
  }

  if (validation.approverGroups.length === 0) {
    const stopReason: IterativeEditingStopReason =
      parseResult.dropped.some((d) => d.reason === 'invalid_group_number')
        ? 'parse_failed'
        : 'no_edits_proposed';
    return {
      newText: text,
      cycle: buildCycle({
        cycleNumber, proposedMarkup: workingMarkup, parseResult,
        droppedPreApprover, approverGroups: [], reviewDecisions: [],
        droppedPostApprover: [], appliedGroups: [], formatValid: false,
        parentText: workingText,
        proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd, driftRecoveryDetails,
        sizeRatio: 1.0,
      }),
      stopReason,
      appliedAny: false,
    };
  }

  // ── Approver call ──
  const costBeforeApproveCall = costScope.getOwnSpent?.() ?? 0;
  const approverSys = buildApproverSystemPrompt();
  // Mode B (rewrite) rationale is LLM-generated proposer output — treat it as
  // untrusted and redact delimiter-tag literals before injecting into the
  // approver prompt. Without this a proposer that echoes </UNTRUSTED_…> tags
  // (whether benign accident or adversarial injection) can break out of the
  // data scope. Mirrors the paragraph_recombine priorPicks defense.
  const sanitizedRationale = isRewriteMode && modeBRationale !== undefined
    ? sanitizeForPriorContext(modeBRationale).sanitized
    : undefined;
  const approverUser = buildApproverUserPrompt(
    workingMarkup,
    validation.approverGroups,
    sanitizedRationale,
  );
  let approverResponse: string;
  try {
    approverResponse = await llm.complete(
      `${approverSys}\n\n${approverUser}`,
      approverLabel,
      { model: models.approver },
    );
  } catch (err) {
    return {
      newText: text,
      cycle: buildCycle({
        cycleNumber, proposedMarkup: workingMarkup, parseResult,
        droppedPreApprover, approverGroups: validation.approverGroups,
        reviewDecisions: [], droppedPostApprover: [], appliedGroups: [],
        formatValid: false, parentText: workingText,
        proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd, driftRecoveryDetails,
        sizeRatio: 1.0,
      }),
      stopReason: 'helper_threw',
      errorPhase: 'approve',
      errorMessage: err instanceof Error ? err.message : String(err),
      appliedAny: false,
    };
  }
  const approveCostUsd = (costScope.getOwnSpent?.() ?? 0) - costBeforeApproveCall;

  const expectedGroupNumbers = validation.approverGroups.map((g) => g.groupNumber);
  const reviewDecisions = parseReviewDecisions(approverResponse, expectedGroupNumbers);

  // ── Apply ──
  const applyResult = applyAcceptedGroups(validation.approverGroups, reviewDecisions, workingText);
  const acceptedCount = reviewDecisions.filter((d) => d.decision === 'accept').length;
  const rejectedCount = reviewDecisions.filter((d) => d.decision === 'reject').length;
  const appliedCount = applyResult.appliedGroups.length;

  const sizeRatio = workingText.length > 0 ? applyResult.newText.length / workingText.length : 1.0;

  const cycle = buildCycle({
    cycleNumber, proposedMarkup: workingMarkup, parseResult,
    droppedPreApprover,
    approverGroups: validation.approverGroups, reviewDecisions,
    droppedPostApprover: applyResult.droppedPostApprover,
    appliedGroups: applyResult.appliedGroups,
    formatValid: applyResult.formatValid,
    parentText: workingText,
    childText: applyResult.newText !== workingText ? applyResult.newText : undefined,
    proposeCostUsd, approveCostUsd, driftRecoveryCostUsd, driftRecoveryDetails,
    sizeRatio,
    acceptedCount, rejectedCount, appliedCount,
  });

  const modeBContext: RunEditingCycleResult['modeBContext'] = isRewriteMode
    ? {
        ...(modeBRationale !== undefined && { rationale: modeBRationale }),
        ...(modeBRewriteText !== undefined && { rewriteText: modeBRewriteText }),
        ...(modeBComputedMarkup !== undefined && { computedMarkup: modeBComputedMarkup }),
        ...(modeBNormalizedSource !== undefined && { normalizedSource: modeBNormalizedSource }),
      }
    : undefined;

  if (appliedCount === 0) {
    return {
      newText: workingText, cycle, stopReason: 'all_edits_rejected', appliedAny: false,
      ...(modeBContext && { modeBContext }),
    };
  }
  if (!applyResult.formatValid) {
    return {
      newText: workingText, cycle, stopReason: 'format_invalid', appliedAny: false,
      ...(modeBContext && { modeBContext }),
    };
  }

  // Normal success — caller updates current.text and continues.
  return {
    newText: applyResult.newText, cycle, appliedAny: true,
    ...(modeBContext && { modeBContext }),
  };
}
