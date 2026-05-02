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
import {
  AGENT_DEFAULT_MAX_CYCLES,
  PER_INVOCATION_BUDGET_ABORT_FRACTION,
} from './constants';
import type {
  IterativeEditInput,
  IterativeEditOutput,
  IterativeEditingExecutionDetail,
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

  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'parentVariantId', label: 'Parent Variant', type: 'text' },
    { key: 'finalVariantId', label: 'Final Variant', type: 'text' },
    { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
    { key: 'config.maxCycles', label: 'Max Cycles', type: 'number' },
    { key: 'config.editingModel', label: 'Editing Model', type: 'text' },
    { key: 'config.approverModel', label: 'Approver Model', type: 'text' },
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
      return { result: { finalVariant: null, surfaced: false }, detail };
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

    const detail = this.buildDetail({
      parent: input.parent,
      cycles, stopReason, errorPhase, errorMessage,
      finalVariantId: finalVariant?.id,
      editingModel, approverModel, driftRecoveryModel, maxCycles, perInvocationBudgetUsd,
    });

    const surfaced = finalVariant !== undefined && stopReason !== 'helper_threw';
    return {
      result: { finalVariant: finalVariant ?? null, surfaced },
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
  }): IterativeEditingExecutionDetail {
    const totalCost = args.cycles.reduce(
      (sum, c) => sum + c.proposeCostUsd + c.approveCostUsd + (c.driftRecoveryCostUsd ?? 0),
      0,
    );
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
      totalCost,
    };
  }
}
