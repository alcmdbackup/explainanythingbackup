// IterativeEditingAgent — wrapper agent that runs a propose-then-review protocol
// for up to N cycles per parent variant. Per-cycle: Proposer LLM marks up the
// article with numbered CriticMarkup edits, deterministic Implementer parses +
// validates, Approver LLM accepts/rejects each numbered group, Implementer
// applies surviving edits position-based (right-to-left).
//
// LOAD-BEARING INVARIANTS (per Decisions §13):
//   I1. Internal LLM helpers MUST use the wrapper's `EvolutionLLMClient` instance
//       directly via the injected input.llm. Never instantiate a separate Agent
//       and call `.run()` — that creates a NESTED `Agent.run()` scope (separate
//       AgentCostScope) and splits cost attribution.
//   I2. Capture `costBeforeProposeCall` / `costBeforeApproveCall` snapshots
//       BEFORE each helper call so per-purpose cost can be split into
//       execution_detail.cycles[i].{proposeCostUsd, approveCostUsd}. Drift
//       recovery is now deterministic (snapDriftToSource); driftRecoveryCostUsd
//       is always 0 and no snapshot is needed.
//   I3. Write partial `execution_detail` to the invocation row BEFORE re-throwing
//       on any helper failure. The trackInvocations partial-update fix ensures
//       Agent.run()'s catch handler doesn't overwrite our partial detail with null.

import { Agent } from '../../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from '../../types';
import { createVariant, type Variant, type EvolutionLLMClient } from '../../../types';
import { iterativeEditingExecutionDetailSchema } from '../../../schemas';
import { rankNewVariant, type RankNewVariantResult } from '../../../pipeline/loop/rankNewVariant';
import type { Rating, ComparisonResult } from '../../../shared/computeRatings';
import type { V2Match } from '../../../pipeline/infra/types';
import {
  AGENT_DEFAULT_MAX_CYCLES,
  PER_INVOCATION_BUDGET_ABORT_FRACTION,
} from './constants';
import type {
  IterativeEditInput,
  IterativeEditOutput,
  IterativeEditingExecutionDetail,
  IterativeEditingRankingDetail,
  IterativeEditingStopReason,
  EditingCycle,
} from './types';
import { parseProposedEdits, sourceContainsMarkup } from './parseProposedEdits';
import { checkProposerDrift } from './checkProposerDrift';
import { validateEditGroups } from './validateEditGroups';
import { parseReviewDecisions } from './parseReviewDecisions';
import { applyAcceptedGroups } from './applyAcceptedGroups';
import { classifyDriftMagnitude } from './recoverDrift';
import { snapDriftToSource } from './snapDriftToSource';
import { buildProposerSystemPrompt, buildProposerUserPrompt } from './proposerPrompt';
import { buildApproverSystemPrompt, buildApproverUserPrompt } from './approverPrompt';
import { buildProposerSystemPromptRewrite, buildProposerUserPromptRewrite } from './proposerPromptRewrite';
import { splitRationaleAndRewrite } from './splitRationaleAndRewrite';
import {
  computeMarkupFromRewrite,
  RewriteParseError,
  DiffEngineError,
  RewriteTooLargeError,
  serializeError,
} from './computeMarkupFromRewrite';
import { coalesceAdjacentGroups } from './coalesceAdjacentGroups';
import { capGroupsByMagnitude } from './capGroupsByMagnitude';

interface InternalIterativeEditInput extends IterativeEditInput {
  llm?: EvolutionLLMClient;
}

export class IterativeEditingAgent extends Agent<
  InternalIterativeEditInput,
  IterativeEditOutput,
  IterativeEditingExecutionDetail
> {
  readonly name: string = 'iterative_editing';
  readonly executionDetailSchema = iterativeEditingExecutionDetailSchema;
  readonly usesLLM = true;

  // Phase 3 sibling-class hook. The Mode B subclass (IterativeEditingRewriteAgent)
  // overrides this to true; the parent's execute() inspects this accessor at the
  // proposer step and branches into the rewrite + diff path. agent_name in the DB
  // comes from `this.name` (Agent.run writes it), so analytics still partition.
  protected get isRewriteMode(): boolean { return false; }

  // Mirrors the DETAIL_VIEW_CONFIGS['iterative_editing'] entry — the entities.test.ts
  // parity test asserts these are field-for-field identical.
  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'parentVariantId', label: 'Parent Variant', type: 'text' },
    { key: 'finalVariantId', label: 'Final Variant', type: 'text' },
    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
    { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
    { key: 'errorPhase', label: 'Error Phase', type: 'badge' },
    { key: 'errorMessage', label: 'Error Message', type: 'text' },
    {
      key: 'config', label: 'Configuration', type: 'object',
      children: [
        { key: 'maxCycles', label: 'Max Cycles', type: 'number' },
        { key: 'editingModel', label: 'Editing Model', type: 'text' },
        { key: 'approverModel', label: 'Approver Model', type: 'text' },
        { key: 'driftRecoveryModel', label: 'Drift Recovery Model', type: 'text' },
        { key: 'perInvocationBudgetUsd', label: 'Per-Invocation Budget', type: 'number', formatter: 'cost' },
      ],
    },
    {
      key: 'cycles', label: 'Edit Cycles', type: 'table',
      columns: [
        { key: 'cycleNumber', label: 'Cycle' },
        { key: 'acceptedCount', label: 'Accepted' },
        { key: 'rejectedCount', label: 'Rejected' },
        { key: 'appliedCount', label: 'Applied' },
        { key: 'sizeRatio', label: 'Size Ratio' },
        { key: 'proposeCostUsd', label: 'Propose $' },
        { key: 'approveCostUsd', label: 'Approve $' },
      ],
    },
    {
      key: 'cycles.0', label: 'Annotated Edits (Cycle 1)', type: 'annotated-edits',
      markupKey: 'cycles.0.proposedMarkup',
      groupsKey: 'cycles.0.proposedGroupsRaw',
      decisionsKey: 'cycles.0.reviewDecisions',
      dropsPreKey: 'cycles.0.droppedPreApprover',
      dropsPostKey: 'cycles.0.droppedPostApprover',
    },
    {
      key: 'ranking', label: 'Ranking (binary search local view)', type: 'object',
      children: [
        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
        { key: 'localPoolSize', label: 'Local Pool Size', type: 'number' },
        { key: 'initialTop15Cutoff', label: 'Initial Top-15% Cutoff', type: 'number' },
        { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
        { key: 'finalLocalUncertainty', label: 'Final Local Uncertainty', type: 'number' },
        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
      ],
    },
    {
      key: 'ranking.comparisons', label: 'Comparisons', type: 'table',
      columns: [
        { key: 'round', label: '#' },
        { key: 'opponentId', label: 'Opponent' },
        { key: 'selectionScore', label: 'Score' },
        { key: 'pWin', label: 'pWin' },
        { key: 'outcome', label: 'Out' },
        { key: 'variantEloAfter', label: 'Elo after' },
        { key: 'variantUncertaintyAfter', label: 'Uncertainty after' },
        { key: 'durationMs', label: 'ms' },
      ],
    },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];

  async execute(
    input: InternalIterativeEditInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<IterativeEditOutput, IterativeEditingExecutionDetail>> {
    const llm = input.llm;
    if (!llm) throw new Error('IterativeEditingAgent: input.llm is required (set usesLLM=true and provide ctx.rawProvider)');

    const cfg = ctx.config as {
      editingModel?: string;
      approverModel?: string;
      driftRecoveryModel?: string;
      generationModel?: string;
      iterationConfigs?: Array<{ agentType?: string; editingMaxCycles?: number; editingProposerSoftCap?: number }>;
    };
    const iterIdx = ctx.iteration - 1;
    const iterCfg = cfg.iterationConfigs?.[iterIdx];

    const generationModel = cfg.generationModel ?? 'gpt-4.1';
    const editingModel = cfg.editingModel ?? generationModel;
    const approverModel = cfg.approverModel ?? editingModel;
    const driftRecoveryModel = cfg.driftRecoveryModel ?? 'gpt-4.1-nano';
    const maxCycles = iterCfg?.editingMaxCycles ?? AGENT_DEFAULT_MAX_CYCLES;
    const perInvocationBudgetUsd = input.perInvocationBudgetUsd;
    const isRewriteMode = this.isRewriteMode;
    const proposerSoftCap = iterCfg?.editingProposerSoftCap ?? 3;

    const cycles: EditingCycle[] = [];
    let stopReason: IterativeEditingStopReason = 'all_cycles_completed';
    let errorPhase: 'propose' | 'parse' | 'approve' | 'recovery' | 'apply' | undefined;
    let errorMessage: string | undefined;
    let finalVariant: Variant | undefined;

    let current: { id: string; text: string } = {
      id: input.parent.id,
      text: input.parent.text,
    };

    // Pre-cycle defense: if the source already contains CriticMarkup-shaped
    // delimiters, the strip-markup pass would corrupt it. Abort cleanly.
    if (sourceContainsMarkup(current.text)) {
      stopReason = 'parse_failed';
      const detail = this.buildDetail({
        parent: input.parent,
        cycles, stopReason, errorPhase: 'parse',
        errorMessage: 'source article already contains CriticMarkup delimiters',
        finalVariantId: undefined,
        editingModel, approverModel, driftRecoveryModel, maxCycles, perInvocationBudgetUsd,
      });
      return { result: { finalVariant: null, surfaced: false, matches: [] }, detail };
    }

    try {
      for (let cycleNumber = 1; cycleNumber <= maxCycles; cycleNumber++) {
        // I2: per-invocation budget check at cycle entry.
        const spentBeforeCycle = ctx.costTracker.getOwnSpent?.() ?? 0;
        if (spentBeforeCycle >= perInvocationBudgetUsd * PER_INVOCATION_BUDGET_ABORT_FRACTION) {
          stopReason = 'invocation_budget_near_exhaustion';
          break;
        }

        // ── Proposer call ──
        const costBeforeProposeCall = ctx.costTracker.getOwnSpent?.() ?? 0;
        const proposerSys = isRewriteMode
          ? buildProposerSystemPromptRewrite(proposerSoftCap)
          : buildProposerSystemPrompt();
        const proposerUser = isRewriteMode
          ? buildProposerUserPromptRewrite(current.text)
          : buildProposerUserPrompt(current.text);
        let proposerOutput: string;
        try {
          proposerOutput = await llm.complete(
            `${proposerSys}\n\n${proposerUser}`,
            'iterative_edit_propose',
            { model: editingModel },
          );
        } catch (err) {
          errorPhase = 'propose';
          errorMessage = err instanceof Error ? err.message : String(err);
          stopReason = 'helper_threw';
          break;
        }
        const proposeCostUsd = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeProposeCall;

        // ── Mode-specific proposer-output processing ──
        // Mode A: proposerOutput is the marked-up article; parse it directly.
        // Mode B: proposerOutput is "## Rationale\n...\n## Rewrite\n...";
        //         split, normalize, run diff engine to PRODUCE the markup, then parse.
        let proposedMarkup: string;
        let modeBRationale: string | undefined;
        let modeBRewriteText: string | undefined;
        let modeBComputedMarkup: string | undefined;
        let modeBNormalizedSource: string | undefined;

        if (isRewriteMode) {
          const split = splitRationaleAndRewrite(proposerOutput);
          modeBRationale = split.rationale;
          // Truncate persisted rewriteText to 8 KB; the in-memory rewrite (used for
          // the diff) keeps full content.
          modeBRewriteText = split.rewrite.slice(0, 8 * 1024);
          if (split.parseFailed && !split.rewrite) {
            stopReason = 'proposer_format_violation';
            errorMessage = 'Proposer output missing both ## Rationale and ## Rewrite sections';
            break;
          }
          let computeResult;
          try {
            computeResult = await computeMarkupFromRewrite(current.text, split.rewrite);
          } catch (e) {
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
            // Persist a partial cycle for forensics.
            const errCtx = e instanceof RewriteParseError || e instanceof DiffEngineError
              ? serializeError(e.originalError)
              : undefined;
            const partialCycle = this.buildCycle({
              cycleNumber, proposedMarkup: '', parseResult: { groups: [], dropped: [], recoveredSource: current.text },
              droppedPreApprover: [], approverGroups: [], reviewDecisions: [],
              droppedPostApprover: [], appliedGroups: [], formatValid: false,
              parentText: current.text,
              proposeCostUsd, approveCostUsd: 0,
              sizeRatio: 1.0,
            });
            cycles.push({
              ...partialCycle,
              proposerMode: 'rewrite',
              rationale: modeBRationale,
              rewriteText: modeBRewriteText,
              errorMessage,
              ...(errCtx ? { errorContext: errCtx } : {}),
            });
            break;
          }
          proposedMarkup = computeResult.markup;
          modeBComputedMarkup = computeResult.markup;
          modeBNormalizedSource = computeResult.normalizedBefore;
          // Use the canonicalized source as the anchor for the rest of the
          // pipeline (parseProposedEdits/applyAcceptedGroups strict-equals
          // contextBefore/contextAfter checks must match).
          current = { ...current, text: computeResult.normalizedBefore };
        } else {
          proposedMarkup = proposerOutput;
        }

        // ── Parse + drift check ──
        const parseResult = parseProposedEdits(proposedMarkup, current.text);

        // Mode B post-parse: coalesce + cap groups before validation.
        if (isRewriteMode) {
          const coalesced = coalesceAdjacentGroups(parseResult.groups, current.text);
          const cap = capGroupsByMagnitude(coalesced, current.text, 10);
          parseResult.groups = cap.kept;
          parseResult.dropped = [...parseResult.dropped, ...cap.dropped];
        }

        // Phase 2: Pre-flight structural rejection (Mode A only — Mode B's diff
        // engine is structurally incapable of producing free-form rewrites).
        if (!isRewriteMode) {
        const lenDelta = Math.abs(parseResult.recoveredSource.length - current.text.length);
        const lenDeltaRatio = lenDelta / Math.max(1, current.text.length);
        if (lenDeltaRatio > 0.10 && parseResult.groups.length < 3) {
          stopReason = 'structural_rewrite';
          cycles.push(this.buildCycle({
            cycleNumber, proposedMarkup, parseResult,
            droppedPreApprover: [...parseResult.dropped],
            approverGroups: [], reviewDecisions: [], droppedPostApprover: [],
            appliedGroups: [], formatValid: false, parentText: current.text,
            proposeCostUsd, approveCostUsd: 0,
            sizeRatio: 1.0,
          }));
          break;
        }
        } // end if (!isRewriteMode) for structural rejection

        // Mode B never enters drift recovery (drift impossible by construction:
        // the diff engine produces markup AGAINST the same normalized source we
        // pass to parseProposedEdits, so recoveredSource matches modulo the
        // remaining whitespace-bridge edge cases handled by Phase 1 fixes).
        const driftResult = isRewriteMode
          ? { drift: false, regions: [] }
          : checkProposerDrift(parseResult.recoveredSource, current.text);

        let approverGroups: typeof parseResult.groups;
        const droppedPreApprover = [...parseResult.dropped];
        let driftRecoveryCostUsd: number | undefined;
        let driftRecoveryDetails: EditingCycle['driftRecovery'] = undefined;
        let workingMarkup = proposedMarkup;

        if (driftResult.drift) {
          const magnitude = classifyDriftMagnitude(driftResult.regions, parseResult.groups);
          if (magnitude === 'major') {
            stopReason = 'proposer_drift_major';
            driftRecoveryDetails = {
              outcome: 'skipped_major_drift',
              regions: driftResult.regions,
              costUsd: 0,
            };
            cycles.push(this.buildCycle({
              cycleNumber, proposedMarkup, parseResult, droppedPreApprover,
              approverGroups: [], reviewDecisions: [], droppedPostApprover: [],
              appliedGroups: [], formatValid: false, parentText: current.text,
              proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd: 0, driftRecoveryDetails,
              sizeRatio: 1.0,
            }));
            break;
          }
          // Minor drift: deterministic snap-to-source. No LLM call.
          const snap = snapDriftToSource({
            regions: driftResult.regions,
            proposedMarkup,
            currentText: current.text,
          });
          driftRecoveryCostUsd = 0;
          if (snap.aborted) {
            // Source slice contained CriticMarkup delimiters — splicing would
            // mint fake edit markers in the re-parse. Treat as unrecoverable.
            driftRecoveryDetails = {
              outcome: 'unrecoverable_residual',
              regions: driftResult.regions,
              classifications: snap.classifications,
              costUsd: 0,
            };
            stopReason = 'proposer_drift_unrecoverable';
            cycles.push(this.buildCycle({
              cycleNumber, proposedMarkup, parseResult, droppedPreApprover,
              approverGroups: [], reviewDecisions: [], droppedPostApprover: [],
              appliedGroups: [], formatValid: false, parentText: current.text,
              proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd: 0, driftRecoveryDetails,
              sizeRatio: 1.0,
            }));
            break;
          }
          driftRecoveryDetails = {
            outcome: 'recovered',
            regions: driftResult.regions,
            classifications: snap.classifications,
            patchedMarkup: snap.patchedMarkup,
            costUsd: 0,
          };
          workingMarkup = snap.patchedMarkup;
          const repatched = parseProposedEdits(workingMarkup, current.text);
          const recheckDrift = checkProposerDrift(repatched.recoveredSource, current.text);
          if (recheckDrift.drift) {
            // Most likely cause: drift offsets were in normalized-stripped-source
            // coordinates but the splice landed in raw-markup coordinates and
            // missed. Abort cleanly rather than emit a corrupted variant. The
            // forensic record uses the snapped workingMarkup so analysts can
            // see what the snap produced and why it failed re-validation.
            stopReason = 'proposer_drift_unrecoverable';
            cycles.push(this.buildCycle({
              cycleNumber, proposedMarkup: workingMarkup, parseResult, droppedPreApprover,
              approverGroups: [], reviewDecisions: [], droppedPostApprover: [],
              appliedGroups: [], formatValid: false, parentText: current.text,
              proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd: 0, driftRecoveryDetails,
              sizeRatio: 1.0,
            }));
            break;
          }
          approverGroups = repatched.groups;
          droppedPreApprover.push(...repatched.dropped);
        } else {
          approverGroups = parseResult.groups;
        }

        // ── Validate (hard rules + size-ratio guardrail) ──
        const validation = validateEditGroups(approverGroups, current.text);
        droppedPreApprover.push(...validation.droppedPreApprover);

        if (validation.sizeExplosion) {
          stopReason = 'article_size_explosion';
          cycles.push(this.buildCycle({
            cycleNumber, proposedMarkup: workingMarkup, parseResult,
            droppedPreApprover, approverGroups: [], reviewDecisions: [],
            droppedPostApprover: [], appliedGroups: [], formatValid: false,
            parentText: current.text,
            proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd, driftRecoveryDetails,
            sizeRatio: 1.5,
          }));
          break;
        }

        if (validation.approverGroups.length === 0) {
          stopReason = parseResult.dropped.some((d) => d.reason === 'invalid_group_number')
            ? 'parse_failed'
            : 'no_edits_proposed';
          cycles.push(this.buildCycle({
            cycleNumber, proposedMarkup: workingMarkup, parseResult,
            droppedPreApprover, approverGroups: [], reviewDecisions: [],
            droppedPostApprover: [], appliedGroups: [], formatValid: false,
            parentText: current.text,
            proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd, driftRecoveryDetails,
            sizeRatio: 1.0,
          }));
          break;
        }

        // ── Approver call ──
        // Mode B: pass the proposer's rationale as priming context (with the
        // red-team caveat in the user prompt builder).
        const costBeforeApproveCall = ctx.costTracker.getOwnSpent?.() ?? 0;
        const approverSys = buildApproverSystemPrompt();
        const approverUser = buildApproverUserPrompt(
          workingMarkup,
          validation.approverGroups,
          isRewriteMode ? modeBRationale : undefined,
        );
        let approverResponse: string;
        try {
          approverResponse = await llm.complete(
            `${approverSys}\n\n${approverUser}`,
            'iterative_edit_review',
            { model: approverModel },
          );
        } catch (err) {
          errorPhase = 'approve';
          errorMessage = err instanceof Error ? err.message : String(err);
          stopReason = 'helper_threw';
          break;
        }
        const approveCostUsd = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeApproveCall;

        const expectedGroupNumbers = validation.approverGroups.map((g) => g.groupNumber);
        const reviewDecisions = parseReviewDecisions(approverResponse, expectedGroupNumbers);

        // ── Apply ──
        const applyResult = applyAcceptedGroups(validation.approverGroups, reviewDecisions, current.text);
        const acceptedCount = reviewDecisions.filter((d) => d.decision === 'accept').length;
        const rejectedCount = reviewDecisions.filter((d) => d.decision === 'reject').length;
        const appliedCount = applyResult.appliedGroups.length;

        const sizeRatio = current.text.length > 0 ? applyResult.newText.length / current.text.length : 1.0;

        const baseCycle = this.buildCycle({
          cycleNumber, proposedMarkup: workingMarkup, parseResult,
          droppedPreApprover,
          approverGroups: validation.approverGroups, reviewDecisions,
          droppedPostApprover: applyResult.droppedPostApprover,
          appliedGroups: applyResult.appliedGroups,
          formatValid: applyResult.formatValid,
          parentText: current.text,
          childText: applyResult.newText !== current.text ? applyResult.newText : undefined,
          proposeCostUsd, approveCostUsd, driftRecoveryCostUsd, driftRecoveryDetails,
          sizeRatio,
          acceptedCount, rejectedCount, appliedCount,
        });
        cycles.push(isRewriteMode
          ? {
              ...baseCycle,
              proposerMode: 'rewrite',
              rationale: modeBRationale,
              rewriteText: modeBRewriteText,
              computedMarkup: modeBComputedMarkup,
            }
          : { ...baseCycle, proposerMode: 'markup' });

        // Suppress unused-var warnings — modeBNormalizedSource is consumed via
        // the `current = { ...current, text: computeResult.normalizedBefore }`
        // assignment earlier; we keep the var for future use (cycle-2 invariance
        // logging) without referencing it here.
        void modeBNormalizedSource;

        if (appliedCount === 0) {
          stopReason = 'all_edits_rejected';
          break;
        }

        if (!applyResult.formatValid) {
          stopReason = 'format_invalid';
          break;
        }

        // Update in-memory current.text for the next cycle (per Decisions §14:
        // intermediates are NOT materialized as Variants).
        current = { id: current.id, text: applyResult.newText };
      }

      // After the loop: materialize the final variant only if any cycle accepted edits.
      if (current.text !== input.parent.text) {
        // Use the createVariant factory rather than spreading input.parent.
        // The spread inherited input.parent.fromArena (true for cross-run pool
        // parents — the typical case), which caused persistRunResults' filter
        // (`pool.filter((v) => !v.fromArena)`) to silently drop the variant
        // before the DB upsert. The factory generates a fresh UUID, omits
        // fromArena, and requires explicit tactic + agentInvocationId so the
        // row threads correctly to its editing invocation.
        // `this.name` distinguishes Mode A ('iterative_editing') vs
        // Mode B ('iterative_editing_rewrite') automatically.
        finalVariant = createVariant({
          text: current.text,
          tactic: this.name,
          iterationBorn: ctx.iteration,
          // Per Decisions §14: the final variant's parent is the ORIGINAL
          // input parent (not cycle-N-1's intermediate text).
          parentIds: [input.parent.id],
          agentInvocationId: ctx.invocationId,
        });
      }
    } catch (err) {
      errorPhase = errorPhase ?? 'propose';
      errorMessage = err instanceof Error ? err.message : String(err);
      stopReason = 'helper_threw';
    }

    // Phase 2 — Post-cycle ranking step (D7: rank ONLY the final emitted variant).
    // Skipped via input-presence gate: when EDITING_RANK_ENABLED='false', the
    // dispatch site (runIterationLoop.ts editing branch) omits initialPool/etc.
    // from input. The agent itself does NOT read process.env (matches GFPA's
    // env-agnostic pattern + I1).
    let rankingDetail: IterativeEditingRankingDetail | null = null;
    let matches: ReadonlyArray<V2Match> = [];
    let surfacedFromRanking: boolean | undefined = undefined;
    let discardReason: { localElo: number; localTop15Cutoff: number } | undefined = undefined;

    const rankingShouldRun =
      finalVariant !== undefined &&
      stopReason !== 'helper_threw' &&
      input.initialPool !== undefined &&
      input.initialRatings !== undefined &&
      input.initialMatchCounts !== undefined &&
      input.cache !== undefined;

    if (rankingShouldRun && finalVariant) {
      // I2 cost snapshot — captures only the ranking-phase delta. rankNewVariant
      // also takes its own internal snapshot via getOwnSpent(); we use the result's
      // rankingCost field rather than re-computing here.
      try {
        // Deep-clone to avoid mutating the caller's iteration-start snapshot maps.
        const localPool: Variant[] = [...(input.initialPool as ReadonlyArray<Variant>)];
        const localRatings = new Map<string, Rating>(input.initialRatings as ReadonlyMap<string, Rating>);
        const localMatchCounts = new Map<string, number>(input.initialMatchCounts as ReadonlyMap<string, number>);
        const completedPairs = new Set<string>();

        const rankResult: RankNewVariantResult = await rankNewVariant({
          variant: finalVariant,
          localPool,
          localRatings,
          localMatchCounts,
          completedPairs,
          cache: input.cache as Map<string, ComparisonResult>,
          llm,
          config: ctx.config as Parameters<typeof rankNewVariant>[0]['config'],
          invocationId: ctx.invocationId,
          logger: ctx.logger,
          costTracker: ctx.costTracker,
        });

        matches = rankResult.rankResult.matches;
        surfacedFromRanking = rankResult.surfaced;
        discardReason = rankResult.discardReason;

        // Detail mirrors GFPA's shape: rename mu→Elo / sigma→Uncertainty handled by
        // schema preprocess; we pass the rankResult.detail's fields through as-is
        // (their names already use the Elo terminology since rankSingleVariantDetail
        // was renamed in the same migration).
        rankingDetail = {
          variantId: rankResult.rankResult.detail.variantId,
          localPoolSize: rankResult.rankResult.detail.localPoolSize,
          localPoolVariantIds: rankResult.rankResult.detail.localPoolVariantIds,
          initialTop15Cutoff: rankResult.rankResult.detail.initialTop15Cutoff,
          comparisons: rankResult.rankResult.detail.comparisons,
          stopReason: rankResult.rankResult.detail.stopReason,
          totalComparisons: rankResult.rankResult.detail.totalComparisons,
          finalLocalElo: rankResult.rankResult.detail.finalLocalElo,
          finalLocalUncertainty: rankResult.rankResult.detail.finalLocalUncertainty,
          finalLocalTop15Cutoff: rankResult.rankResult.detail.finalLocalTop15Cutoff,
          // durationMs is optional in the Zod schema; rankSingleVariant doesn't currently
          // populate it on the runtime detail, so we omit it here. Can be added in a
          // follow-up that threads start/end timestamps through rankSingleVariant.
          cost: rankResult.rankingCost,
        };
      } catch (err) {
        // I3: ranking can throw BudgetExceededError mid-comparison. Treat as helper-threw
        // so partial detail (cycles done so far) is still persisted.
        errorPhase = 'apply'; // closest existing enum value; ranking is a post-cycle phase
        errorMessage = err instanceof Error ? err.message : String(err);
        stopReason = 'helper_threw';
      }
    }

    // D1: surface decision = (final variant emitted) AND (no helper threw) AND
    // (ranking either didn't run OR ranking surfaced=true). Mirrors GFPA's
    // discard-on-budget+below-cutoff policy.
    const surfaced =
      finalVariant !== undefined &&
      stopReason !== 'helper_threw' &&
      (surfacedFromRanking !== false); // `undefined` (ranking skipped) → keep surfaced; `false` → discard

    const detail = this.buildDetail({
      parent: input.parent,
      cycles, stopReason, errorPhase, errorMessage,
      finalVariantId: finalVariant?.id,
      editingModel, approverModel, driftRecoveryModel, maxCycles, perInvocationBudgetUsd,
      surfaced,
      ranking: rankingDetail,
    });

    return {
      result: {
        finalVariant: finalVariant ?? null,
        surfaced,
        matches,
        ...(discardReason !== undefined ? { discardReason } : {}),
      },
      detail,
    };
  }

  protected buildCycle(args: {
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

  protected buildDetail(args: {
    parent: Variant;
    cycles: EditingCycle[];
    stopReason: IterativeEditingStopReason;
    errorPhase?: 'propose' | 'parse' | 'approve' | 'recovery' | 'apply';
    errorMessage?: string;
    finalVariantId?: string;
    editingModel: string;
    approverModel: string;
    driftRecoveryModel: string;
    maxCycles: number;
    perInvocationBudgetUsd: number;
    surfaced?: boolean;
    ranking?: IterativeEditingRankingDetail | null;
  }): IterativeEditingExecutionDetail {
    const cyclesCost = args.cycles.reduce(
      (sum, c) => sum + c.proposeCostUsd + c.approveCostUsd + (c.driftRecoveryCostUsd ?? 0),
      0,
    );
    // Phase 2.5 — ranking cost folds into totalCost so the invocation row's
    // cost_usd matches the sum of all per-purpose splits (cycles + ranking).
    const totalCost = cyclesCost + (args.ranking?.cost ?? 0);
    return {
      detailType: 'iterative_editing',
      parentVariantId: args.parent.id,
      config: {
        maxCycles: args.maxCycles,
        editingModel: args.editingModel,
        approverModel: args.approverModel,
        driftRecoveryModel: args.driftRecoveryModel,
        perInvocationBudgetUsd: args.perInvocationBudgetUsd,
      },
      cycles: args.cycles,
      stopReason: args.stopReason,
      ...(args.errorPhase !== undefined ? { errorPhase: args.errorPhase } : {}),
      ...(args.errorMessage !== undefined ? { errorMessage: args.errorMessage } : {}),
      ...(args.finalVariantId !== undefined ? { finalVariantId: args.finalVariantId } : {}),
      ...(args.surfaced !== undefined ? { surfaced: args.surfaced } : {}),
      ...(args.ranking !== undefined ? { ranking: args.ranking } : {}),
      totalCost,
    };
  }
}
