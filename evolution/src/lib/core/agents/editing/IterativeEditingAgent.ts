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
//   I2. Capture `costBeforeProposeCall` / `costBeforeApproveCall` /
//       `costBeforeRecoveryCall` snapshots BEFORE each helper call so per-purpose
//       cost can be split into execution_detail.cycles[i].{proposeCostUsd,
//       approveCostUsd, driftRecoveryCostUsd}.
//   I3. Write partial `execution_detail` to the invocation row BEFORE re-throwing
//       on any helper failure. The trackInvocations partial-update fix ensures
//       Agent.run()'s catch handler doesn't overwrite our partial detail with null.

import { Agent } from '../../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from '../../types';
import type { Variant, EvolutionLLMClient } from '../../../types';
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
import { recoverDrift } from './recoverDrift';
import { buildProposerSystemPrompt, buildProposerUserPrompt } from './proposerPrompt';
import { buildApproverSystemPrompt, buildApproverUserPrompt } from './approverPrompt';

interface InternalIterativeEditInput extends IterativeEditInput {
  llm?: EvolutionLLMClient;
}

export class IterativeEditingAgent extends Agent<
  InternalIterativeEditInput,
  IterativeEditOutput,
  IterativeEditingExecutionDetail
> {
  readonly name = 'iterative_editing';
  readonly executionDetailSchema = iterativeEditingExecutionDetailSchema;
  readonly usesLLM = true;

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
      iterationConfigs?: Array<{ agentType?: string; editingMaxCycles?: number }>;
    };
    const iterIdx = ctx.iteration - 1;
    const iterCfg = cfg.iterationConfigs?.[iterIdx];

    const generationModel = cfg.generationModel ?? 'gpt-4.1';
    const editingModel = cfg.editingModel ?? generationModel;
    const approverModel = cfg.approverModel ?? editingModel;
    const driftRecoveryModel = cfg.driftRecoveryModel ?? 'gpt-4.1-nano';
    const maxCycles = iterCfg?.editingMaxCycles ?? AGENT_DEFAULT_MAX_CYCLES;
    const perInvocationBudgetUsd = input.perInvocationBudgetUsd;

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
        const proposerSys = buildProposerSystemPrompt();
        const proposerUser = buildProposerUserPrompt(current.text);
        let proposedMarkup: string;
        try {
          proposedMarkup = await llm.complete(
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

        // ── Parse + drift check ──
        const parseResult = parseProposedEdits(proposedMarkup, current.text);

        // Phase 2: Pre-flight structural rejection. If the proposer emitted a
        // free-form rewrite (recovered source diverges in length from the source
        // by >10%) AND yields fewer than 3 markup groups, the cycle is hopeless —
        // skip the drift-recovery LLM call (saves ~$0.0001/cycle and produces
        // clearer telemetry than `proposer_drift_major`).
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

        const driftResult = checkProposerDrift(parseResult.recoveredSource, current.text);

        let approverGroups: typeof parseResult.groups;
        let droppedPreApprover = [...parseResult.dropped];
        let driftRecoveryCostUsd: number | undefined;
        let driftRecoveryDetails: EditingCycle['driftRecovery'] = undefined;
        let workingMarkup = proposedMarkup;

        if (driftResult.drift) {
          // Attempt minor-drift recovery.
          const costBeforeRecoveryCall = ctx.costTracker.getOwnSpent?.() ?? 0;
          const recovery = await recoverDrift({
            regions: driftResult.regions,
            proposedMarkup,
            currentText: current.text,
            groups: parseResult.groups,
            deps: {
              callLlm: (prompt, label) => llm.complete(prompt, label, { model: driftRecoveryModel }),
              measureCost: () => (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeRecoveryCall,
              env: process.env as Record<string, string | undefined>,
            },
          });
          driftRecoveryCostUsd = recovery.costUsd;
          driftRecoveryDetails = {
            outcome: recovery.outcome,
            regions: recovery.regions,
            classifications: recovery.classifications,
            patchedMarkup: recovery.patchedMarkup,
            costUsd: recovery.costUsd,
          };

          if (recovery.outcome === 'recovered' && recovery.patchedMarkup) {
            workingMarkup = recovery.patchedMarkup;
            const repatched = parseProposedEdits(workingMarkup, current.text);
            const recheckDrift = checkProposerDrift(repatched.recoveredSource, current.text);
            if (recheckDrift.drift) {
              stopReason = 'proposer_drift_unrecoverable';
              cycles.push(this.buildCycle({
                cycleNumber, proposedMarkup, parseResult, droppedPreApprover,
                approverGroups: [], reviewDecisions: [], droppedPostApprover: [],
                appliedGroups: [], formatValid: false, parentText: current.text,
                proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd, driftRecoveryDetails,
                sizeRatio: 1.0,
              }));
              break;
            }
            approverGroups = repatched.groups;
            droppedPreApprover.push(...repatched.dropped);
          } else if (recovery.outcome === 'unrecoverable_intentional') {
            stopReason = 'proposer_drift_intentional';
            cycles.push(this.buildCycle({
              cycleNumber, proposedMarkup, parseResult, droppedPreApprover,
              approverGroups: [], reviewDecisions: [], droppedPostApprover: [],
              appliedGroups: [], formatValid: false, parentText: current.text,
              proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd, driftRecoveryDetails,
              sizeRatio: 1.0,
            }));
            break;
          } else if (recovery.outcome === 'unrecoverable_residual') {
            stopReason = 'proposer_drift_unrecoverable';
            cycles.push(this.buildCycle({
              cycleNumber, proposedMarkup, parseResult, droppedPreApprover,
              approverGroups: [], reviewDecisions: [], droppedPostApprover: [],
              appliedGroups: [], formatValid: false, parentText: current.text,
              proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd, driftRecoveryDetails,
              sizeRatio: 1.0,
            }));
            break;
          } else {
            // skipped_major_drift
            stopReason = 'proposer_drift_major';
            cycles.push(this.buildCycle({
              cycleNumber, proposedMarkup, parseResult, droppedPreApprover,
              approverGroups: [], reviewDecisions: [], droppedPostApprover: [],
              appliedGroups: [], formatValid: false, parentText: current.text,
              proposeCostUsd, approveCostUsd: 0, driftRecoveryCostUsd, driftRecoveryDetails,
              sizeRatio: 1.0,
            }));
            break;
          }
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
        const costBeforeApproveCall = ctx.costTracker.getOwnSpent?.() ?? 0;
        const approverSys = buildApproverSystemPrompt();
        const approverUser = buildApproverUserPrompt(workingMarkup, validation.approverGroups);
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

        cycles.push(this.buildCycle({
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
        }));

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
        finalVariant = {
          ...input.parent,
          text: current.text,
          // The parent of the final variant is the original input parent (NOT cycle-N-1's
          // intermediate) per Decisions §14.
          parentIds: [input.parent.id],
        } as Variant;
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

  private buildCycle(args: {
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

  private buildDetail(args: {
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
