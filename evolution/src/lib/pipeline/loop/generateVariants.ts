// Generates new text variants using parallel LLM strategies with format validation.

import type { Variant, EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import type { EvolutionConfig } from '../infra/types';
import type { EntityLogger } from '../infra/createEntityLogger';
import type { GenerationGuidanceEntry } from '../../schemas';
import { BudgetExceededError, BudgetExceededWithPartialResults } from '../../types';
import { validateFormat } from '../../shared/enforceVariantFormat';
import { createVariant } from '../../types';
import { buildEvolutionPrompt } from './buildPrompts';

// ─── Strategy prompts ────────────────────────────────────────────

const STRATEGIES = [
  'structural_transform',
  'lexical_simplify',
  'grounding_enhance',
  'engagement_amplify',
  'style_polish',
  'argument_fortify',
  'narrative_weave',
  'tone_transform',
] as const;

const STRATEGY_INSTRUCTIONS: Record<(typeof STRATEGIES)[number], { preamble: string; instructions: string }> = {
  structural_transform: {
    preamble: 'You are an expert writing editor. AGGRESSIVELY restructure this text with full creative freedom.',
    instructions: 'Reorder sections, paragraphs, and ideas. Merge, split, or eliminate sections. Invert the structure (conclusion-first, bottom-up, problem-solution, narrative arc). Change heading hierarchy. Reorganize by chronological, thematic, comparative, or other principle. MUST preserve original intention, meaning, and all key points exactly. Do not add, remove, or alter the substance.\n\nOutput a radically restructured version. Same core message, completely different organization. Do NOT make timid, incremental changes — reimagine the organization from scratch.',
  },
  lexical_simplify: {
    preamble: 'You are an expert writing editor. Simplify the language of this text.',
    instructions: 'Replace complex words with simpler alternatives. Shorten overly long sentences. Remove unnecessary jargon. Improve accessibility. Maintain the meaning.\n\nOutput a lexically simplified version.',
  },
  grounding_enhance: {
    preamble: 'You are an expert writing editor. Make this text more concrete and grounded.',
    instructions: 'Add specific examples and details. Make abstract concepts concrete. Include sensory details. Strengthen connection to real-world experience. Maintaining the core message.\n\nOutput a more grounded and concrete version.',
  },
  engagement_amplify: {
    preamble: 'You are an expert writing editor specializing in reader engagement and impact.',
    instructions: 'Transform this text to maximize reader engagement. Strengthen opening hooks to grab attention. Create curiosity gaps that drive reading forward. Add surprising or counter-intuitive insights. Build narrative tension and resolution. Vary sentence length and rhythm for pacing. Strengthen conclusions with actionable takeaways. Do NOT change the core message — reshape existing content for maximum impact.\n\nOutput a more engaging version.',
  },
  style_polish: {
    preamble: 'You are an expert writing editor specializing in sentence-level clarity and grace.',
    instructions: 'Polish this text for maximum readability and rhetorical elegance. Fix grammatical errors and awkward constructions. Improve parallel structure. Vary sentence length and complexity. Eliminate redundancy and wordiness. Use strong verbs. Break long sentences where clarity improves. Strengthen transitions. Create rhythmic flow. Do NOT restructure paragraphs or change meaning — only refine sentences.\n\nOutput a polished version.',
  },
  argument_fortify: {
    preamble: 'You are an expert writing editor and critical thinker specializing in argument strength.',
    instructions: 'Strengthen the logical foundation of this text. Reinforce claims with better evidence or reasoning. Add nuance to oversimplified statements. Anticipate counterarguments. Clarify cause-effect relationships. Remove logical gaps. Deepen explanations for shallow claims. Do NOT change the core thesis — strengthen the scaffolding.\n\nOutput a logically stronger version.',
  },
  narrative_weave: {
    preamble: 'You are an expert writing editor specializing in narrative arc and reader momentum.',
    instructions: 'Reshape this text for compelling narrative flow and pacing. Identify the core tension or question driving the piece. Build momentum from exposition through climax to resolution. Vary pace: slow for complex ideas, accelerate for excitement. Place surprising insights where they maximize impact. Structure reveals strategically. Preserve all content — only reshape sequence and pacing.\n\nOutput a version with stronger narrative flow.',
  },
  tone_transform: {
    preamble: 'You are an expert writing editor specializing in voice and tone transformation.',
    instructions: 'Transform this text into a more vivid, distinctive voice. Replace passive constructions with active phrasing. Use more specific, evocative word choices. Adopt a confident and direct tone. Eliminate hedging language. Use concrete language over abstractions. Maintain all factual content and structure — only transform voice and style.\n\nOutput a version with a stronger, more distinctive voice.',
  },
};

/** Returns the list of all known generation strategy names. */
export function getKnownStrategyNames(): readonly string[] {
  return STRATEGIES;
}

// ─── Generation guidance helpers ────────────────────────────────

/** Build default guidance distributing percentages evenly across all strategies. */
export function buildDefaultGuidance(): GenerationGuidanceEntry[] {
  const base = Math.floor(100 / STRATEGIES.length);
  const remainder = 100 - base * STRATEGIES.length;
  return STRATEGIES.map((s, i) => ({
    strategy: s,
    percent: base + (i < remainder ? 1 : 0),
  }));
}

/** Weighted random sampling without replacement. Picks `count` strategies from guidance entries. */
export function selectStrategies(
  guidance: readonly GenerationGuidanceEntry[],
  count: number,
): string[] {
  if (count >= guidance.length) return guidance.map((g) => g.strategy);

  const selected: string[] = [];
  const remaining = guidance.map((g) => ({ ...g }));
  let totalWeight = remaining.reduce((sum, g) => sum + g.percent, 0);

  for (let i = 0; i < count; i++) {
    const roll = Math.random() * totalWeight;
    let cumulative = 0;
    for (let j = 0; j < remaining.length; j++) {
      const entry = remaining[j]!;
      cumulative += entry.percent;
      if (roll < cumulative) {
        selected.push(entry.strategy);
        totalWeight -= entry.percent;
        remaining.splice(j, 1);
        break;
      }
    }
  }
  return selected;
}

function buildPrompt(
  text: string,
  strategy: string,
  feedback?: { weakestDimension: string; suggestions: string[] },
): string {
  const def = STRATEGY_INSTRUCTIONS[strategy as (typeof STRATEGIES)[number]];
  if (!def) throw new Error(`Unknown generation strategy: ${strategy}`);
  return buildEvolutionPrompt(def.preamble, 'Original Text', text, def.instructions, feedback);
}

// ─── Result type ─────────────────────────────────────────────────

/** Per-strategy metadata for execution detail tracking. */
export interface StrategyResult {
  name: string;
  promptLength: number;
  status: 'success' | 'format_rejected' | 'error';
  formatIssues?: string[];
  variantId?: string;
  textLength?: number;
  error?: string;
}

/** Extended result from generateVariants with per-strategy metadata. */
export interface GenerationResult {
  variants: Variant[];
  strategyResults: StrategyResult[];
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Generate new text variants using parallel LLM strategies.
 * Returns validated variants and per-strategy metadata.
 * Throws BudgetExceededWithPartialResults if budget exceeded mid-generation.
 */
export async function generateVariants(
  text: string,
  iteration: number,
  llm: EvolutionLLMClient,
  config: EvolutionConfig,
  feedback?: { weakestDimension: string; suggestions: string[] },
  logger?: EntityLogger,
): Promise<GenerationResult> {
  // When generationGuidance is provided, use weighted selection. Otherwise, use the original
  // deterministic slice behavior for backward compatibility.
  const hasGuidance = config.generationGuidance !== undefined;
  const guidance = config.generationGuidance ?? buildDefaultGuidance();
  const count = Math.min(config.strategiesPerRound ?? 3, guidance.length);
  const activeStrategies = hasGuidance ? selectStrategies(guidance, count) : guidance.slice(0, count).map((g) => g.strategy);
  logger?.info(`Generating with ${activeStrategies.length} strategies: ${activeStrategies.join(', ')}`, { phaseName: 'generation', iteration });

  const strategyResults: StrategyResult[] = [];

  const results = await Promise.allSettled(
    activeStrategies.map(async (strategy) => {
      const prompt = buildPrompt(text, strategy, feedback);
      const stratResult: StrategyResult = { name: strategy, promptLength: prompt.length, status: 'success' };
      let variant: ReturnType<typeof createVariant> | null = null;

      try {
        const generated = await llm.complete(prompt, 'generation', {
          model: config.generationModel as LLMCompletionOptions['model'],
        });
        const fmt = validateFormat(generated);
        if (!fmt.valid) {
          logger?.warn(`Strategy ${strategy} variant failed format validation`, { phaseName: 'generation', iteration });
          stratResult.status = 'format_rejected';
          stratResult.formatIssues = fmt.issues;
        } else {
          logger?.debug(`Strategy ${strategy} produced variant`, { phaseName: 'generation', iteration });
          variant = createVariant({ text: generated.trim(), strategy, iterationBorn: iteration, parentIds: [], version: 0 });
          stratResult.variantId = variant.id;
          stratResult.textLength = variant.text.length;
        }
      } catch (err) {
        stratResult.status = 'error';
        stratResult.error = err instanceof BudgetExceededError ? err.message : String(err).slice(0, 500);
        strategyResults.push(stratResult);
        if (err instanceof BudgetExceededError) throw err;
        return null;
      }

      strategyResults.push(stratResult);
      return variant;
    }),
  );

  const variants: Variant[] = [];
  let budgetError: BudgetExceededError | null = null;

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== null) {
      variants.push(result.value);
    } else if (result.status === 'rejected' && result.reason instanceof BudgetExceededError) {
      budgetError = budgetError ?? result.reason;
    }
  }

  if (budgetError) {
    throw new BudgetExceededWithPartialResults(variants, budgetError);
  }

  return { variants, strategyResults };
}
