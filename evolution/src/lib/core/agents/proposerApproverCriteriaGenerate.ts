// ProposerApproverCriteriaGenerateAgent: single-cycle propose/forward-approve/mirror-approve/apply
// agent for criteria-driven generation. The agent's distinctive feature is the **mirror approver**
// bias-mitigation pass — the approver runs twice, once on the original proposal and once on a
// sign-flipped version against the article in the post-apply state. APPLY iff
// (forward=ACCEPT, mirror=REJECT) — strict binary, no confidence-graded fallback.
//
// LOAD-BEARING INVARIANTS (mirrored from IterativeEditingAgent + legacy criteria wrapper):
//   1. Inner LLM helpers use input.llm directly. No nested Agent.run().
//   2. Cost-before-call snapshots before each helper call so per-purpose cost split fills
//      execution_detail.cycles[0].{proposeCostUsd, approveForwardCostUsd, approveMirrorCostUsd}.
//   3. Write partial execution_detail BEFORE re-throwing on any helper failure.

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from '../types';
import type { ExecutionDetailBase, EvolutionLLMClient, LLMCompletionOptions, Variant } from '../../types';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';
import { proposerApproverCriteriaGenerateExecutionDetailSchema } from '../../schemas';
import { DETAIL_VIEW_CONFIGS } from '../detailViewConfigs';
import { updateInvocation } from '../../pipeline/infra/trackInvocations';
import { registerAttributionExtractor } from '../../metrics/attributionExtractors';
import { createVariant } from '../../types';
import { sentenceVerbatimOverlap } from '../../shared/sentenceOverlap';
import { parseProposedEdits } from './editing/parseProposedEdits';
import { validateEditGroups, DEFAULT_LENGTH_CAP_RATIO } from './editing/validateEditGroups';
import { parseReviewDecisions } from './editing/parseReviewDecisions';
import { applyAcceptedGroups } from './editing/applyAcceptedGroups';
import { renderMirrorMarkup } from './editing/mirrorEdits';
import {
  buildEvaluateAndSuggestPrompt,
  parseEvaluateAndSuggest,
  extractScores,
  type EvaluateCriteriaInput,
  type EvaluateCriteriaOutput,
  type ParsedScore,
  type ParsedSuggestion,
  type ParsedEvaluateAndSuggest,
  type CriterionRow,
  EvaluateAndSuggestLLMError,
  EvaluateAndSuggestParseError,
} from './evaluateCriteriaThenGenerateFromPreviousArticle';
import { rankNewVariant, type RankNewVariantResult } from '../../pipeline/loop/rankNewVariant';
import { validateFormat } from '../../shared/enforceVariantFormat';
import type { z } from 'zod';
import type { EditingGroup, EditingReviewDecision } from './editing/types';

/** Local mirror decision type that allows `null` for short-circuit / parse-fail cases. */
type MirrorDecision = Omit<EditingReviewDecision, 'decision'> & { decision: 'accept' | 'reject' | null };

export type ProposerApproverExecutionDetail =
  z.infer<typeof proposerApproverCriteriaGenerateExecutionDetailSchema>
  & ExecutionDetailBase;

// ─── Prompt builders ────────────────────────────────────────────

const PROPOSER_SOFT_RULES = [
  'Preserve quotes, citations, and URLs exactly as they appear in the original.',
  'Do not introduce new headings or modify existing heading lines.',
  'Prefer one-sentence edits over multi-sentence rewrites.',
  'Do not edit text inside code fences (```).',
  "Preserve the author's voice, tone, and reading level.",
  'Avoid edits whose newText reiterates ideas, phrases, or arguments already present elsewhere in the article. Each edit should introduce or strengthen a distinct idea, not duplicate existing content.',
  "Preserve transition phrases and connective words at paragraph boundaries; do not delete or replace opening transitions like 'However,' 'Therefore,' or 'In contrast.'",
  'Keep edits concise; aim to preserve article length within ±10% of the original.',
];

const SYNTAX_DOCS = `Use any of these CriticMarkup forms for each atomic edit:

  Insertion:                     {++ inserted text ++}
  Deletion:                      {-- deleted text --}
  Substitution (inline form):    {~~ old text ~> new text ~~}
  Substitution (paired form):    {~~ old text ~~}{++ new text ++}

Tag a span with [#N] (e.g. {++ [#1] ... ++}) to force grouping across non-adjacent spans. Adjacent spans (no paragraph break between) auto-group.

DO NOT modify any text outside your markup spans. The reviewer will discard ALL your edits if your output, with markup stripped, does not match the source byte-for-byte.`;

function buildProposerSystemPrompt(): string {
  return [
    'You propose edits to an article addressing specific evaluation feedback. Your output is the FULL ARTICLE BODY VERBATIM with inline CriticMarkup edits.',
    '',
    'BIAS TOWARD PROPOSING MORE EDITS, NOT FEWER. A separate approver pass reviews every group you propose and rejects low-value or risky candidates, so the cost of an extra proposal is low and the cost of withholding a useful one is high. Address EVERY weakness listed below, and propose multiple alternate edit groups where a weakness admits more than one plausible fix — the approver decides which ship, not you. Two cautious edits is rarely the right answer.',
    '',
    'Soft rules — follow these unless the edit demonstrably improves the article:',
    ...PROPOSER_SOFT_RULES.map((r, i) => `  ${i + 1}. ${r}`),
    '',
    SYNTAX_DOCS,
    '',
    'Output the marked-up article only. No commentary, no summary, no preamble.',
  ].join('\n');
}

function buildProposerUserPrompt(
  currentText: string,
  criteria: ReadonlyArray<CriterionRow>,
  scoresParsed: ParsedScore[],
  suggestions: ReadonlyArray<ParsedSuggestion>,
): string {
  const scoresBlock = scoresParsed.map((s) => `  ${s.criteriaName}: ${s.score}/${s.maxRating}`).join('\n');
  const weakestBlock = suggestions.map((s, i) =>
    `  ${i + 1}. ${s.criteriaName}\n     Example: "${s.examplePassage}"\n     Issue: ${s.whatNeedsAddressing}\n     Fix: ${s.suggestedFix}`,
  ).join('\n');

  return [
    `## Evaluation Results`,
    '',
    'Criteria scored:',
    scoresBlock,
    '',
    'Weakest criteria & suggested fixes (target THESE with your edits):',
    weakestBlock,
    '',
    '─────────────────────────────────────',
    '## Article to edit',
    '',
    currentText,
  ].join('\n');
}

function buildApproverSystemPrompt(includeGuardrailRubric: boolean): string {
  const lines: string[] = [
    'You are reviewing edits to an article. Be CONSERVATIVE: only accept edits that demonstrably improve the article.',
    '',
    'For each numbered edit group, decide accept or reject and provide a one-sentence reason.',
    '',
    'Reject when ANY of these hold:',
    "  - The edit introduces or removes content that changes the article's meaning.",
    '  - The edit modifies a quote, citation, or URL.',
    '  - The edit alters a heading line.',
    "  - The edit's benefit is unclear or marginal.",
    '  - The edit reduces clarity or readability.',
  ];
  if (includeGuardrailRubric) {
    lines.push(
      '  - REDUNDANCY: the edit introduces ideas, phrasing, or examples that already appear elsewhere in the article.',
      '  - FLOW: the edit removes or replaces a transition phrase at a paragraph boundary, breaking connective tissue.',
      '  - LENGTH: the edit, in aggregate with other edits, would push the article significantly past ±10% of original length.',
    );
  }
  lines.push(
    '',
    'Accept when ALL of these hold:',
    '  - The edit clearly improves the targeted criterion.',
    "  - The edit preserves the author's voice, tone, and reading level.",
    "  - The edit's benefit is greater than the risk of introducing a regression.",
    '',
    'Output ONE JSON line per group:',
  );
  if (includeGuardrailRubric) {
    lines.push(
      '  {"groupNumber": N, "decision": "accept"|"reject", "reason": "<one sentence>", "redundancy_violation": <bool>, "flow_violation": <bool>, "length_violation": <bool>}',
    );
  } else {
    lines.push('  {"groupNumber": N, "decision": "accept"|"reject", "reason": "<one sentence>"}');
  }
  lines.push('', 'No commentary, no summary. JSONL only.');
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function buildApproverUserPrompt(
  proposedMarkup: string,
  approverGroups: EditingGroup[],
  criteria: ReadonlyArray<CriterionRow>,
  scoresParsed: ParsedScore[],
  weakestCriteriaNames: ReadonlyArray<string>,
  isMirrorPass: boolean,
): string {
  const summary = approverGroups.map((g) => {
    const edits = g.atomicEdits.map((e) => {
      if (e.kind === 'insert') return `  insert: "${truncate(e.newText, 80)}"`;
      if (e.kind === 'delete') return `  delete: "${truncate(e.oldText, 80)}"`;
      return `  replace: "${truncate(e.oldText, 60)}" → "${truncate(e.newText, 60)}"`;
    }).join('\n');
    return `[#${g.groupNumber}] ${g.atomicEdits.length} atomic edit${g.atomicEdits.length === 1 ? '' : 's'}:\n${edits}`;
  }).join('\n\n');

  const scoresBlock = scoresParsed.map((s) => `  ${s.criteriaName}: ${s.score}/${s.maxRating}`).join('\n');

  const lines: string[] = [];
  if (isMirrorPass) {
    lines.push(
      '⚠️ MIRROR PASS: These edits invert the proposed direction (insertions become deletions, etc.) and apply to the article AFTER the original proposal was applied. Your job is to evaluate whether the ORIGINAL direction (the proposed end-state) should be preserved. Reject mirror edits whose proposed end-state should be preserved.',
      '',
    );
  }
  lines.push(
    '## Evaluation Context',
    '',
    'Criteria scored:',
    scoresBlock,
    '',
    `Weakest criteria targeted: ${weakestCriteriaNames.join(', ') || '(none)'}`,
    '',
    '─────────────────────────────────────',
    '## Marked-up article',
    '',
    proposedMarkup,
    '',
    '─────────────────────────────────────',
    '## Edit groups to review',
    '',
    summary,
  );
  return lines.join('\n');
}

// ─── Agent class ────────────────────────────────────────────────

export interface ProposerApproverInput extends EvaluateCriteriaInput {
  /** Length cap ratio (default DEFAULT_LENGTH_CAP_RATIO = 1.10). */
  lengthCapRatio?: number;
  /** Redundancy Jaccard threshold (default 0.35). */
  redundancyJaccardThreshold?: number;
  /** Whether to run the mirror approver pass (default true). */
  includesMirrorApprover?: boolean;
}

export class ProposerApproverCriteriaGenerateAgent extends Agent<
  ProposerApproverInput,
  EvaluateCriteriaOutput,
  ProposerApproverExecutionDetail
> {
  readonly name = 'proposer_approver_criteria_generate';
  readonly executionDetailSchema = proposerApproverCriteriaGenerateExecutionDetailSchema;

  getAttributionDimension(detail: ProposerApproverExecutionDetail): string | null {
    const weakest = detail?.weakestCriteriaNames;
    if (!Array.isArray(weakest) || weakest.length === 0) return null;
    const primary = weakest[0];
    return typeof primary === 'string' && primary.length > 0 && !primary.includes(':') ? primary : null;
  }

  readonly detailViewConfig: DetailFieldDef[] =
    DETAIL_VIEW_CONFIGS.proposer_approver_criteria_generate!;

  async execute(
    input: ProposerApproverInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<EvaluateCriteriaOutput, ProposerApproverExecutionDetail>> {
    const llm = input.llm!;

    // (a) Validate input + compute effectiveWeakestK
    if (input.criteria.length === 0) {
      const partial: ProposerApproverExecutionDetail = {
        detailType: 'proposer_approver_criteria_generate',
        tactic: 'criteria_driven_propose_approve',
        weakestCriteriaIds: [],
        weakestCriteriaNames: [],
        cycles: [],
        totalCost: 0,
        surfaced: false,
      };
      if (ctx.invocationId) {
        await updateInvocation(ctx.db, ctx.invocationId, {
          cost_usd: 0,
          success: false,
          execution_detail: partial as unknown as Record<string, unknown>,
        });
      }
      throw new Error('No active criteria resolved for iteration');
    }

    const effectiveWeakestK = Math.min(input.weakestK, input.criteria.length);
    const lengthCapRatio = input.lengthCapRatio ?? DEFAULT_LENGTH_CAP_RATIO;
    const redundancyJaccardThreshold = input.redundancyJaccardThreshold ?? 0.35;
    const includesMirrorApprover = input.includesMirrorApprover ?? true;

    // Resolve per-purpose models. Mirrors IterativeEditingAgent's pattern so a
    // strategy can route the proposer/approver to a stronger model than the
    // initial-generate iteration. Eval reuses generationModel (consistent with
    // the legacy criteria wrapper). Proposer prefers editingModel; both
    // approvers prefer approverModel. All fall back to generationModel.
    const cfg = ctx.config as { editingModel?: string; approverModel?: string };
    const proposerModel = (cfg.editingModel ?? ctx.config.generationModel) as LLMCompletionOptions['model'];
    const approverResolvedModel = (cfg.approverModel ?? cfg.editingModel ?? ctx.config.generationModel) as LLMCompletionOptions['model'];

    // (b) Eval + suggest call
    const evalPrompt = buildEvaluateAndSuggestPrompt(input.parentText, input.criteria, effectiveWeakestK);
    const costBeforeEval = ctx.costTracker.getOwnSpent?.() ?? 0;
    const evalStart = Date.now();
    let evalResponse: string;
    try {
      evalResponse = await llm.complete(evalPrompt, 'evaluate_and_suggest', {
        model: ctx.config.generationModel as LLMCompletionOptions['model'],
        invocationId: ctx.invocationId,
      });
    } catch (err) {
      // I3: persist partial detail before re-throwing so the invocation row
      // captures cost incurred and which helper failed.
      const partialEvalCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeEval;
      const partialEvalDurationMs = Date.now() - evalStart;
      if (ctx.invocationId) {
        const partial: ProposerApproverExecutionDetail = {
          detailType: 'proposer_approver_criteria_generate',
          tactic: 'criteria_driven_propose_approve',
          weakestCriteriaIds: [],
          weakestCriteriaNames: [],
          evaluateAndSuggest: {
            criteriaScored: [],
            suggestions: [],
            durationMs: partialEvalDurationMs,
            cost: partialEvalCost,
          },
          cycles: [],
          totalCost: partialEvalCost,
          surfaced: false,
        };
        try {
          await updateInvocation(ctx.db, ctx.invocationId, {
            cost_usd: partialEvalCost,
            success: false,
            execution_detail: partial as unknown as Record<string, unknown>,
          });
        } catch (writeErr) {
          // Persist failure must not mask the original LLM error. Log + continue
          // so the EvaluateAndSuggestLLMError below still propagates.
          ctx.logger.warn('I3 partial-detail write failed', {
            phaseName: 'evaluate_and_suggest',
            error: writeErr instanceof Error ? writeErr.message : String(writeErr),
          });
        }
      }
      throw new EvaluateAndSuggestLLMError(
        `Evaluate+suggest LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const evalCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeEval;
    const evalDurationMs = Date.now() - evalStart;

    // First-pass: scores
    const splitIdx = evalResponse.search(/^###\s+Suggestion/m);
    const scoreSection = splitIdx >= 0 ? evalResponse.slice(0, splitIdx) : evalResponse;
    const scoresParsed = extractScores(scoreSection, input.criteria);
    if (scoresParsed.length === 0) {
      throw new EvaluateAndSuggestParseError('zero valid score lines', evalResponse.slice(0, 8000));
    }

    // Identify weakest set
    const sortedByNormalizedScore = [...scoresParsed].sort((a, b) => {
      const aNorm = (a.score - a.minRating) / (a.maxRating - a.minRating);
      const bNorm = (b.score - b.minRating) / (b.maxRating - b.minRating);
      return aNorm - bNorm;
    });
    const weakestKEntries = sortedByNormalizedScore.slice(0, effectiveWeakestK);
    const weakestCriteriaIds = weakestKEntries.map((e) => e.criteriaId);
    const weakestCriteriaNames = weakestKEntries.map((e) => e.criteriaName);

    // Second-pass: suggestions
    let parsed: ParsedEvaluateAndSuggest;
    try {
      parsed = parseEvaluateAndSuggest(evalResponse, input.criteria, weakestCriteriaIds);
    } catch (err) {
      throw err;
    }

    // (c) Proposer call
    const proposerSystem = buildProposerSystemPrompt();
    const proposerUser = buildProposerUserPrompt(input.parentText, input.criteria, scoresParsed, parsed.suggestions);
    const proposerPrompt = `${proposerSystem}\n\n${proposerUser}`;
    const costBeforePropose = ctx.costTracker.getOwnSpent?.() ?? 0;
    let proposerOutput: string;
    try {
      proposerOutput = await llm.complete(proposerPrompt, 'criteria_proposer', {
        model: proposerModel,
        invocationId: ctx.invocationId,
      });
    } catch (err) {
      // I3: persist partial detail (eval+suggest results captured) before re-throwing.
      const partialProposeCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforePropose;
      const partialTotal = evalCost + partialProposeCost;
      if (ctx.invocationId) {
        const partial: ProposerApproverExecutionDetail = {
          detailType: 'proposer_approver_criteria_generate',
          tactic: 'criteria_driven_propose_approve',
          weakestCriteriaIds,
          weakestCriteriaNames,
          evaluateAndSuggest: {
            criteriaScored: parsed.criteriaScored,
            suggestions: parsed.suggestions,
            ...(parsed.droppedSuggestions.length > 0 && { droppedSuggestions: parsed.droppedSuggestions }),
            durationMs: evalDurationMs,
            cost: evalCost,
          },
          cycles: [],
          totalCost: partialTotal,
          surfaced: false,
        };
        try {
          await updateInvocation(ctx.db, ctx.invocationId, {
            cost_usd: partialTotal,
            success: false,
            execution_detail: partial as unknown as Record<string, unknown>,
          });
        } catch (writeErr) {
          ctx.logger.warn('I3 partial-detail write failed', {
            phaseName: 'criteria_proposer',
            error: writeErr instanceof Error ? writeErr.message : String(writeErr),
          });
        }
      }
      throw new Error(`Proposer LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const proposeCostUsd = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforePropose;

    // (d) Parse + validate
    const parseResult = parseProposedEdits(proposerOutput, input.parentText);
    const proposedGroupsRaw = parseResult.groups.length;
    const validation = validateEditGroups(parseResult.groups, input.parentText, {
      lengthCapRatio,
      redundancyJaccardThreshold,
      flowGuardrailEnabled: true,
    });
    const droppedPreApprover = validation.droppedPreApprover.map((d) => ({
      groupNumber: d.groupNumber,
      reason: d.reason,
    }));
    const approverGroups = validation.approverGroups;

    // (e) Forward approver call
    const approverSystem = buildApproverSystemPrompt(true);
    const approverUserForward = buildApproverUserPrompt(
      proposerOutput, approverGroups, input.criteria, scoresParsed, weakestCriteriaNames, false,
    );
    const forwardPrompt = `${approverSystem}\n\n${approverUserForward}`;
    const costBeforeForward = ctx.costTracker.getOwnSpent?.() ?? 0;
    let forwardOutput: string;
    try {
      forwardOutput = await llm.complete(forwardPrompt, 'criteria_forward_approver', {
        model: approverResolvedModel,
        invocationId: ctx.invocationId,
      });
    } catch (err) {
      // I3: persist partial detail (eval + propose + parse/validate captured) before re-throwing.
      const partialForwardCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeForward;
      const partialTotal = evalCost + proposeCostUsd + partialForwardCost;
      if (ctx.invocationId) {
        const partial: ProposerApproverExecutionDetail = {
          detailType: 'proposer_approver_criteria_generate',
          tactic: 'criteria_driven_propose_approve',
          weakestCriteriaIds,
          weakestCriteriaNames,
          evaluateAndSuggest: {
            criteriaScored: parsed.criteriaScored,
            suggestions: parsed.suggestions,
            ...(parsed.droppedSuggestions.length > 0 && { droppedSuggestions: parsed.droppedSuggestions }),
            durationMs: evalDurationMs,
            cost: evalCost,
          },
          cycles: [{
            proposedGroupsRaw,
            droppedPreApprover,
            approverGroups: approverGroups.length,
            forwardDecisions: [],
            mirrorDecisions: [],
            appliedGroups: 0,
            droppedPostApprover: [],
            proposeCostUsd,
            approveForwardCostUsd: partialForwardCost,
            approveMirrorCostUsd: 0,
          }],
          totalCost: partialTotal,
          surfaced: false,
        };
        try {
          await updateInvocation(ctx.db, ctx.invocationId, {
            cost_usd: partialTotal,
            success: false,
            execution_detail: partial as unknown as Record<string, unknown>,
          });
        } catch (writeErr) {
          ctx.logger.warn('I3 partial-detail write failed', {
            phaseName: 'criteria_forward_approver',
            error: writeErr instanceof Error ? writeErr.message : String(writeErr),
          });
        }
      }
      throw new Error(`Forward approver LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const approveForwardCostUsd = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeForward;

    const forwardDecisions = parseReviewDecisions(
      forwardOutput,
      approverGroups.map((g) => g.groupNumber),
    );

    // (f) Mirror approver call (optional, with short-circuit for forward-rejected groups)
    const mirrorDecisions: MirrorDecision[] = [];
    let approveMirrorCostUsd = 0;
    let mirrorAbortReason: 'a_prime_format_invalid' | 'mirror_parse_null' | undefined;
    // Diagnostic block populated when the A' format gate aborts; lets us debug
    // without one-off scripts. Bounded to keep execution_detail small.
    let formatGateDiagnostic: { newIssues: string[]; parentIssues: string[]; aPrimeArticleSnippet: string } | undefined;

    const forwardAcceptedGroups = approverGroups.filter((g) =>
      forwardDecisions.find((d) => d.groupNumber === g.groupNumber)?.decision === 'accept',
    );

    if (includesMirrorApprover && forwardAcceptedGroups.length > 0) {
      // Mirror short-circuit: only run mirror on forward-accepted groups.
      // Forward-rejected groups get null mirror decisions (drop).
      const { mirrorArticleA, mirrorMarkupString, mirrorGroups: mGroups } = renderMirrorMarkup(
        input.parentText, forwardAcceptedGroups,
      );

      // A' format gate (relative). The proposer's edits shouldn't make format
      // WORSE, but the parent itself may already fail validation (e.g. seed
      // generation duplicated the H1 title — observed at 74% rate in the
      // 2026-05-08 staging runs). Compare A' issues against parent issues:
      // only abort when A' introduces NEW issues that weren't already present.
      const parentFormatResult = validateFormat(input.parentText);
      const aPrimeFormatResult = validateFormat(mirrorArticleA);
      const newFormatIssues = aPrimeFormatResult.issues.filter(
        (issue) => !parentFormatResult.issues.includes(issue),
      );
      if (newFormatIssues.length > 0) {
        mirrorAbortReason = 'a_prime_format_invalid';
        // Persist diagnostic data so we can debug future failures without
        // one-off scripts. Truncated to keep execution_detail bounded.
        formatGateDiagnostic = {
          newIssues: newFormatIssues,
          parentIssues: parentFormatResult.issues,
          aPrimeArticleSnippet: mirrorArticleA.slice(0, 1000),
        };
        // Mark all forward-accepted as null mirror (drop via aggregator).
        for (const g of forwardAcceptedGroups) {
          mirrorDecisions.push({ groupNumber: g.groupNumber, decision: null, reason: 'a_prime_format_invalid' });
        }
      } else {
        const approverUserMirror = buildApproverUserPrompt(
          mirrorMarkupString, mGroups, input.criteria, scoresParsed, weakestCriteriaNames, true,
        );
        const mirrorPrompt = `${approverSystem}\n\n${approverUserMirror}`;
        const costBeforeMirror = ctx.costTracker.getOwnSpent?.() ?? 0;
        try {
          const mirrorOutput = await llm.complete(mirrorPrompt, 'criteria_mirror_approver', {
            model: approverResolvedModel,
            invocationId: ctx.invocationId,
          });
          const parsedMirror = parseReviewDecisions(mirrorOutput, mGroups.map((g) => g.groupNumber));
          if (parsedMirror.length === 0) {
            mirrorAbortReason = 'mirror_parse_null';
            for (const g of forwardAcceptedGroups) {
              mirrorDecisions.push({ groupNumber: g.groupNumber, decision: null, reason: 'mirror_parse_null' });
            }
          } else {
            for (const d of parsedMirror) mirrorDecisions.push(d);
          }
        } catch (err) {
          ctx.logger.warn('Mirror approver LLM call failed; treating all as drop', {
            phaseName: 'mirror_approver',
            error: err instanceof Error ? err.message : String(err),
          });
          mirrorAbortReason = 'mirror_parse_null';
          for (const g of forwardAcceptedGroups) {
            mirrorDecisions.push({ groupNumber: g.groupNumber, decision: null, reason: 'mirror_llm_error' });
          }
        } finally {
          // Capture mirror cost regardless of whether complete()/parse succeeded —
          // a partial provider response can incur cost before throwing.
          approveMirrorCostUsd = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeMirror;
        }
      }
    }

    // Forward-rejected groups: add null mirror decisions for telemetry completeness.
    for (const g of approverGroups) {
      const fwd = forwardDecisions.find((d) => d.groupNumber === g.groupNumber);
      if (fwd?.decision !== 'accept' && !mirrorDecisions.find((d) => d.groupNumber === g.groupNumber)) {
        mirrorDecisions.push({
          groupNumber: g.groupNumber,
          decision: null,
          reason: 'short_circuited_forward_rejected',
        });
      }
    }

    // (g) Aggregator: APPLY iff (forward=ACCEPT, mirror=REJECT)
    const finalAcceptedDecisions: EditingReviewDecision[] = [];
    const droppedPostApprover: Array<{ groupNumber: number; reason: string }> = [];
    for (const g of approverGroups) {
      const fwd = forwardDecisions.find((d) => d.groupNumber === g.groupNumber);
      const mir = mirrorDecisions.find((d) => d.groupNumber === g.groupNumber);
      if (fwd?.decision === 'accept' && mir?.decision === 'reject') {
        finalAcceptedDecisions.push({ groupNumber: g.groupNumber, decision: 'accept', reason: fwd.reason });
      } else {
        let reason: string;
        if (fwd?.decision !== 'accept') reason = 'aggregate_drop_forward_reject';
        else if (mir?.decision === 'accept') reason = 'aggregate_drop_both_accept';
        else if (mir?.decision === null && mir?.reason === 'short_circuited_forward_rejected') reason = 'aggregate_drop_mirror_null_short_circuit';
        else if (mir?.decision === null) reason = 'aggregate_drop_mirror_null_parse_fail';
        else reason = 'aggregate_drop_other';
        droppedPostApprover.push({ groupNumber: g.groupNumber, reason });
      }
    }

    // (h) Apply
    const applyResult = applyAcceptedGroups(approverGroups, finalAcceptedDecisions, input.parentText);
    const finalText = applyResult.newText;
    const appliedCount = applyResult.appliedGroups.length;

    // Compute mirrorAgreementRate = appliedGroups / approverGroups
    const mirrorAgreementRate = approverGroups.length > 0 ? appliedCount / approverGroups.length : 0;

    // (i) Compute sentenceVerbatimRatio
    let sentenceVerbatimRatio: number | undefined;
    try {
      sentenceVerbatimRatio = sentenceVerbatimOverlap(input.parentText, finalText).ratio;
    } catch (err) {
      ctx.logger.warn('sentenceVerbatimOverlap compute failed', {
        phaseName: 'sentence_overlap',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // (j) Build final variant
    const finalVariant: Variant = createVariant({
      text: finalText,
      tactic: 'criteria_driven_propose_approve',
      iterationBorn: ctx.iteration ?? 0,
      parentIds: [input.parentVariantId],
      agentInvocationId: ctx.invocationId,
      criteriaSetUsed: input.criteriaIds,
      weakestCriteriaIds,
      sentenceVerbatimRatio,
    });

    // (k) Rank
    let surfacedFromRanking: boolean | undefined;
    let rankingMatches: V2Match[] = [];
    let rankingDetail: ProposerApproverExecutionDetail['ranking'];
    let rankingCost = 0;
    const rankingShouldRun = input.initialPool && input.initialRatings && input.initialMatchCounts && input.cache;
    if (rankingShouldRun) {
      try {
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

        rankingMatches = rankResult.rankResult.matches;
        surfacedFromRanking = rankResult.surfaced;
        rankingCost = rankResult.rankingCost;
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
          cost: rankResult.rankingCost,
        };
      } catch (err) {
        ctx.logger.warn('Post-cycle ranking failed', {
          phaseName: 'ranking',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const surfaced = surfacedFromRanking !== false;
    const totalCost = evalCost + proposeCostUsd + approveForwardCostUsd + approveMirrorCostUsd + rankingCost;

    const detail: ProposerApproverExecutionDetail = {
      detailType: 'proposer_approver_criteria_generate',
      variantId: finalVariant.id,
      tactic: 'criteria_driven_propose_approve',
      weakestCriteriaIds,
      weakestCriteriaNames,
      surfaced,
      evaluateAndSuggest: {
        criteriaScored: parsed.criteriaScored,
        suggestions: parsed.suggestions,
        ...(parsed.droppedSuggestions.length > 0 && { droppedSuggestions: parsed.droppedSuggestions }),
        durationMs: evalDurationMs,
        cost: evalCost,
      },
      cycles: [{
        proposedGroupsRaw,
        droppedPreApprover,
        approverGroups: approverGroups.length,
        forwardDecisions: forwardDecisions.map((d) => ({
          groupNumber: d.groupNumber,
          decision: d.decision,
          reason: d.reason,
          ...(d.redundancy_violation !== undefined && { redundancy_violation: d.redundancy_violation }),
          ...(d.flow_violation !== undefined && { flow_violation: d.flow_violation }),
          ...(d.length_violation !== undefined && { length_violation: d.length_violation }),
        })),
        mirrorDecisions: mirrorDecisions.map((d) => ({
          groupNumber: d.groupNumber,
          decision: d.decision,
          reason: d.reason,
          ...(d.redundancy_violation !== undefined && { redundancy_violation: d.redundancy_violation }),
          ...(d.flow_violation !== undefined && { flow_violation: d.flow_violation }),
          ...(d.length_violation !== undefined && { length_violation: d.length_violation }),
        })),
        appliedGroups: appliedCount,
        droppedPostApprover,
        proposeCostUsd,
        approveForwardCostUsd,
        approveMirrorCostUsd,
        ...(formatGateDiagnostic && { formatGateDiagnostic }),
      }],
      ranking: rankingDetail ?? null,
      totalCost,
      mirrorAgreementRate,
      ...(mirrorAbortReason !== undefined && { mirrorAbortReason }),
    };

    return {
      result: {
        variant: surfaced ? finalVariant : null,
        status: surfaced ? 'converged' : 'budget',
        surfaced,
        matches: rankingMatches,
      },
      detail,
      childVariantIds: surfaced ? [finalVariant.id] : [],
    };
  }
}

// Attribution extractor registration
registerAttributionExtractor('proposer_approver_criteria_generate', (detail: unknown) => {
  const weakest = (detail as { weakestCriteriaNames?: unknown })?.weakestCriteriaNames;
  if (!Array.isArray(weakest) || weakest.length === 0) return null;
  const primary = weakest[0];
  return typeof primary === 'string' && primary.length > 0 && !primary.includes(':') ? primary : null;
});
