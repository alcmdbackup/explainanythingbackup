// Iterative editing agent that uses critique-driven edits with blind LLM-as-judge gating.
// Takes the top variant, identifies weaknesses via rubric + open review, edits surgically, and gates via diff comparison.

import { AgentBase } from './base';
import { createTextVariation } from '../core/textVariationFactory';
import type { AgentResult, ExecutionContext, ReadonlyPipelineState, AgentPayload, Critique, Match, TextVariation, IterativeEditingExecutionDetail } from '../types';
import type { PipelineAction } from '../core/actions';
import { BudgetExceededError, isOutlineVariant } from '../types';
import { isTransientError } from '../core/errorClassification';
import { compareWithDiff } from '../diffComparison';
import { getCritiqueForVariant } from './reflectionAgent';
import { buildQualityCritiquePrompt, parseQualityCritiqueResponse, getFlowCritiqueForVariant } from '../flowRubric';
import { FORMAT_RULES } from './formatRules';
import { validateFormat } from './formatValidator';
import { extractJSON } from '../core/jsonParser';
import { runCritiqueBatch } from '../core/critiqueBatch';
import { getVariantFrictionSpots, formatFrictionSpots } from '../utils/frictionSpots';

/** Config for the iterative editing agent. */
export interface IterativeEditingConfig {
  /** Maximum edit→judge cycles per execution (default: 3). */
  maxCycles: number;
  /** Consecutive judge rejections before stopping (default: 3). */
  maxConsecutiveRejections: number;
  /** Rubric dimension threshold — stop if all dimensions >= this (default: 8). */
  qualityThreshold: number;
}

export const DEFAULT_ITERATIVE_EDITING_CONFIG: IterativeEditingConfig = {
  maxCycles: 3,
  maxConsecutiveRejections: 3,
  qualityThreshold: 8,
};

/** An edit target combining rubric dimension or open-ended suggestion. */
interface EditTarget {
  dimension?: string;
  description: string;
  score?: number;
  badExamples?: string[];
  notes?: string;
}

export class IterativeEditingAgent extends AgentBase {
  readonly name = 'iterativeEditing';
  private readonly config: IterativeEditingConfig;
  private attemptedTargets = new Set<string>();

  constructor(config?: Partial<IterativeEditingConfig>) {
    super();
    this.config = { ...DEFAULT_ITERATIVE_EDITING_CONFIG, ...config };
  }

  canExecute(state: ReadonlyPipelineState): boolean {
    if (state.allCritiques.length === 0) return false;
    if (state.ratings.size === 0) return false;
    const top = state.getTopByRating(1)[0];
    if (!top) return false;
    return getCritiqueForVariant(top.id, state) !== null;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, llmClient, logger, costTracker } = ctx;
    let variantsAdded = 0;
    let consecutiveRejections = 0;
    const acceptedVariants: TextVariation[] = [];
    this.attemptedTargets.clear();

    let current = state.getTopByRating(1)[0];
    let currentCritique = getCritiqueForVariant(current.id, state);
    const initialCritiqueSnapshot = currentCritique
      ? { dimensionScores: { ...currentCritique.dimensionScores } }
      : { dimensionScores: {} };

    const frictionSpots = getVariantFrictionSpots(current.id, state.matchHistory as Match[]);

    let openReview = await this.runOpenReview(current.text, llmClient);

    const cycleDetails: IterativeEditingExecutionDetail['cycles'] = [];
    let stopReason: IterativeEditingExecutionDetail['stopReason'] = 'max_cycles';

    for (let cycle = 0; cycle < this.config.maxCycles; cycle++) {
      if (this.qualityThresholdMet(currentCritique) && !openReview) {
        logger.info('Quality threshold met, stopping', { cycle });
        stopReason = 'threshold_met';
        break;
      }
      if (consecutiveRejections >= this.config.maxConsecutiveRejections) {
        logger.info('Max consecutive rejections reached, stopping', { cycle, consecutiveRejections });
        stopReason = 'max_rejections';
        break;
      }

      const editTarget = this.pickEditTarget(currentCritique, openReview, current, state.allCritiques);
      if (!editTarget) {
        stopReason = 'no_targets';
        break;
      }

      const targetDetail = {
        dimension: editTarget.dimension,
        description: editTarget.description,
        score: editTarget.score,
        source: editTarget.dimension ? 'rubric' : 'open_review',
      };

      try {
        const editPrompt = buildEditPrompt(current.text, editTarget, frictionSpots);
        const editedText = await llmClient.complete(editPrompt, this.name);
        const formatResult = validateFormat(editedText);
        if (!formatResult.valid) {
          logger.warn('Edit failed format validation', { cycle, issues: formatResult.issues });
          consecutiveRejections++;
          cycleDetails.push({ cycleNumber: cycle, target: targetDetail, verdict: 'REJECT', confidence: 0, formatValid: false, formatIssues: formatResult.issues });
          continue;
        }

        const callLLM = (prompt: string) => llmClient.complete(prompt, this.name, { model: ctx.payload.config.judgeModel, taskType: 'comparison', comparisonSubtype: 'simple' });
        const result = await compareWithDiff(current.text, editedText, callLLM);

        if (result.verdict === 'ACCEPT') {
          const editedVariant = createTextVariation({
            text: editedText,
            version: current.version + 1,
            parentIds: [current.id],
            strategy: `critique_edit_${editTarget.dimension || 'open'}`,
            iterationBorn: state.iteration,
          });
          acceptedVariants.push(editedVariant);
          variantsAdded++;
          consecutiveRejections = 0;
          current = editedVariant;

          logger.info('Edit accepted', { cycle, target: editTarget.dimension, confidence: result.confidence });
          cycleDetails.push({ cycleNumber: cycle, target: targetDetail, verdict: 'ACCEPT', confidence: result.confidence, formatValid: true, newVariantId: editedVariant.id });

          currentCritique = await this.runInlineCritique(editedText, current.id, llmClient);
          openReview = await this.runOpenReview(editedText, llmClient);
        } else {
          consecutiveRejections++;
          logger.info('Edit rejected by judge', { cycle, target: editTarget.dimension, confidence: result.confidence });
          cycleDetails.push({ cycleNumber: cycle, target: targetDetail, verdict: 'REJECT', confidence: result.confidence, formatValid: true });
        }
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;
        logger.warn('Edit cycle failed, treating as rejection', {
          cycle,
          error: error instanceof Error ? error.message : String(error),
          isTransient: isTransientError(error),
        });
        consecutiveRejections++;
        cycleDetails.push({ cycleNumber: cycle, target: targetDetail, verdict: 'REJECT', confidence: 0, formatValid: false });
        continue;
      }
    }

    const detail: IterativeEditingExecutionDetail = {
      detailType: 'iterativeEditing',
      targetVariantId: state.getTopByRating(1)[0]?.id ?? current.id,
      config: { ...this.config },
      cycles: cycleDetails,
      initialCritique: initialCritiqueSnapshot,
      finalCritique: currentCritique ? { dimensionScores: { ...currentCritique.dimensionScores } } : undefined,
      stopReason,
      consecutiveRejections,
      totalCost: costTracker.getAgentCost(this.name),
    };

    const actions: PipelineAction[] = acceptedVariants.length > 0
      ? [{ type: 'ADD_TO_POOL', variants: acceptedVariants }]
      : [];

    return {
      agentType: this.name,
      success: variantsAdded > 0,
      costUsd: costTracker.getAgentCost(this.name),
      variantsAdded,
      executionDetail: detail,
      actions,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  estimateCost(_payload: AgentPayload): number {
    return 0; // Cost estimated centrally by costEstimator
  }

  /** Open-ended review: freeform suggestions with no rubric. Returns null on parse failure. */
  private async runOpenReview(
    text: string,
    llmClient: ExecutionContext['llmClient'],
  ): Promise<string[] | null> {
    try {
      const prompt = buildOpenReviewPrompt(text);
      const response = await llmClient.complete(prompt, this.name);
      const data = extractJSON<{ suggestions?: string[] }>(response);
      if (!data) return null;
      return data.suggestions && data.suggestions.length > 0 ? data.suggestions : null;
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      return null;
    }
  }

  /** Inline rubric critique using shared quality critique prompt. Returns null on parse failure. */
  private async runInlineCritique(
    text: string,
    variantId: string,
    llmClient: ExecutionContext['llmClient'],
  ): Promise<Critique | null> {
    const { critiques } = await runCritiqueBatch(llmClient, {
      items: [{ id: variantId, text }],
      buildPrompt: (item) => buildQualityCritiquePrompt(item.text),
      agentName: this.name,
      parseResponse: (raw, item) => parseQualityCritiqueResponse(raw, item.id),
      parallel: false,
    });
    return critiques[0] ?? null;
  }

  /** Pick the highest-priority unattempted edit target from combined rubric + open review.
   *  For OutlineVariants, step-based targets are added first (highest priority).
   *  When flow critique exists, flow dimensions are included via normalized scoring. */
  private pickEditTarget(critique: Critique | null, openReview: string[] | null, variant?: TextVariation, allCritiques?: readonly Critique[]): EditTarget | null {
    const targets: EditTarget[] = [];

    // Step-based targets for OutlineVariants (highest priority)
    if (variant && isOutlineVariant(variant) && variant.weakestStep) {
      const stepScore = variant.steps.find(s => s.name === variant.weakestStep)?.score ?? 0;
      targets.push({
        dimension: `step:${variant.weakestStep}`,
        description: `Re-generate the ${variant.weakestStep} step (score: ${stepScore.toFixed(2)})`,
        score: stepScore,
      });
    }

    // Shared helper: extract below-threshold dimensions from a critique as edit targets
    const addDimensionTargets = (
      source: Critique,
      threshold: number,
      descPrefix: string,
    ): void => {
      const sorted = Object.entries(source.dimensionScores)
        .filter(([, score]) => score < threshold)
        .sort((a, b) => a[1] - b[1]);

      for (const [dim, score] of sorted) {
        targets.push({
          dimension: dim,
          description: `${descPrefix}${dim}`,
          score,
          badExamples: source.badExamples[dim],
          notes: source.notes[dim],
        });
      }
    };

    // Add rubric-based targets (quality dimensions below threshold)
    if (critique) {
      addDimensionTargets(critique, this.config.qualityThreshold, 'Improve ');
    }

    // Add flow dimension targets when flow critique is available
    if (variant && allCritiques) {
      const flowCritique = getFlowCritiqueForVariant(variant.id, allCritiques);
      if (flowCritique) {
        addDimensionTargets(flowCritique, 3, 'Improve flow: ');
      }
    }

    // Add open-ended review targets
    if (openReview) {
      for (const suggestion of openReview) {
        targets.push({ description: suggestion });
      }
    }

    // Return the highest-priority unattempted target
    const unattempted = targets.filter((t) => {
      const key = t.dimension || t.description;
      return !this.attemptedTargets.has(key);
    });
    const pick = unattempted[0] ?? null;
    if (pick) {
      this.attemptedTargets.add(pick.dimension || pick.description);
    }
    return pick;
  }

  /** Returns true if all rubric dimensions meet the quality threshold. */
  private qualityThresholdMet(critique: Critique | null): boolean {
    if (!critique) return false;
    return Object.values(critique.dimensionScores).every(
      (score) => score >= this.config.qualityThreshold,
    );
  }
}

function buildEditPrompt(text: string, target: EditTarget, frictionSpots?: string[]): string {
  const frictionSection = formatFrictionSpots(frictionSpots ?? []);

  if (target.dimension?.startsWith('step:')) {
    const stepName = target.dimension.slice(5);

    const stepInstructionsMap: Record<string, string> = {
      outline: 'Create a better section outline with improved structure, coverage, and logical flow.',
      expand: 'Expand the outline sections into better prose with stronger examples, details, and grounding.',
    };

    const stepInstructions = stepInstructionsMap[stepName] ?? 'Polish the text for better readability, transitions, flow, and coherence.';

    return `You are a writing expert. The ${stepName} step of this article scored ${target.score}/1.

## Task
Re-generate ONLY the ${stepName} step to improve quality. Keep all other aspects unchanged.

## Original Text
${text}
${frictionSection}
## Instructions
${stepInstructions}

${FORMAT_RULES}

Output ONLY the improved text, no explanations.`;
  }

  const examplesText = target.badExamples?.map((e) => `- "${e}"`).join('\n') ?? '- See notes below';
  const notesText = target.notes ? `Notes: ${target.notes}` : '';
  const weaknessSection = target.dimension
    ? `## Weakness to Fix: ${target.dimension.toUpperCase()} (score: ${target.score}/10)
Problems identified:
${examplesText}
${notesText}`
    : `## Issue to Fix
${target.description}`;

  return `You are a surgical writing editor. Fix ONLY the identified weakness while preserving all other qualities of the text.

## Text to Edit
${text}

${weaknessSection}
${frictionSection}
## Instructions
- Rewrite ONLY the sections exhibiting this weakness
- Do NOT alter sections that are working well
- Preserve structure, tone, and all other qualities
- Keep the same overall length (within 10%)

${FORMAT_RULES}

Output ONLY the complete revised text, nothing else.`;
}

function buildOpenReviewPrompt(text: string): string {
  return `You are an expert writing critic. Read this article and identify the 2-3 most impactful improvements that could be made.

Do NOT use a rubric or fixed dimensions. Focus on what strikes you as a reader — what would make this article meaningfully better?

## Article
<<<CONTENT>>>
${text}
<<</CONTENT>>>

## Output Format (JSON)
{
  "suggestions": [
    "Specific improvement suggestion 1",
    "Specific improvement suggestion 2"
  ]
}

Output ONLY valid JSON, no other text.`;
}
