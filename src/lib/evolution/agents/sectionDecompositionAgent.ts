// Section decomposition agent that edits article sections independently in parallel.
// Decomposes the top variant into H2 sections, runs targeted edits on each, then stitches back.

import { v4 as uuidv4 } from 'uuid';
import { AgentBase } from './base';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload } from '../types';
import { BudgetExceededError } from '../types';
import { parseArticleIntoSections } from '../section/sectionParser';
import { stitchWithReplacements } from '../section/sectionStitcher';
import { runSectionEdit } from '../section/sectionEditRunner';
import type { SectionWeakness } from '../section/sectionEditRunner';
import { validateFormat } from './formatValidator';
import { getCritiqueForVariant, getWeakestDimension } from './reflectionAgent';

/** Minimum character length for a section to be eligible for editing. */
const MIN_SECTION_LENGTH = 100;

/** Minimum number of H2 sections required (excluding preamble). */
const MIN_H2_SECTIONS = 2;

export class SectionDecompositionAgent extends AgentBase {
  readonly name = 'sectionDecomposition';

  canExecute(state: PipelineState): boolean {
    // Need rated variants with critiques
    if (!state.allCritiques || state.allCritiques.length === 0) return false;
    if (state.ratings.size === 0) return false;

    const top = state.getTopByRating(1)[0];
    if (!top) return false;

    // Need a critique for the top variant
    if (!getCritiqueForVariant(top.id, state)) return false;

    // Need ≥2 H2 sections in the top variant
    const parsed = parseArticleIntoSections(top.text);
    return parsed.sectionCount >= MIN_H2_SECTIONS;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, llmClient, logger, costTracker } = ctx;

    const top = state.getTopByRating(1)[0];
    const critique = getCritiqueForVariant(top.id, state);
    if (!critique) {
      return { agentType: this.name, success: false, costUsd: 0, variantsAdded: 0, skipped: true, reason: 'no critique' };
    }

    // Parse into sections
    const parsed = parseArticleIntoSections(top.text);
    logger.info('Section decomposition', {
      sectionCount: parsed.sectionCount,
      totalSections: parsed.sections.length,
    });

    // Filter eligible sections: skip preamble, skip short sections
    const eligible = parsed.sections.filter(
      (s) => !s.isPreamble && s.markdown.length >= MIN_SECTION_LENGTH,
    );

    if (eligible.length === 0) {
      return { agentType: this.name, success: false, costUsd: 0, variantsAdded: 0, skipped: true, reason: 'no eligible sections' };
    }

    // Determine weakness to target (weakest dimension from critique)
    const weakestDim = getWeakestDimension(critique);
    const weakness: SectionWeakness = {
      dimension: weakestDim ?? 'overall_quality',
      description: weakestDim
        ? `${critique.notes[weakestDim] ?? `Improve ${weakestDim}`}${
            critique.badExamples[weakestDim]?.length
              ? `. Examples: ${critique.badExamples[weakestDim].join('; ')}`
              : ''
          }`
        : 'Improve overall writing quality.',
    };

    // Reserve budget upfront (once, before fan-out)
    const estimatedCost = this.estimateCost(ctx.payload) * (eligible.length / Math.max(parsed.sectionCount, 1));
    try {
      await costTracker.reserveBudget(this.name, estimatedCost);
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        logger.warn('Budget insufficient for section decomposition', { estimated: estimatedCost });
        return { agentType: this.name, success: false, costUsd: 0, variantsAdded: 0, skipped: true, reason: 'budget' };
      }
      throw error;
    }

    // Run section edits in parallel
    const editPromises = eligible.map((section) =>
      runSectionEdit(
        section,
        top.text,
        weakness,
        llmClient,
        this.name,
        { judgeModel: ctx.payload.config.judgeModel },
      ),
    );

    const results = await Promise.allSettled(editPromises);

    // Build replacement map from accepted edits
    const replacements = new Map<number, string>();
    let budgetError: BudgetExceededError | null = null;

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.improved) {
        replacements.set(result.value.sectionIndex, result.value.markdown);
      } else if (result.status === 'rejected' && result.reason instanceof BudgetExceededError) {
        budgetError = result.reason;
      }
    }

    if (replacements.size === 0) {
      logger.info('No section improvements accepted', { eligible: eligible.length });
      if (budgetError) throw budgetError;
      return { agentType: this.name, success: false, costUsd: costTracker.getAgentCost(this.name), variantsAdded: 0 };
    }

    // Stitch improved sections back into full article
    const stitchedText = stitchWithReplacements(parsed, replacements);

    // Full-article format validation (stitched result must pass original validateFormat)
    const formatResult = validateFormat(stitchedText);
    if (!formatResult.valid) {
      logger.warn('Stitched article failed format validation', { issues: formatResult.issues });
      return { agentType: this.name, success: false, costUsd: costTracker.getAgentCost(this.name), variantsAdded: 0 };
    }

    // Add stitched variant to pool
    const variant = {
      id: uuidv4(),
      text: stitchedText,
      version: top.version + 1,
      parentIds: [top.id],
      strategy: `section_decomposition_${weakness.dimension}`,
      createdAt: Date.now() / 1000,
      iterationBorn: state.iteration,
    };
    state.addToPool(variant);

    logger.info('Section decomposition variant added', {
      sectionsImproved: replacements.size,
      totalEligible: eligible.length,
      weakness: weakness.dimension,
    });

    // Propagate budget error after partial success
    if (budgetError) throw budgetError;

    return {
      agentType: this.name,
      success: true,
      costUsd: costTracker.getAgentCost(this.name),
      variantsAdded: 1,
    };
  }

  estimateCost(payload: AgentPayload): number {
    // Per section per cycle: 1 edit call + 2 judge calls (forward + reverse)
    // Assume ~5 sections, 2 cycles each = 30 LLM calls total
    const textLen = payload.originalText.length;
    const sectionLen = textLen / 5; // rough per-section size
    const genCost = ((sectionLen + 500) / 4 / 1_000_000) * 0.80 + (sectionLen / 4 / 1_000_000) * 4.0;
    const diffLen = Math.ceil(sectionLen * 0.15);
    const judgeCost = ((diffLen + 300) / 4 / 1_000_000) * 0.10;
    return (genCost + judgeCost * 2) * 2 * 5; // 2 cycles × 5 sections
  }
}
