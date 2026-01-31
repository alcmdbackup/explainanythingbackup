// Dimension-specific evaluation rubrics for content quality scoring.
// Ported from Python criteria.py with anchor examples and scoring guidelines.

import type { ContentQualityDimension } from '@/lib/schemas/schemas';

/**
 * Rubric text per dimension, used as part of the LLM evaluation prompt.
 * Each rubric includes: definition, scoring rubric (0.9-0.0), and anchor examples.
 */
export const DIMENSION_CRITERIA: Record<ContentQualityDimension, string> = {
  clarity: `Evaluate whether the writing is clear and easy to understand on first read.

DEFINITION:
- Sentences parse on first read without re-reading
- No ambiguous pronoun references
- Technical terms explained or used correctly
- No unnecessary jargon

SCORING RUBRIC (0-1 scale):
- 0.9-1.0: Crystal clear, every sentence immediately understood
- 0.7-0.8: Minor ambiguity, 1-2 sentences need re-reading
- 0.5-0.6: Some confusion, reader needs to re-read passages
- 0.3-0.4: Frequently unclear, meaning often ambiguous
- 0.0-0.2: Incomprehensible, fails to communicate

ANCHOR EXAMPLES:
CLEAR (0.9): "Cache reduced latency 40%. Implementation took 2 days."
UNCLEAR (0.3): "The thing with the stuff that makes it go faster was done by the team that handles those kinds of improvements."`,

  structure: `Evaluate whether the writing has clear, logical organization.

DEFINITION:
- Clear introduction, body, conclusion (if applicable)
- Logical paragraph breaks
- Smooth transitions between ideas
- Information ordered for reader comprehension
- Headers/sections used appropriately for longer content

SCORING RUBRIC (0-1 scale):
- 0.9-1.0: Perfect organization, reader never lost
- 0.7-0.8: Clear structure, minor flow issues
- 0.5-0.6: Basic structure present but could be clearer
- 0.3-0.4: Disorganized, hard to follow
- 0.0-0.2: No discernible structure

ANCHOR EXAMPLES:
WELL STRUCTURED (0.9): "Problem: API response times exceed 200ms. Analysis: Database queries account for 80% of latency. Solution: Add Redis caching. Result: Response times dropped to 50ms."
POORLY STRUCTURED (0.3): "We added caching. The API was slow. Redis helped. Queries were the issue."`,

  engagement: `Evaluate whether the writing holds reader attention.

DEFINITION:
- Compelling opening that draws reader in
- Varied sentence structure (not monotonous)
- Relevant examples and illustrations
- Active voice preferred
- Reader would want to continue reading

ANTI-BIAS NOTES:
- Long text is NOT automatically more engaging
- Formal academic style is NOT automatically more engaging
- Focus on whether reader would WANT to keep reading

SCORING RUBRIC (0-1 scale):
- 0.9-1.0: Captivating, hard to stop reading
- 0.7-0.8: Interesting, maintains attention
- 0.5-0.6: Adequate, occasionally dull
- 0.3-0.4: Boring, reader likely to skim
- 0.0-0.2: Unreadable, actively repels reader

ANCHOR EXAMPLES:
ENGAGING (0.9): "Three engineers. One impossible deadline. Zero sleep. Here's how we shipped anyway — and what we'd never do again."
NOT ENGAGING (0.3): "This document describes the software development process. The process has several steps. Each step is important."`,

  conciseness: `Evaluate whether every word earns its place. No bloat, no padding.

DEFINITION:
- Every sentence adds value
- No redundant phrases ("in order to" -> "to")
- No unnecessary qualifiers ("very", "really", "basically")
- No throat-clearing ("It is important to note that...")
- Information density is high

WHAT CONCISENESS IS NOT:
- Being short. A 1000-word piece can be concise if every word matters.
- Being terse to the point of unclear. Clarity > brevity.

SCORING RUBRIC (0-1 scale):
- 0.9-1.0: Every word essential, nothing to cut
- 0.7-0.8: Minor bloat, 1-2 phrases could be tightened
- 0.5-0.6: Noticeable padding, ~20% could be cut
- 0.3-0.4: Significant bloat, ~40% is filler
- 0.0-0.2: Mostly padding, buries the point

ANCHOR EXAMPLES:
CONCISE (0.9): "Cache reduced latency 40%. Implementation took 2 days."
NOT CONCISE (0.3): "It is important to note that the implementation of the caching solution that we decided to implement basically reduced the latency by approximately 40 percent, which is really quite significant."`,

  coherence: `Evaluate whether the writing is internally consistent with no contradictions.

DEFINITION:
- No contradictory statements
- Consistent terminology throughout
- Claims align with evidence provided
- No logical gaps or non-sequiturs
- Pronouns have clear referents

SCORING RUBRIC (0-1 scale):
- 0.9-1.0: Perfectly consistent, all ideas connect logically
- 0.7-0.8: Minor inconsistencies that don't confuse
- 0.5-0.6: Some contradictions or unclear connections
- 0.3-0.4: Multiple contradictions, hard to follow logic
- 0.0-0.2: Fundamentally incoherent, contradicts itself

ANCHOR EXAMPLES:
COHERENT (0.9): "Response times improved 40% after adding caching. Users reported faster load times in the survey. Support tickets about slowness dropped by half."
INCOHERENT (0.3): "Response times improved 40% after adding caching. However, users complained the site felt slower. We recommend removing caching to improve performance."`,

  specificity: `Evaluate whether the writing uses specific, concrete language vs generic platitudes.

GENERIC LANGUAGE TO FLAG:
- "best practices" (which ones?)
- "industry standard" (what standard?)
- "robust solution" / "scalable architecture" (how?)
- "innovative approach" (what's innovative about it?)

SPECIFIC LANGUAGE LOOKS LIKE:
- Numbers: "reduced load time from 3s to 400ms"
- Names: "using Redis for caching" not "using a caching solution"
- Examples: "like Stripe's versioned API" not "like major companies"
- Mechanisms: "by batching database writes" not "by optimizing"

THE TEST: Can a reader act on this?

SCORING RUBRIC (0-1 scale):
- 0.9-1.0: Concrete throughout, reader can act on every claim
- 0.7-0.8: Mostly specific, 1-2 vague assertions
- 0.5-0.6: Mix of specific and generic
- 0.3-0.4: Heavy on buzzwords and platitudes
- 0.0-0.2: All generic, no actionable specifics

ANCHOR EXAMPLES:
SPECIFIC (0.9): "We reduced API latency from 200ms to 50ms by adding Redis caching with a 5-minute TTL for user session data."
GENERIC (0.3): "We leveraged cutting-edge caching solutions to dramatically improve performance using industry best practices."`,

  point_of_view: `Evaluate whether the writing takes a clear position vs sitting on the fence.

STRONG POINT OF VIEW:
- States a clear position or recommendation
- Willing to say "X is better than Y" with reasoning
- Author's perspective is evident

WEAK POINT OF VIEW:
- "It depends" without saying on what
- "Both have pros and cons" without a recommendation
- Lists options without guidance

WHEN NEUTRALITY IS APPROPRIATE:
- Factual reporting, reference documentation, genuine uncertainty

SCORING RUBRIC (0-1 scale):
- 0.9-1.0: Clear thesis, confident recommendations, takes a stance
- 0.7-0.8: Has a point of view, occasionally hedges
- 0.5-0.6: Point of view present but buried or weak
- 0.3-0.4: Mostly fence-sitting, no guidance
- 0.0-0.2: No discernible position, pure information dump

ANCHOR EXAMPLES:
STRONG POV (0.9): "Use PostgreSQL for your startup. MySQL's ecosystem is larger, but Postgres has better JSON support, and you'll need that for flexible schemas early on."
WEAK POV (0.3): "PostgreSQL and MySQL are both popular databases. Both have pros and cons. The choice depends on your needs."`,

  overall: `Evaluate the overall writing quality holistically.

This is a gestalt assessment considering:
- Clarity: Is it easy to understand?
- Structure: Is it well organized?
- Engagement: Does it hold attention?
- Purpose: Does it achieve its apparent goal?

SCORING RUBRIC (0-1 scale):
- 0.9-1.0: Publication-ready, exemplary writing
- 0.7-0.8: Good quality, minor issues only
- 0.5-0.6: Acceptable, meets minimum professional bar
- 0.3-0.4: Needs significant revision
- 0.0-0.2: Fundamentally broken, requires rewrite

ANTI-BIAS NOTES:
- Length does NOT equal quality
- Sophisticated vocabulary does NOT equal quality
- Score the WRITING, not whether you agree with the CONTENT`,
};

/** Default dimensions to evaluate when none specified */
export const DEFAULT_EVAL_DIMENSIONS: ContentQualityDimension[] = [
  'clarity', 'structure', 'engagement', 'overall',
];

/** All available dimensions */
export const ALL_EVAL_DIMENSIONS: ContentQualityDimension[] = [
  'clarity', 'structure', 'engagement', 'conciseness',
  'coherence', 'specificity', 'point_of_view', 'overall',
];
