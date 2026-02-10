// Iterative editing agent that uses critique-driven edits with blind LLM-as-judge gating.
// Takes the top variant, identifies weaknesses via rubric + open review, edits surgically, and gates via diff comparison.

import { v4 as uuidv4 } from 'uuid';
import { AgentBase } from './base';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, Critique, TextVariation } from '../types';
import { BudgetExceededError, isOutlineVariant } from '../types';
import { compareWithDiff } from '../diffComparison';
import { getCritiqueForVariant } from './reflectionAgent';
import { buildQualityCritiquePrompt, getFlowCritiqueForVariant } from '../flowRubric';
import { FORMAT_RULES } from './formatRules';
import { validateFormat } from './formatValidator';
import { extractJSON } from '../core/jsonParser';

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

  canExecute(state: PipelineState): boolean {
    if (!state.allCritiques || state.allCritiques.length === 0) return false;
    if (state.ratings.size === 0) return false;
    const top = state.getTopByRating(1)[0];
    if (!top) return false;
    return getCritiqueForVariant(top.id, state) !== null;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, llmClient, logger, costTracker } = ctx;
    let variantsAdded = 0;
    let consecutiveRejections = 0;
    this.attemptedTargets.clear();

    // Get the top variant and its latest critique
    let current = state.getTopByRating(1)[0];
    let currentCritique = getCritiqueForVariant(current.id, state);

    // Initial open-ended review (rubric critique already in state from ReflectionAgent)
    let openReview = await this.runOpenReview(current.text, llmClient);

    for (let cycle = 0; cycle < this.config.maxCycles; cycle++) {
      // Check stopping: all dimensions >= threshold AND open review found nothing
      if (this.qualityThresholdMet(currentCritique) && !openReview) {
        logger.info('Quality threshold met, stopping', { cycle });
        break;
      }
      if (consecutiveRejections >= this.config.maxConsecutiveRejections) {
        logger.info('Max consecutive rejections reached, stopping', { cycle, consecutiveRejections });
        break;
      }

      // Pick edit target from combined rubric + open review (passes variant for step-aware + flow-aware targeting)
      const editTarget = this.pickEditTarget(currentCritique, openReview, current, state.allCritiques);
      if (!editTarget) break;

      // EDIT: generate targeted fix
      const editPrompt = buildEditPrompt(current.text, editTarget);
      const editedText = await llmClient.complete(editPrompt, this.name);

      // Validate format
      const formatResult = validateFormat(editedText);
      if (!formatResult.valid) {
        logger.warn('Edit failed format validation', { cycle, issues: formatResult.issues });
        consecutiveRejections++;
        continue;
      }

      // JUDGE: blind holistic diff-based comparison (no info about edit target)
      const callLLM = (prompt: string) => llmClient.complete(prompt, this.name, { model: ctx.payload.config.judgeModel });
      const result = await compareWithDiff(current.text, editedText, callLLM);

      const accepted = result.verdict === 'ACCEPT';
      if (accepted) {
        // Create new variant
        const editedVariant = {
          id: uuidv4(),
          text: editedText,
          version: current.version + 1,
          parentIds: [current.id],
          strategy: `critique_edit_${editTarget.dimension || 'open'}`,
          createdAt: Date.now() / 1000,
          iterationBorn: state.iteration,
        };
        state.addToPool(editedVariant);
        variantsAdded++;
        consecutiveRejections = 0;
        current = editedVariant;

        logger.info('Edit accepted', { cycle, target: editTarget.dimension, verdict: result.verdict, confidence: result.confidence });

        // RE-EVALUATE: fresh rubric + open review on the accepted text
        currentCritique = await this.runInlineCritique(editedText, current.id, llmClient);
        openReview = await this.runOpenReview(editedText, llmClient);
      } else {
        consecutiveRejections++;
        logger.info('Edit rejected by judge', { cycle, target: editTarget.dimension, verdict: result.verdict, confidence: result.confidence });
      }
    }

    return {
      agentType: this.name,
      success: variantsAdded > 0,
      costUsd: costTracker.getAgentCost(this.name),
      variantsAdded,
    };
  }

  estimateCost(payload: AgentPayload): number {
    // Per cycle: 1 rubric critique + 1 open review + 1 edit + 2 judge calls (diff-based)
    const textLen = payload.originalText.length;
    const genCost = ((textLen + 500) / 4 / 1_000_000) * 0.80 + (textLen / 4 / 1_000_000) * 4.0;
    const diffLen = Math.ceil(textLen * 0.15);
    const judgeCost = ((diffLen + 300) / 4 / 1_000_000) * 0.10;
    return (genCost * 2 + judgeCost * 2) * this.config.maxCycles;
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
      // Log non-budget errors for debugging (previously swallowed silently)
      console.warn('[iterativeEditing] runOpenReview error:', String(err));
      return null;
    }
  }

  /** Inline rubric critique using shared quality critique prompt. Returns null on parse failure. */
  private async runInlineCritique(
    text: string,
    variantId: string,
    llmClient: ExecutionContext['llmClient'],
  ): Promise<Critique | null> {
    try {
      const prompt = buildQualityCritiquePrompt(text);
      const response = await llmClient.complete(prompt, this.name);
      const data = extractJSON<{
        scores?: Record<string, number>;
        good_examples?: Record<string, string | string[]>;
        bad_examples?: Record<string, string | string[]>;
        notes?: Record<string, string>;
      }>(response);
      if (!data || !data.scores || typeof data.scores !== 'object') return null;

      const toArrayRecord = (
        obj: Record<string, string | string[]> | undefined,
      ): Record<string, string[]> => {
        if (!obj) return {};
        const result: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(obj)) {
          result[k] = Array.isArray(v) ? v : [v];
        }
        return result;
      };

      return {
        variationId: variantId,
        dimensionScores: data.scores,
        goodExamples: toArrayRecord(data.good_examples),
        badExamples: toArrayRecord(data.bad_examples),
        notes: data.notes ?? {},
        reviewer: 'llm',
      };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      console.warn('[iterativeEditing] runInlineCritique error:', String(err));
      return null;
    }
  }

  /** Pick the highest-priority unattempted edit target from combined rubric + open review.
   *  For OutlineVariants, step-based targets are added first (highest priority).
   *  When flow critique exists, flow dimensions are included via normalized scoring. */
  private pickEditTarget(critique: Critique | null, openReview: string[] | null, variant?: TextVariation, allCritiques?: Critique[] | null): EditTarget | null {
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

    // Add rubric-based targets (quality + flow dimensions below threshold)
    if (critique) {
      const sorted = Object.entries(critique.dimensionScores)
        .filter(([, score]) => score < this.config.qualityThreshold)
        .sort((a, b) => a[1] - b[1]); // weakest first

      for (const [dim, score] of sorted) {
        targets.push({
          dimension: dim,
          description: `Improve ${dim}`,
          score,
          badExamples: critique.badExamples[dim],
          notes: critique.notes[dim],
        });
      }
    }

    // Add flow dimension targets when flow critique is available
    if (variant && allCritiques) {
      const flowCritique = getFlowCritiqueForVariant(variant.id, allCritiques);
      if (flowCritique) {
        const sorted = Object.entries(flowCritique.dimensionScores)
          .filter(([, score]) => score < 3) // flow threshold: 3/5 ≈ 60%
          .sort((a, b) => a[1] - b[1]);

        for (const [dim, score] of sorted) {
          targets.push({
            dimension: dim,
            description: `Improve flow: ${dim}`,
            score,
            badExamples: flowCritique.badExamples[dim],
            notes: flowCritique.notes[dim],
          });
        }
      }
    }

    // Add open-ended targets
    if (openReview && openReview.length > 0) {
      for (const suggestion of openReview) {
        targets.push({ description: suggestion });
      }
    }

    // Return the highest-priority target not yet attempted this execution
    const key = (t: EditTarget) => t.dimension || t.description;
    const unattempted = targets.filter((t) => !this.attemptedTargets.has(key(t)));
    const pick = unattempted[0] ?? null;
    if (pick) this.attemptedTargets.add(key(pick));
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

function buildEditPrompt(text: string, target: EditTarget): string {
  // Step-targeted prompt for OutlineVariants
  if (target.dimension?.startsWith('step:')) {
    const stepName = target.dimension.slice(5);
    const stepInstructions =
      stepName === 'outline' ? 'Create a better section outline with improved structure, coverage, and logical flow.' :
      stepName === 'expand' ? 'Expand the outline sections into better prose with stronger examples, details, and grounding.' :
      'Polish the text for better readability, transitions, flow, and coherence.';

    return `You are a writing expert. The ${stepName} step of this article scored ${target.score}/1.

## Task
Re-generate ONLY the ${stepName} step to improve quality. Keep all other aspects unchanged.

## Original Text
${text}

## Instructions
${stepInstructions}

${FORMAT_RULES}

Output ONLY the improved text, no explanations.`;
  }

  const weaknessSection = target.dimension
    ? `## Weakness to Fix: ${target.dimension.toUpperCase()} (score: ${target.score}/10)
Problems identified:
${target.badExamples?.map((e) => `- "${e}"`).join('\n') || '- See notes below'}
${target.notes ? `Notes: ${target.notes}` : ''}`
    : `## Issue to Fix
${target.description}`;

  return `You are a surgical writing editor. Fix ONLY the identified weakness while preserving all other qualities of the text.

## Text to Edit
${text}

${weaknessSection}

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
"""${text}"""

## Output Format (JSON)
{
  "suggestions": [
    "Specific improvement suggestion 1",
    "Specific improvement suggestion 2"
  ]
}

Output ONLY valid JSON, no other text.`;
}
