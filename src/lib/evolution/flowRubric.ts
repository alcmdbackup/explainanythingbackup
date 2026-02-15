// Shared quality and flow dimension constants, prompt builders, parsers, and helpers.
// Central source of truth for all evaluation dimensions used across the evolution pipeline.

import { extractJSON } from './core/jsonParser';
import type { Critique } from './types';

// ─── Unified Quality Dimensions (shared by ReflectionAgent + PairwiseRanker) ──

export const QUALITY_DIMENSIONS: Record<string, string> = {
  clarity: 'Clear, understandable writing; appropriate word choice; no jargon without context',
  engagement: 'Compelling, interesting; hooks the reader; maintains attention',
  precision: 'Accurate, specific language; claims supported; no vague hand-waving',
  voice_fidelity: "Preserves the original author's tone and style",
  conciseness: 'Appropriately brief; no filler words; every sentence earns its place',
};

// ─── Flow Dimensions (dedicated flow evaluator) ──────────────────────────────

export const FLOW_DIMENSIONS: Record<string, string> = {
  local_cohesion: 'Sentence-to-sentence glue — does each sentence follow logically from the previous?',
  global_coherence: "Paragraph arc — does the article's argument build in a sensible order?",
  transition_quality: 'Transitions connect paragraphs — are there explicit bridges between ideas?',
  rhythm_variety: 'Sentence rhythm — do sentence lengths and structures vary, or is the prose monotone?',
  redundancy: 'Redundancy — is information repeated unnecessarily or do ideas advance with each sentence?',
};

// ─── Flow Comparison (pairwise A/B) ──────────────────────────────────────────

export function buildFlowComparisonPrompt(textA: string, textB: string): string {
  const dimensionsList = Object.entries(FLOW_DIMENSIONS)
    .map(([name, desc]) => `- **${name}**: ${desc}`)
    .join('\n');

  const instructionsList = Object.keys(FLOW_DIMENSIONS)
    .map((name, i) => `${i + 1}. ${name}: [A/B/TIE]`)
    .join('\n');

  const responseTemplate = Object.keys(FLOW_DIMENSIONS)
    .map((name) => `${name}: [your choice]`)
    .join('\n');

  return `You are an expert writing evaluator specializing in prose flow. Compare the following two texts on flow dimensions.

## Text A
${textA}

## Text B
${textB}

## Flow Dimensions
${dimensionsList}

## Instructions
For each dimension, rate using ONLY "A", "B", or "TIE":
${instructionsList}

Then cite 1-3 exact sentences from EACH text that disrupt flow most (friction spots).
Finally provide OVERALL_WINNER and CONFIDENCE.

Respond in this exact format:
${responseTemplate}
FRICTION_A: ["exact sentence 1", "exact sentence 2"]
FRICTION_B: ["exact sentence 1"]
OVERALL_WINNER: [your choice]
CONFIDENCE: [high/medium/low]`;
}

export interface FlowComparisonResult {
  winner: string | null;
  dimensionScores: Record<string, string>;
  confidence: number;
  frictionSpotsA: string[];
  frictionSpotsB: string[];
}

export function parseFlowComparisonResponse(response: string): FlowComparisonResult {
  const dimensionScores: Record<string, string> = {};
  let winner: string | null = null;
  let confidence = 0.7;
  let frictionSpotsA: string[] = [];
  let frictionSpotsB: string[] = [];

  const parseChoice = (value: string): 'A' | 'B' | 'TIE' | null => {
    const upper = value.trim().toUpperCase();
    if (upper.startsWith('A')) return 'A';
    if (upper.startsWith('B')) return 'B';
    if (upper.includes('TIE')) return 'TIE';
    return null;
  };

  const extractValue = (line: string): string => line.split(':').slice(1).join(':').trim();

  for (const line of response.trim().split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();

    // Parse flow dimension scores
    for (const dim of Object.keys(FLOW_DIMENSIONS)) {
      if (upper.startsWith(`${dim.toUpperCase()}:`)) {
        const choice = parseChoice(extractValue(trimmed));
        if (choice) dimensionScores[dim] = choice;
      }
    }

    // Parse friction spots
    if (upper.startsWith('FRICTION_A:')) {
      frictionSpotsA = parseFrictionArray(extractValue(trimmed));
    } else if (upper.startsWith('FRICTION_B:')) {
      frictionSpotsB = parseFrictionArray(extractValue(trimmed));
    } else if (upper.includes('OVERALL_WINNER:')) {
      const choice = parseChoice(extractValue(trimmed));
      if (choice) winner = choice;
    } else if (upper.includes('CONFIDENCE:')) {
      const value = extractValue(trimmed).toLowerCase();
      confidence = value.includes('high') ? 1.0 : value.includes('low') ? 0.5 : 0.7;
    }
  }

  // Derive winner from dimension majority if not explicit
  if (winner === null && Object.keys(dimensionScores).length > 0) {
    const aWins = Object.values(dimensionScores).filter((v) => v === 'A').length;
    const bWins = Object.values(dimensionScores).filter((v) => v === 'B').length;
    winner = aWins > bWins ? 'A' : bWins > aWins ? 'B' : 'TIE';
  }

  return { winner, dimensionScores, confidence, frictionSpotsA, frictionSpotsB };
}

/** Parse a JSON array of friction sentence strings, tolerating malformed input. */
function parseFrictionArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw.trim());
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === 'string' && s.length > 0);
  } catch {
    // Fallback: extract quoted strings
    const matches = raw.match(/"([^"]+)"/g);
    if (matches) return matches.map((m) => m.replace(/^"|"$/g, ''));
  }
  return [];
}

// ─── Flow Critique (per-variant absolute scoring) ────────────────────────────

export function buildFlowCritiquePrompt(text: string): string {
  const dimensionsList = Object.entries(FLOW_DIMENSIONS)
    .map(([name, desc]) => `- **${name}**: ${desc}`)
    .join('\n');

  const scoreExample = Object.keys(FLOW_DIMENSIONS)
    .reduce((acc, dim, i) => ({ ...acc, [dim]: Math.max(0, 5 - i) }), {} as Record<string, number>);

  return `You are an expert writing critic specializing in prose flow. Analyze this text across flow dimensions.

## Text to Analyze
<<<CONTENT>>>
${text}
<<</CONTENT>>>

## Flow Dimensions (score each 0-5)
${dimensionsList}

## Task
For each dimension:
1. Score from 0 (terrible) to 5 (excellent)
2. Cite 1-2 exact friction sentences that most disrupt flow for that dimension

## Output Format (JSON)
{
    "scores": ${JSON.stringify(scoreExample)},
    "friction_sentences": {
        "local_cohesion": ["This leads to better outcomes.", "However, the results..."],
        "rhythm_variety": ["The data shows this. The data confirms that."]
    }
}

Output ONLY valid JSON, no other text.`;
}

export interface FlowCritiqueResult {
  scores: Record<string, number>;
  frictionSentences: Record<string, string[]>;
}

export function parseFlowCritiqueResponse(response: string): FlowCritiqueResult | null {
  try {
    const data = extractJSON<{
      scores?: Record<string, number>;
      friction_sentences?: Record<string, string[] | string>;
    }>(response);
    if (!data || !data.scores || typeof data.scores !== 'object') return null;

    // Clamp scores to [0, 5]
    const scores: Record<string, number> = {};
    for (const [dim, score] of Object.entries(data.scores)) {
      if (typeof score === 'number') {
        scores[dim] = Math.max(0, Math.min(5, score));
      }
    }

    // Normalize friction sentences to arrays
    const frictionSentences: Record<string, string[]> = {};
    if (data.friction_sentences && typeof data.friction_sentences === 'object') {
      for (const [dim, sentences] of Object.entries(data.friction_sentences)) {
        if (Array.isArray(sentences)) {
          frictionSentences[dim] = sentences.filter((s) => typeof s === 'string' && s.length > 0);
        } else if (typeof sentences === 'string' && sentences.length > 0) {
          frictionSentences[dim] = [sentences];
        }
      }
    }

    return { scores, frictionSentences };
  } catch {
    return null;
  }
}

// ─── Quality Critique Prompt Builder (shared by ReflectionAgent + IterativeEditing) ──

export function buildQualityCritiquePrompt(text: string): string {
  const dimensionsList = Object.keys(QUALITY_DIMENSIONS)
    .map((d) => `- ${d}`)
    .join('\n');

  const scoreExample = Object.fromEntries(
    Object.keys(QUALITY_DIMENSIONS).map((d, i) => [d, 7 + (i % 3)]),
  );

  return `You are an expert writing critic. Analyze this text across multiple quality dimensions.

## Text to Analyze
<<<CONTENT>>>
${text}
<<</CONTENT>>>

## Dimensions to Evaluate
${dimensionsList}

## Task
For each dimension, provide:
1. A score from 1-10
2. One specific good example (quote from text)
3. One specific area for improvement (quote or describe)
4. Brief notes on what works and what doesn't

## Output Format (JSON)
{
    "scores": ${JSON.stringify(scoreExample)},
    "good_examples": {
        "clarity": "The opening paragraph clearly states..."
    },
    "bad_examples": {
        "clarity": "The phrase 'it was noted that' is vague"
    },
    "notes": {
        "clarity": "Generally clear but some passive constructions..."
    }
}

Output ONLY valid JSON, no other text.`;
}

// ─── Score Normalization ─────────────────────────────────────────────────────

export type ScaleType = '1-10' | '0-5';

/**
 * Normalize a score to [0, 1] using min-max normalization.
 * Quality (1-10): (score - 1) / 9. Flow (0-5): score / 5.
 * Clamped to [0, 1] to handle out-of-range LLM scores.
 */
export function normalizeScore(score: number, scale: ScaleType): number {
  const result = scale === '1-10'
    ? (score - 1) / 9
    : score / 5;
  return Math.max(0, Math.min(1, result));
}

// ─── Flow Critique Retrieval ─────────────────────────────────────────────────

/**
 * Find the flow critique for a variant. Filters by variationId AND scale === '0-5'.
 * Returns undefined if not found (e.g. when flow critique is disabled or old checkpoint).
 */
export function getFlowCritiqueForVariant(
  variantId: string,
  critiques: Critique[],
): Critique | undefined {
  return critiques.find(
    (c) => c.variationId === variantId && c.scale === '0-5',
  );
}

// ─── Cross-Scale Weakness Targeting ──────────────────────────────────────────

export interface WeakestDimensionResult {
  dimension: string;
  source: 'quality' | 'flow';
  normalizedScore: number;
}

// BEAM-2: When quality and flow dimensions have similar normalized scores,
// prefer quality because revision actions understand quality dimension names.
const CROSS_SCALE_MARGIN = 0.05;

/**
 * Find the single weakest dimension across quality and flow critiques.
 * Normalizes both to [0, 1] before comparison so different scales are fair.
 * Falls back to quality-only when flow critique is absent.
 *
 * BEAM-2: Quality dimensions get a small preference (CROSS_SCALE_MARGIN)
 * because revision prompts understand quality dimension names ("clarity",
 * "depth") better than flow dimension names ("local_cohesion").
 */
export function getWeakestDimensionAcrossCritiques(
  qualityCritique: Critique,
  flowCritique?: Critique,
): WeakestDimensionResult | null {
  let weakest: WeakestDimensionResult | null = null;

  // Check quality dimensions first (preferred system)
  const qualityScale: ScaleType = qualityCritique.scale ?? '1-10';
  for (const [dim, score] of Object.entries(qualityCritique.dimensionScores)) {
    const normalized = normalizeScore(score, qualityScale);
    if (weakest === null || normalized < weakest.normalizedScore) {
      weakest = { dimension: dim, source: 'quality', normalizedScore: normalized };
    }
  }

  // Check flow dimensions — must beat quality by CROSS_SCALE_MARGIN to override
  if (flowCritique) {
    const flowScale: ScaleType = flowCritique.scale ?? '0-5';
    for (const [dim, score] of Object.entries(flowCritique.dimensionScores)) {
      const normalized = normalizeScore(score, flowScale);
      const threshold = weakest !== null && weakest.source === 'quality'
        ? weakest.normalizedScore - CROSS_SCALE_MARGIN
        : weakest?.normalizedScore ?? Infinity;
      if (weakest === null || normalized < threshold) {
        weakest = { dimension: dim, source: 'flow', normalizedScore: normalized };
      }
    }
  }

  return weakest;
}
