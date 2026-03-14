// Section decomposition agent that edits article sections independently in parallel.
// Decomposes the top variant into H2 sections, runs targeted edits on each, then stitches back.

import { AgentBase } from './base';
import { createTextVariation } from '../core/textVariationFactory';
import type { AgentResult, ExecutionContext, ReadonlyPipelineState, AgentPayload, SectionDecompositionExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import { parseArticleIntoSections } from '../section/sectionParser';
import { stitchWithReplacements } from '../section/sectionStitcher';
import { runSectionEdit } from '../section/sectionEditRunner';
import { calculateLLMCost } from '@/config/llmPricing';
import type { SectionWeakness } from '../section/sectionEditRunner';
import { validateFormat } from './formatValidator';
import { getCritiqueForVariant, getWeakestDimension } from './reflectionAgent';

/** Minimum character length for a section to be eligible for editing. */
const MIN_SECTION_LENGTH = 100;

/** Minimum number of H2 sections required (excluding preamble). */
const MIN_H2_SECTIONS = 2;

export class SectionDecompositionAgent extends AgentBase {
  readonly name = 'sectionDecomposition';

  canExecute(state: ReadonlyPipelineState): boolean {
    // Need rated variants with critiques
    if (state.allCritiques.length === 0) return false;
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
      return { agentType: this.name, success: false, costUsd: 0, variantsAdded: 0, skipped: true, reason: 'no critique', actions: [] };
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
      return { agentType: this.name, success: false, costUsd: 0, variantsAdded: 0, skipped: true, reason: 'no eligible sections', actions: [] };
    }

    // Determine weakness to target (weakest dimension from critique)
    const weakestDim = getWeakestDimension(critique);
    const noteOrDefault = weakestDim ? critique.notes[weakestDim] ?? `Improve ${weakestDim}` : 'Improve overall writing quality.';
    const examples = weakestDim && critique.badExamples[weakestDim]?.length ? `. Examples: ${critique.badExamples[weakestDim].join('; ')}` : '';
    const weakness: SectionWeakness = {
      dimension: weakestDim ?? 'overall_quality',
      description: weakestDim ? `${noteOrDefault}${examples}` : noteOrDefault,
    };

    // Reserve budget upfront (once, before fan-out)
    const estimatedCost = this.estimateCost(ctx.payload) * (eligible.length / Math.max(parsed.sectionCount, 1));
    try {
      await costTracker.reserveBudget(this.name, estimatedCost);
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        logger.warn('Budget insufficient for section decomposition', { estimated: estimatedCost });
        return { agentType: this.name, success: false, costUsd: 0, variantsAdded: 0, skipped: true, reason: 'budget', actions: [] };
      }
      throw error;
    }

    // Build section detail for all parsed sections
    const sectionDetails: SectionDecompositionExecutionDetail['sections'] = parsed.sections.map((s, i) => ({
      index: i,
      heading: s.heading,
      eligible: !s.isPreamble && s.markdown.length >= MIN_SECTION_LENGTH,
      improved: false,
      charCount: s.markdown.length,
    }));

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
        const idx = result.value.sectionIndex;
        // AGENT-5: Guard against out-of-bounds section indices from LLM
        if (idx < 0 || idx >= sectionDetails.length) {
          logger.warn('Section edit returned out-of-bounds index, skipping', { idx, maxIndex: sectionDetails.length - 1 });
          continue;
        }
        replacements.set(idx, result.value.markdown);
        // Mark section as improved in detail
        const sd = sectionDetails.find(s => s.index === idx);
        if (sd) sd.improved = true;
      } else if (result.status === 'rejected' && result.reason instanceof BudgetExceededError) {
        budgetError = result.reason;
      }
    }

    if (replacements.size === 0) {
      logger.info('No section improvements accepted', { eligible: eligible.length });
      const detail: SectionDecompositionExecutionDetail = {
        detailType: 'sectionDecomposition', targetVariantId: top.id,
        weakness: { dimension: weakness.dimension, description: weakness.description },
        sections: sectionDetails, sectionsImproved: 0, totalEligible: eligible.length,
        formatValid: true, totalCost: costTracker.getAgentCost(this.name),
      };
      if (budgetError) throw budgetError;
      return { agentType: this.name, success: false, costUsd: costTracker.getAgentCost(this.name), variantsAdded: 0, executionDetail: detail, actions: [] };
    }

    // Stitch improved sections back into full article
    const stitchResult = stitchWithReplacements(parsed, replacements);

    // SEC-1: Log any out-of-bounds replacement indices
    if (stitchResult.unusedIndices.length > 0) {
      logger.warn('Stitcher had unused replacement indices (OOB)', { unusedIndices: stitchResult.unusedIndices });
    }

    // Validate stitched result format
    const formatResult = validateFormat(stitchResult.text);
    if (!formatResult.valid) {
      // SEC-2: Check each replaced section to identify which caused failure
      const failedSections: Array<{ index: number; heading: string; issues: string[] }> = [];
      for (const [idx, markdown] of replacements) {
        const sectionResult = validateFormat(markdown);
        if (!sectionResult.valid) {
          const heading = sectionDetails[idx]?.heading ?? `section ${idx}`;
          failedSections.push({ index: idx, heading, issues: sectionResult.issues });
        }
      }
      const issueDetail = failedSections.length > 0 ? failedSections : 'full-article issue (sections individually valid)';
      logger.warn('Stitched article failed format validation', { issues: formatResult.issues, failedSections: issueDetail });
      const detail: SectionDecompositionExecutionDetail = {
        detailType: 'sectionDecomposition', targetVariantId: top.id,
        weakness: { dimension: weakness.dimension, description: weakness.description },
        sections: sectionDetails, sectionsImproved: replacements.size, totalEligible: eligible.length,
        formatValid: false, totalCost: costTracker.getAgentCost(this.name),
      };
      return { agentType: this.name, success: false, costUsd: costTracker.getAgentCost(this.name), variantsAdded: 0, executionDetail: detail, actions: [] };
    }

    // Create stitched variant (added to pool via action)
    const variant = createTextVariation({
      text: stitchResult.text,
      version: top.version + 1,
      parentIds: [top.id],
      strategy: `section_decomposition_${weakness.dimension}`,
      iterationBorn: state.iteration,
    });

    logger.info('Section decomposition variant added', {
      sectionsImproved: replacements.size,
      totalEligible: eligible.length,
      weakness: weakness.dimension,
    });

    const detail: SectionDecompositionExecutionDetail = {
      detailType: 'sectionDecomposition', targetVariantId: top.id,
      weakness: { dimension: weakness.dimension, description: weakness.description },
      sections: sectionDetails, sectionsImproved: replacements.size, totalEligible: eligible.length,
      formatValid: true, newVariantId: variant.id,
      totalCost: costTracker.getAgentCost(this.name),
    };

    // Propagate budget error after partial success
    if (budgetError) throw budgetError;

    return {
      agentType: this.name,
      success: true,
      costUsd: costTracker.getAgentCost(this.name),
      variantsAdded: 1,
      executionDetail: detail,
      actions: [{ type: 'ADD_TO_POOL' as const, variants: [variant] }],
    };
  }

  estimateCost(payload: AgentPayload): number {
    // Per section per cycle: 1 edit call + 2 judge calls (forward + reverse)
    // Assume ~5 sections, 2 cycles each = 30 LLM calls total
    const textLen = payload.originalText.length;
    const genModel = payload.config.generationModel ?? 'gpt-4.1-mini';
    const judgeModel = payload.config.judgeModel ?? 'gpt-4.1-nano';
    const sectionLen = textLen / 5; // rough per-section size
    const genInputTokens = (sectionLen + 500) / 4;
    const genOutputTokens = sectionLen / 4;
    const genCost = calculateLLMCost(genModel, genInputTokens, genOutputTokens);
    const diffLen = Math.ceil(sectionLen * 0.15);
    const judgeInputTokens = (diffLen + 300) / 4;
    const judgeCost = calculateLLMCost(judgeModel, judgeInputTokens, judgeInputTokens);
    return (genCost + judgeCost * 2) * 2 * 5; // 2 cycles × 5 sections
  }
}
