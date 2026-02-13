// Outline generation agent producing variants via outline→expand→polish pipeline with per-step scoring.
// Runs alongside existing GenerationAgent; outline variants compete via Elo in the shared pool.

import { v4 as uuidv4 } from 'uuid';
import { AgentBase } from './base';
import { FORMAT_RULES } from './formatRules';
import { validateFormat } from './formatValidator';
import type {
  AgentResult,
  ExecutionContext,
  PipelineState,
  AgentPayload,
  GenerationStep,
  GenerationStepName,
  OutlineVariant,
  LLMCompletionOptions,
  OutlineGenerationExecutionDetail,
} from '../types';
import { BudgetExceededError, parseStepScore } from '../types';

// ─── Prompt builders (inline, matching existing agent pattern) ───

function buildOutlinePrompt(originalText: string): string {
  return `You are a content architect who creates clear, logical outlines.

## Task
Create a structured outline for the following text. The outline should have section headings (## level) with 1-2 sentence summaries per section describing what that section covers.

## Original Text
${originalText}

## Instructions
Output ONLY the outline — section headings with brief summaries. No full prose. Example format:
## Section Title
Brief summary of what this section covers and its key points.

## Another Section
Summary of this section's content.`;
}

function buildOutlineScorePrompt(outline: string, originalText: string): string {
  return `Rate the quality of this outline for the given original text on a scale of 0 to 1.

Consider: structural logic, topic coverage, flow between sections, and clarity of summaries.

## Original Text
${originalText}

## Outline
${outline}

## Instructions
Output ONLY a single decimal number between 0 and 1 (e.g., 0.85). No explanation.`;
}

function buildExpandPrompt(outline: string, originalText: string): string {
  return `You are a writing expert who expands outlines into full, well-developed prose.

## Task
Expand the following outline into complete article text. Each section should become full paragraphs with detail, examples, and grounding. Follow the outline's structure exactly.

## Outline
${outline}

## Original Text (for reference — preserve meaning and key points)
${originalText}

${FORMAT_RULES}
## Instructions
Produce the full expanded article text. Every section from the outline must appear. Output ONLY the article text, no explanations.`;
}

function buildExpansionScorePrompt(expandedText: string, outline: string): string {
  return `Rate the quality of this expanded text relative to the outline on a scale of 0 to 1.

Consider: detail and depth, use of examples, grounding in specifics, and adherence to outline structure.

## Outline
${outline}

## Expanded Text
${expandedText}

## Instructions
Output ONLY a single decimal number between 0 and 1 (e.g., 0.72). No explanation.`;
}

function buildPolishPrompt(expandedText: string, outline: string): string {
  return `You are a writing expert specializing in polishing and refining text.

## Task
Polish the following text for readability, flow, transitions, and coherence. Smooth out rough edges, strengthen transitions between sections, and ensure consistent tone and style throughout.

## Outline (for structural reference)
${outline}

## Text to Polish
${expandedText}

${FORMAT_RULES}
## Instructions
Produce the polished version of the text. Do not change the structure or remove content — only improve writing quality. Output ONLY the polished text, no explanations.`;
}

function buildPolishScorePrompt(polishedText: string, expandedText: string): string {
  return `Rate the quality of the polished text compared to the unpolished version on a scale of 0 to 1.

Consider: readability, transitions, flow, coherence, and overall writing quality improvement.

## Unpolished Text
${expandedText}

## Polished Text
${polishedText}

## Instructions
Output ONLY a single decimal number between 0 and 1 (e.g., 0.90). No explanation.`;
}

// ─── Agent implementation ───────────────────────────────────────

/** Compute the weakest step by finding the minimum score. */
function computeWeakestStep(steps: GenerationStep[]): GenerationStepName | null {
  if (steps.length === 0) return null;
  let weakest = steps[0];
  for (const step of steps) {
    if (step.score < weakest.score) weakest = step;
  }
  return weakest.name;
}

export class OutlineGenerationAgent extends AgentBase {
  readonly name = 'outlineGeneration';

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, llmClient, logger, costTracker } = ctx;
    const originalText = state.originalText;

    if (!originalText) {
      return { agentType: this.name, success: false, costUsd: costTracker.getAgentCost(this.name), error: 'No originalText in state' };
    }

    // Helper to build execution detail from accumulated steps
    const buildDetail = (variantId: string, genSteps: GenerationStep[]): OutlineGenerationExecutionDetail => ({
      detailType: 'outlineGeneration',
      steps: genSteps.map(s => ({
        name: s.name,
        score: s.score,
        costUsd: s.costUsd,
        inputLength: s.input.length,
        outputLength: s.output.length,
      })),
      weakestStep: computeWeakestStep(genSteps),
      variantId,
      totalCost: costTracker.getAgentCost(this.name),
    });

    const costBefore = costTracker.getAgentCost(this.name);
    const steps: GenerationStep[] = [];
    const genOptions: LLMCompletionOptions = { model: ctx.payload.config.generationModel };
    const judgeOptions: LLMCompletionOptions = { model: ctx.payload.config.judgeModel };

    try {
      // Step 1: Generate outline
      logger.debug('Outline step: generating outline', { textLength: originalText.length });
      const outlinePrompt = buildOutlinePrompt(originalText);
      const outlineOutput = await llmClient.complete(outlinePrompt, this.name, genOptions);
      if (!outlineOutput.trim()) {
        logger.warn('Outline step produced empty output, falling back');
        return { agentType: this.name, success: false, costUsd: costTracker.getAgentCost(this.name), error: 'Outline step empty',
          executionDetail: buildDetail('', steps) };
      }

      // Step 2: Score outline
      const outlineScorePrompt = buildOutlineScorePrompt(outlineOutput, originalText);
      const outlineScoreRaw = await llmClient.complete(outlineScorePrompt, this.name, judgeOptions);
      const outlineScore = parseStepScore(outlineScoreRaw);
      const costAfterOutline = costTracker.getAgentCost(this.name);
      const outlineStepCost = costAfterOutline - costBefore;

      steps.push({
        name: 'outline',
        input: originalText,
        output: outlineOutput.trim(),
        score: outlineScore,
        costUsd: outlineStepCost,
      });

      // Step 3: Expand outline into full prose
      logger.debug('Expand step: expanding outline', { outlineLength: outlineOutput.length });
      const expandPrompt = buildExpandPrompt(outlineOutput, originalText);
      const expandOutput = await llmClient.complete(expandPrompt, this.name, genOptions);

      if (!expandOutput.trim()) {
        // Fallback: use raw outline as variant text (low quality, will score poorly)
        logger.warn('Expand step produced empty output, using outline as text');
        const variant = this.buildVariant(state, outlineOutput.trim(), outlineOutput.trim(), steps, costTracker.getAgentCost(this.name) - costBefore);
        state.addToPool(variant);
        return { agentType: this.name, success: true, costUsd: costTracker.getAgentCost(this.name), variantsAdded: 1,
          executionDetail: buildDetail(variant.id, steps) };
      }

      // Step 4: Score expansion
      const expandScorePrompt = buildExpansionScorePrompt(expandOutput, outlineOutput);
      const expandScoreRaw = await llmClient.complete(expandScorePrompt, this.name, judgeOptions);
      const expandScore = parseStepScore(expandScoreRaw);
      const costAfterExpand = costTracker.getAgentCost(this.name);
      const expandStepCost = costAfterExpand - costAfterOutline;

      steps.push({
        name: 'expand',
        input: outlineOutput.trim(),
        output: expandOutput.trim(),
        score: expandScore,
        costUsd: expandStepCost,
      });

      // Step 5: Polish text
      logger.debug('Polish step: polishing text', { expandLength: expandOutput.length });
      const polishPrompt = buildPolishPrompt(expandOutput, outlineOutput);
      const polishOutput = await llmClient.complete(polishPrompt, this.name, genOptions);
      // If polish fails, use expanded text
      const finalText = polishOutput.trim() || expandOutput.trim();

      // Step 6: Score polish
      const polishScorePrompt = buildPolishScorePrompt(finalText, expandOutput);
      const polishScoreRaw = await llmClient.complete(polishScorePrompt, this.name, judgeOptions);
      const polishScore = parseStepScore(polishScoreRaw);
      const polishStepCost = costTracker.getAgentCost(this.name) - costAfterExpand;

      steps.push({
        name: 'polish',
        input: expandOutput.trim(),
        output: finalText,
        score: polishScore,
        costUsd: polishStepCost,
      });

      // Step 7: Verify (no LLM call) — format validation + length check
      const fmtResult = validateFormat(finalText);
      if (!fmtResult.valid) {
        logger.warn('Outline variant failed format validation', { issues: fmtResult.issues });
        // Still add to pool — low format score will make it lose in tournament
      }

      steps.push({
        name: 'verify',
        input: finalText,
        output: fmtResult.valid ? 'pass' : `fail: ${fmtResult.issues.join(', ')}`,
        score: fmtResult.valid ? 1.0 : 0.3,
        costUsd: 0,
      });

      const totalCost = costTracker.getAgentCost(this.name) - costBefore;
      const variant = this.buildVariant(state, finalText, outlineOutput.trim(), steps, totalCost);
      state.addToPool(variant);

      logger.info('Outline variant generated', {
        variantId: variant.id,
        weakestStep: variant.weakestStep,
        stepScores: steps.map(s => `${s.name}:${s.score.toFixed(2)}`).join(', '),
        textLength: finalText.length,
      });

      return { agentType: this.name, success: true, costUsd: costTracker.getAgentCost(this.name), variantsAdded: 1,
        executionDetail: buildDetail(variant.id, steps) };
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;

      logger.error('Outline generation failed', { error: String(error) });

      // If we have partial steps, create a partial variant
      if (steps.length > 0) {
        const lastStep = steps[steps.length - 1];
        const partialText = lastStep.output;
        if (partialText && partialText.trim()) {
          const totalCost = costTracker.getAgentCost(this.name) - costBefore;
          const variant = this.buildVariant(state, partialText.trim(), steps[0]?.output ?? '', steps, totalCost);
          state.addToPool(variant);
          return { agentType: this.name, success: true, costUsd: costTracker.getAgentCost(this.name), variantsAdded: 1,
            executionDetail: buildDetail(variant.id, steps) };
        }
      }

      return { agentType: this.name, success: false, costUsd: costTracker.getAgentCost(this.name), error: String(error),
        executionDetail: buildDetail('', steps) };
    }
  }

  estimateCost(payload: AgentPayload): number {
    const textTokens = Math.ceil(payload.originalText.length / 4);
    const promptOverhead = 200;
    const inputTokens = textTokens + promptOverhead;
    const outputTokens = textTokens;
    const costPerCall = (inputTokens / 1_000_000) * 0.0004 + (outputTokens / 1_000_000) * 0.0016;
    // 6 LLM calls: outline + score + expand + score + polish + score
    return costPerCall * 6;
  }

  canExecute(state: PipelineState): boolean {
    return state.originalText.length > 0;
  }

  private buildVariant(
    state: PipelineState,
    finalText: string,
    outlineText: string,
    steps: GenerationStep[],
    totalCost: number,
  ): OutlineVariant {
    return {
      id: uuidv4(),
      text: finalText,
      version: state.iteration + 1,
      parentIds: [],
      strategy: 'outline_generation',
      createdAt: Date.now() / 1000,
      iterationBorn: state.iteration,
      costUsd: totalCost,
      steps,
      outline: outlineText,
      weakestStep: computeWeakestStep(steps),
    };
  }
}
