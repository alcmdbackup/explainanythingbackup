// Frozen prompt strings for the 4-arm experiment validating how implied-rubric weights are
// driven by the underlying holistic prompt. Lives here (not in the planning doc) so the
// analysis script + the create-session UI's Arm-preset dropdown reference a single source of
// truth.
//
// IMPORTANT — keep this module client-safe (no node: imports). The create-session form
// imports EXPERIMENT_ARMS for its Arm-preset dropdown auto-fill, so any Node-only dep here
// breaks the client bundle. SHA-256 hashing + verification live in `experimentArmsHashing.ts`
// (server-only — imported only by the analysis script + tests).
//
// See: docs/planning/evalute_implied_rubric_results_and_experimentally_validate_20260623/

export type ArmKey = 'A' | 'B' | 'C' | 'D';

export interface ExperimentArm {
  /** Display label for UI + reports. */
  label: string;
  /** One-line description of what the arm tests. */
  description: string;
  /** The holistic-prompt override string. NULL = Arm A (use the hardcoded default). */
  prompt: string | null;
}

// ─── Arm A — Control ───────────────────────────────────────────────────────
// `prompt: null` = use the existing hardcoded checklist in buildComparisonPrompt's article-mode
// branch. The "canonical override string" for hash-verification purposes is the literal rubric
// block (the "## Evaluation Criteria" + 5 bullet list) from computeRatings.ts:509-515 — exported
// below as ARM_A_CANONICAL_RUBRIC_BLOCK so the analysis script can hash-compare consistently.

export const ARM_A_CANONICAL_RUBRIC_BLOCK = [
  '## Evaluation Criteria',
  'Consider the following when making your decision:',
  '- Clarity and readability',
  '- Structure and flow',
  '- Engagement and impact',
  '- Grammar and style',
  '- Overall effectiveness',
].join('\n');

// ─── Arm B — Stripped ──────────────────────────────────────────────────────
// Removes the checklist entirely. The model picks its own bases for comparison.

const ARM_B_PROMPT = [
  '## Evaluation',
  'Decide which version is better overall. Differences are often small — answer TIE only if the two are genuinely indistinguishable in quality.',
].join('\n');

// ─── Arm C — Aligned ───────────────────────────────────────────────────────
// Holistic checklist = the 5 session criteria verbatim, with descriptions matching the
// per-criterion rubric prompt's `${name}: ${description}` granularity (research Finding 3).
// Tier anchors are intentionally NOT included — they'd bloat the holistic prompt without
// adding alignment value.

const ARM_C_PROMPT = [
  '## Evaluation Criteria',
  'Consider the following when making your decision:',
  '- sentence_variety: Variation in sentence length and structure across paragraphs to maintain rhythm.',
  '- tone: Voice and register; consistency with the article\'s intent (educational, persuasive, etc.).',
  '- depth: Quality of detail, technical accuracy, and explanation of mechanisms.',
  '- structure: Logical flow between sections, paragraph organization, and transitions.',
  '- clarity: How easy the article is to read for the target audience.',
].join('\n');

// ─── Arm D — Inverted ──────────────────────────────────────────────────────
// Deliberately omits clarity and amplifies depth + structure — the two currently-zeroed
// criteria in the baseline runs. Directional prediction: if priming is causal, weights
// shift toward depth + structure.

const ARM_D_PROMPT = [
  '## Evaluation Criteria',
  'Consider the following when making your decision:',
  '- Depth — quality of detail, technical accuracy, and explanation of mechanisms',
  '- Structure — logical flow between sections, paragraph organization, and transitions',
  '- Technical accuracy — claims are grounded and verifiable',
  '- Factual precision — specific numbers/dates/mechanisms are correct',
  '- Completeness — covers the question without leaving load-bearing gaps',
].join('\n');

export const EXPERIMENT_ARMS: Record<ArmKey, ExperimentArm> = {
  A: {
    label: 'Arm A — Control',
    description: 'Current hardcoded checklist (existing baseline runs).',
    prompt: null,
  },
  B: {
    label: 'Arm B — Stripped',
    description: 'No checklist; model picks its own bases for comparison.',
    prompt: ARM_B_PROMPT,
  },
  C: {
    label: 'Arm C — Aligned',
    description: 'Holistic checklist = the 5 session criteria with descriptions.',
    prompt: ARM_C_PROMPT,
  },
  D: {
    label: 'Arm D — Inverted',
    description: 'Omits clarity, amplifies depth + structure.',
    prompt: ARM_D_PROMPT,
  },
};
