// Revision action selection and prompt construction for tree-of-thought beam search.
// Selects diverse revision actions from critique data and builds per-action LLM prompts.

import type { Critique } from '../types';
import type { RevisionAction, RevisionActionType } from './types';
import { FORMAT_RULES } from '../agents/formatRules';
import { formatFrictionSpots } from '../utils/frictionSpots';

/** All available action types in priority order for diversity selection. */
const ALL_ACTION_TYPES: RevisionActionType[] = [
  'edit_dimension',
  'structural_transform',
  'lexical_simplify',
  'grounding_enhance',
  'creative',
];

/**
 * Select B diverse revision actions from critique data.
 * Enforces action-type diversity: each action uses a different RevisionActionType.
 * The first action is always `edit_dimension` targeting the weakest critique dimension.
 */
export function selectRevisionActions(
  critique: Critique,
  branchingFactor: number,
  weakestDimensionOverride?: string,
): RevisionAction[] {
  const actions: RevisionAction[] = [];
  const usedTypes = new Set<RevisionActionType>();

  // 1. First slot: edit_dimension targeting weakest critique dimension
  //    If override provided (from cross-scale flow analysis), use it instead.
  if (weakestDimensionOverride) {
    actions.push({
      type: 'edit_dimension',
      dimension: weakestDimensionOverride,
      description: `Improve ${weakestDimensionOverride} (flow-aware target)`,
    });
    usedTypes.add('edit_dimension');
  } else {
    const weakestDim = getWeakestDimensions(critique, 1)[0];
    if (weakestDim) {
      actions.push({
        type: 'edit_dimension',
        dimension: weakestDim.dimension,
        description: `Improve ${weakestDim.dimension} (score: ${weakestDim.score}/10)`,
      });
      usedTypes.add('edit_dimension');
    }
  }

  // 2. Fill remaining slots with diverse action types
  const remainingTypes = ALL_ACTION_TYPES.filter((t) => !usedTypes.has(t));
  for (const actionType of remainingTypes) {
    if (actions.length >= branchingFactor) break;
    actions.push(buildActionForType(actionType, critique));
    usedTypes.add(actionType);
  }

  return actions.slice(0, branchingFactor);
}

/** Build a revision prompt for a given text and action, optionally including friction spots. */
export function buildRevisionPrompt(text: string, action: RevisionAction, frictionSpots?: string[]): string {
  const frictionSection = formatFrictionSpots(frictionSpots ?? []);
  switch (action.type) {
    case 'edit_dimension':
      return buildEditDimensionPrompt(text, action, frictionSection);
    case 'structural_transform':
      return buildStructuralTransformPrompt(text, frictionSection);
    case 'lexical_simplify':
      return buildLexicalSimplifyPrompt(text, frictionSection);
    case 'grounding_enhance':
      return buildGroundingEnhancePrompt(text, frictionSection);
    case 'creative':
      return buildCreativePrompt(text, frictionSection);
  }
}

// ─── Internal helpers ────────────────────────────────────────────

interface DimensionScore {
  dimension: string;
  score: number;
}

function getWeakestDimensions(critique: Critique, n: number): DimensionScore[] {
  return Object.entries(critique.dimensionScores)
    .sort((a, b) => a[1] - b[1])
    .slice(0, n)
    .map(([dimension, score]) => ({ dimension, score }));
}

function buildActionForType(actionType: RevisionActionType, critique: Critique): RevisionAction {
  switch (actionType) {
    case 'edit_dimension': {
      const dims = getWeakestDimensions(critique, 2);
      const dim = dims[1] ?? dims[0];
      return {
        type: 'edit_dimension',
        dimension: dim?.dimension ?? 'clarity',
        description: dim ? `Improve ${dim.dimension} (score: ${dim.score}/10)` : 'Improve clarity',
      };
    }
    case 'structural_transform':
      return { type: 'structural_transform', description: 'Restructure for better flow and coherence' };
    case 'lexical_simplify':
      return { type: 'lexical_simplify', description: 'Simplify language for accessibility' };
    case 'grounding_enhance':
      return { type: 'grounding_enhance', description: 'Add concrete examples and evidence' };
    case 'creative':
      return { type: 'creative', description: 'Rethink engagement hooks and narrative approach' };
  }
}

function buildEditDimensionPrompt(text: string, action: RevisionAction, frictionSection: string): string {
  return `You are a surgical writing editor. Fix ONLY the identified weakness while preserving all other qualities of the text.

## Text to Edit
${text}

## Weakness to Fix: ${(action.dimension ?? 'clarity').toUpperCase()}
${action.description}
${frictionSection}
## Instructions
- Rewrite ONLY the sections exhibiting this weakness
- Do NOT alter sections that are working well
- Preserve structure, tone, and all other qualities
- Keep the same overall length (within 10%)

${FORMAT_RULES}

Output ONLY the complete revised text, nothing else.`;
}

function buildStructuralTransformPrompt(text: string, frictionSection: string): string {
  return `You are an expert writing editor specializing in structure and organization.

## Text to Restructure
${text}
${frictionSection}
## Instructions
- Reorganize sections for better logical flow
- Improve transitions between paragraphs
- Ensure the argument builds progressively
- You may reorder, merge, or split sections
- Preserve the core content and meaning
- Keep the same overall length (within 15%)

${FORMAT_RULES}

Output ONLY the complete revised text, nothing else.`;
}

function buildLexicalSimplifyPrompt(text: string, frictionSection: string): string {
  return `You are an expert writing editor specializing in plain language.

## Text to Simplify
${text}
${frictionSection}
## Instructions
- Replace jargon and complex words with simpler alternatives
- Shorten overly long sentences
- Remove unnecessary qualifiers and hedging
- Make the text accessible to a general audience
- Preserve the core meaning and technical accuracy
- Keep the same overall length (within 10%)

${FORMAT_RULES}

Output ONLY the complete revised text, nothing else.`;
}

function buildGroundingEnhancePrompt(text: string, frictionSection: string): string {
  return `You are an expert writing editor specializing in evidence and examples.

## Text to Enhance
${text}
${frictionSection}
## Instructions
- Add concrete examples, analogies, or evidence where claims are abstract
- Ground generalizations with specific instances
- Strengthen weak points with supporting detail
- Do not invent false statistics or citations
- Preserve structure and flow
- Length may increase by up to 20%

${FORMAT_RULES}

Output ONLY the complete revised text, nothing else.`;
}

function buildCreativePrompt(text: string, frictionSection: string): string {
  return `You are a creative writing editor who makes articles compelling and memorable.

## Text to Reimagine
${text}
${frictionSection}
## Instructions
- Rethink the opening hook to grab attention
- Improve narrative arc and reader journey
- Add vivid language, metaphors, or storytelling elements where appropriate
- Make the conclusion more impactful and memorable
- Preserve factual accuracy and core arguments
- Keep the same overall length (within 15%)

${FORMAT_RULES}

Output ONLY the complete revised text, nothing else.`;
}
