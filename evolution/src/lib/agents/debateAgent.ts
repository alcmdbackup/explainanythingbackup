// Debate agent running a structured 3-turn debate (Advocate A / Advocate B / Judge) over top variants.
// Synthesizes an improved variant from the judge's recommendations, inspired by AI Co-Scientist (2502.18864).

import { AgentBase } from './base';
import { FORMAT_RULES } from './formatRules';
import { validateFormat } from './formatValidator';
import { getCritiqueForVariant, getImprovementSuggestions } from './reflectionAgent';
import { QUALITY_DIMENSIONS } from '../flowRubric';
import { createTextVariation } from '../core/textVariationFactory';
import { formatMetaFeedback } from '../utils/metaFeedback';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, TextVariation, DebateTranscript, DebateExecutionDetail } from '../types';
import { BudgetExceededError, BASELINE_STRATEGY } from '../types';
import { extractJSON } from '../core/jsonParser';
import { getOrdinal, createRating } from '../core/rating';

/** Count non-baseline variants (rated or unrated) eligible for debate. */
function countNonBaseline(state: PipelineState): number {
  return state.pool.filter(
    (v) => v.strategy !== BASELINE_STRATEGY,
  ).length;
}

// ─── Prompt builders ────────────────────────────────────────────

function buildAdvocateAPrompt(variantA: TextVariation, variantB: TextVariation, critiqueContext: string): string {
  return `You are Advocate A in a structured debate about text quality. Your job is to argue why Variant A is the superior text.

## Variant A (you are advocating for this)
<<<CONTENT>>>
${variantA.text}
<<</CONTENT>>>

## Variant B (the competing variant)
<<<CONTENT>>>
${variantB.text}
<<</CONTENT>>>
${critiqueContext}
## Task
Make a compelling argument for why Variant A is the better text. Cover:
1. Specific strengths of Variant A (cite exact passages)
2. Specific weaknesses of Variant B compared to A
3. Which dimensions (${Object.keys(QUALITY_DIMENSIONS).join(', ')}) A excels in

Be specific and evidence-based. Cite exact phrases from both texts.`;
}

function buildAdvocateBPrompt(variantA: TextVariation, variantB: TextVariation, advocateAArgument: string, critiqueContext: string): string {
  return `You are Advocate B in a structured debate about text quality. Advocate A has already argued for Variant A. Your job is to rebut their argument and argue why Variant B is superior.

## Variant A
<<<CONTENT>>>
${variantA.text}
<<</CONTENT>>>

## Variant B (you are advocating for this)
<<<CONTENT>>>
${variantB.text}
<<</CONTENT>>>

## Advocate A's Argument
${advocateAArgument}
${critiqueContext}
## Task
1. Rebut Advocate A's key claims with specific counter-evidence
2. Argue why Variant B is the better text overall
3. Identify strengths in Variant B that Advocate A overlooked or dismissed

Be specific and evidence-based. Cite exact phrases from both texts.`;
}

function buildJudgePrompt(variantA: TextVariation, variantB: TextVariation, advocateAArgument: string, advocateBArgument: string): string {
  return `You are the Judge in a structured debate about text quality. Two advocates have argued for competing text variants. Synthesize their arguments into a fair verdict with actionable improvement recommendations.

## Variant A
<<<CONTENT>>>
${variantA.text}
<<</CONTENT>>>

## Variant B
<<<CONTENT>>>
${variantB.text}
<<</CONTENT>>>

## Advocate A's Argument (for Variant A)
${advocateAArgument}

## Advocate B's Argument (for Variant B)
${advocateBArgument}

## Task
Produce a JSON verdict with these fields:
- "winner": "A" or "B" or "tie"
- "reasoning": 1-2 sentence summary of why
- "strengths_from_a": array of specific strengths to preserve from Variant A
- "strengths_from_b": array of specific strengths to preserve from Variant B
- "improvements": array of specific actionable improvements for the synthesis

Output ONLY valid JSON, no other text.`;
}

interface JudgeVerdict {
  winner: 'A' | 'B' | 'tie';
  reasoning: string;
  strengths_from_a: string[];
  strengths_from_b: string[];
  improvements: string[];
}

function parseJudgeResponse(response: string): JudgeVerdict | null {
  try {
    const data = extractJSON<{ winner?: string; reasoning?: string; strengths_from_a?: string[]; strengths_from_b?: string[]; improvements?: string[] }>(response);
    if (!data || !data.winner || !Array.isArray(data.strengths_from_a) || !Array.isArray(data.strengths_from_b)) return null;
    return {
      winner: data.winner as 'A' | 'B' | 'tie',
      reasoning: data.reasoning ?? '',
      strengths_from_a: data.strengths_from_a,
      strengths_from_b: data.strengths_from_b,
      improvements: data.improvements ?? [],
    };
  } catch {
    return null;
  }
}

function buildSynthesisPrompt(
  variantA: TextVariation,
  variantB: TextVariation,
  verdict: JudgeVerdict,
  metaFeedback: string | null,
): string {
  const metaSection = metaFeedback ? `\n## Meta-Review Feedback\n${metaFeedback}\n` : '';

  return `You are an expert writing editor. A debate between two text variants has produced a verdict. Your job is to synthesize a new, improved version that combines the best of both.

## Variant A
<<<CONTENT>>>
${variantA.text}
<<</CONTENT>>>

## Variant B
<<<CONTENT>>>
${variantB.text}
<<</CONTENT>>>

## Judge's Verdict
Winner: ${verdict.winner}
Reasoning: ${verdict.reasoning}

### Strengths to Preserve from Variant A
${verdict.strengths_from_a.map((s) => `- ${s}`).join('\n')}

### Strengths to Preserve from Variant B
${verdict.strengths_from_b.map((s) => `- ${s}`).join('\n')}

### Improvements to Apply
${verdict.improvements.map((s) => `- ${s}`).join('\n')}
${metaSection}
## Task
Create a new text that combines the identified strengths from both variants and applies all suggested improvements. The result should be strictly better than either parent.
${FORMAT_RULES}
Output ONLY the synthesized text, no explanations.`;
}

/** Format existing ReflectionAgent critiques as context for debate prompts. */
function formatCritiqueContext(variantA: TextVariation, variantB: TextVariation, state: PipelineState): string {
  const formatOne = (id: string, label: string): string | null => {
    const critique = getCritiqueForVariant(id, state);
    if (!critique) return null;
    const suggestions = getImprovementSuggestions(critique);
    return suggestions.length > 0 ? `\n## Known Issues with ${label}\n${suggestions.join('\n')}` : null;
  };

  const parts = [
    formatOne(variantA.id, 'Variant A'),
    formatOne(variantB.id, 'Variant B'),
  ].filter((p): p is string => p !== null);

  return parts.join('\n');
}

// ─── DebateAgent ────────────────────────────────────────────────

/** Sentinel class for debate turn failures — carries the failure point label for detail reporting. */
class DebateTurnError extends Error {
  constructor(readonly failurePoint: string, readonly label: string, cause: unknown) {
    super(`${label} failed: ${cause}`);
  }
}

export class DebateAgent extends AgentBase {
  readonly name = 'debate';

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, llmClient, logger } = ctx;

    // Select top 2 non-baseline variants by rating
    const topVariants = state.getTopByRating(state.pool.length)
      .filter((v) => v.strategy !== BASELINE_STRATEGY);

    if (topVariants.length < 2) {
      return this.failResult('Need 2+ non-baseline variants', ctx);
    }

    const variantA = topVariants[0];
    const variantB = topVariants[1];
    const ordinalA = getOrdinal(state.ratings.get(variantA.id) ?? createRating());
    const ordinalB = getOrdinal(state.ratings.get(variantB.id) ?? createRating());

    logger.info('Debate start', {
      variantAId: variantA.id.slice(0, 8),
      variantBId: variantB.id.slice(0, 8),
      variantAOrdinal: ordinalA,
      variantBOrdinal: ordinalB,
    });

    // Build detail progressively — transcript accumulates as turns succeed
    const detailTranscript: DebateExecutionDetail['transcript'] = [];

    const buildDetail = (overrides?: Partial<DebateExecutionDetail>): DebateExecutionDetail => ({
      detailType: 'debate',
      variantA: { id: variantA.id, ordinal: ordinalA },
      variantB: { id: variantB.id, ordinal: ordinalB },
      transcript: detailTranscript,
      totalCost: ctx.costTracker.getAgentCost(this.name),
      ...overrides,
    });

    const transcript: DebateTranscript = {
      variantAId: variantA.id,
      variantBId: variantB.id,
      turns: [],
      synthesisVariantId: null,
      iteration: state.iteration,
    };

    /** Run a debate turn: complete the prompt, record to both transcripts, return response.
     *  Re-throws BudgetExceededError; wraps all other errors in DebateTurnError. */
    type DebateRole = 'advocate_a' | 'advocate_b' | 'judge';
    const runTurn = async (prompt: string, role: DebateRole, failurePoint: string, label: string): Promise<string> => {
      try {
        const response = await llmClient.complete(prompt, this.name);
        transcript.turns.push({ role, content: response });
        detailTranscript.push({ role, content: response });
        return response;
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;
        throw new DebateTurnError(failurePoint, label, error);
      }
    };

    /** Fail the debate: save transcript, log, and return a failure result. */
    const failDebate = (error: string, detailOverrides?: Partial<DebateExecutionDetail>): AgentResult => {
      state.debateTranscripts.push(transcript);
      logger.error(error);
      return this.failResult(error, ctx, { executionDetail: buildDetail(detailOverrides) });
    };

    const critiqueContext = formatCritiqueContext(variantA, variantB, state);

    // Run the 3-turn debate: Advocate A -> Advocate B -> Judge
    let advocateAResponse: string;
    let advocateBResponse: string;
    let verdict: JudgeVerdict | null;
    try {
      advocateAResponse = await runTurn(
        buildAdvocateAPrompt(variantA, variantB, critiqueContext), 'advocate_a', 'advocate_a', 'Advocate A',
      );
      advocateBResponse = await runTurn(
        buildAdvocateBPrompt(variantA, variantB, advocateAResponse, critiqueContext), 'advocate_b', 'advocate_b', 'Advocate B',
      );
      const judgeResponse = await runTurn(
        buildJudgePrompt(variantA, variantB, advocateAResponse, advocateBResponse), 'judge', 'judge', 'Judge',
      );
      verdict = parseJudgeResponse(judgeResponse);
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      if (error instanceof DebateTurnError) {
        return failDebate(error.message, { failurePoint: error.failurePoint as DebateExecutionDetail['failurePoint'] });
      }
      throw error;
    }

    if (!verdict) {
      return failDebate('Judge response parse failed', { failurePoint: 'parse' });
    }

    const judgeVerdict: DebateExecutionDetail['judgeVerdict'] = {
      winner: verdict.winner,
      reasoning: verdict.reasoning,
      strengthsFromA: verdict.strengths_from_a,
      strengthsFromB: verdict.strengths_from_b,
      improvements: verdict.improvements,
    };

    logger.info('Judge verdict', { winner: verdict.winner, reasoning: verdict.reasoning });

    // Synthesis: generate improved variant using judge's recommendations
    let synthesisText: string;
    try {
      const metaFeedback = formatMetaFeedback(state.metaFeedback);
      const synthesisPrompt = buildSynthesisPrompt(variantA, variantB, verdict, metaFeedback);
      synthesisText = await llmClient.complete(synthesisPrompt, this.name);
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      return failDebate(`Synthesis failed: ${error}`, { judgeVerdict, failurePoint: 'synthesis' });
    }

    // Validate format
    const fmtResult = validateFormat(synthesisText);
    if (!fmtResult.valid) {
      return failDebate(`Format invalid: ${fmtResult.issues.join(', ')}`, {
        judgeVerdict, formatValid: false, formatIssues: fmtResult.issues, failurePoint: 'format',
      });
    }

    // Add synthesized variant to pool
    const maxVersion = Math.max(variantA.version, variantB.version);
    const newVariant: TextVariation = createTextVariation({
      text: synthesisText.trim(),
      version: maxVersion + 1,
      parentIds: [variantA.id, variantB.id],
      strategy: 'debate_synthesis',
      iterationBorn: state.iteration,
    });

    state.addToPool(newVariant);
    transcript.synthesisVariantId = newVariant.id;
    state.debateTranscripts.push(transcript);

    logger.info('Debate synthesis complete', {
      variantId: newVariant.id,
      textLength: newVariant.text.length,
      winner: verdict.winner,
    });

    return this.successResult(ctx, {
      variantsAdded: 1,
      executionDetail: buildDetail({
        judgeVerdict,
        synthesisVariantId: newVariant.id,
        synthesisTextLength: newVariant.text.length,
        formatValid: true,
      }),
    });
  }

  estimateCost(payload: AgentPayload): number {
    const textTokens = Math.ceil(payload.originalText.length / 4);
    const promptOverhead = 500;
    const inputPerCall = textTokens * 2 + promptOverhead;
    const outputPerCall = 400;
    const rate = { input: 0.0008, output: 0.004 }; // per 1M tokens
    const costPerCall = (inputPerCall / 1_000_000) * rate.input + (outputPerCall / 1_000_000) * rate.output;
    return costPerCall * 4; // 4 sequential calls
  }

  canExecute(state: PipelineState): boolean {
    return countNonBaseline(state) >= 2;
  }
}
