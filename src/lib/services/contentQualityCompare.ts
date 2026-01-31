// Position-bias-free article comparison using LLM-as-judge.
// Ported from Python compare.py — dual verdict types: independent scoring and pairwise comparison.

import { callOpenAIModel, lighter_model } from './llms';
import {
  articleScoreSchema,
  comparisonResultSchema,
  type ArticleScore,
  type ComparisonResult,
} from '@/lib/schemas/schemas';
import { logger } from '@/lib/server_utilities';

// =============================================================================
// INDEPENDENT SCORING (each article scored separately — no position bias)
// =============================================================================

export interface IndependentVerdict {
  winner: 'A' | 'B' | null;
  scoreA: ArticleScore;
  scoreB: ArticleScore;
  margin: number;
  reasoning: string;
}

const SCORE_PROMPT = `You are an expert writing evaluator. Score this article on writing quality.

## Scoring Guidelines (1-10 scale)
- 1-3: Poor quality, significant issues
- 4-5: Below average, needs work
- 6-7: Good, minor issues
- 8-9: Very good, publication-ready
- 10: Exceptional

## Dimensions
1. **Clarity** (1-10): Can sentences be understood on first read?
2. **Structure** (1-10): Logical organization and flow?
3. **Conciseness** (1-10): Every word earns its place?
4. **Engagement** (1-10): Holds reader attention?
5. **Overall** (1-10): Holistic quality

## Article
{article}

Respond with JSON matching the schema exactly.`;

async function scoreArticle(
  article: string,
  userid: string,
): Promise<ArticleScore> {
  const prompt = SCORE_PROMPT.replace('{article}', article.slice(0, 6000));

  const raw = await callOpenAIModel(
    prompt,
    'content_quality_compare_score',
    userid,
    lighter_model,
    false,
    null,
    articleScoreSchema,
    'ArticleScore',
  );

  if (!raw || raw.trim() === '') {
    throw new Error('Empty response from LLM during article scoring');
  }

  return articleScoreSchema.parse(JSON.parse(raw));
}

/**
 * Compare articles by scoring each independently (no position bias possible).
 * Winner is determined by comparing overall scores with minimum margin.
 */
export async function compareArticlesIndependent(
  articleA: string,
  articleB: string,
  userid: string,
  minMargin: number = 1,
): Promise<IndependentVerdict> {
  const [scoreA, scoreB] = await Promise.all([
    scoreArticle(articleA, userid),
    scoreArticle(articleB, userid),
  ]);

  const margin = scoreA.overall - scoreB.overall;

  let winner: 'A' | 'B' | null;
  let reasoning: string;

  if (margin >= minMargin) {
    winner = 'A';
    reasoning = `Article A scored ${scoreA.overall}/10 vs B's ${scoreB.overall}/10 (margin: +${margin})`;
  } else if (margin <= -minMargin) {
    winner = 'B';
    reasoning = `Article B scored ${scoreB.overall}/10 vs A's ${scoreA.overall}/10 (margin: +${-margin})`;
  } else {
    winner = null;
    reasoning = `Scores too close: A=${scoreA.overall}/10, B=${scoreB.overall}/10 (margin: ${Math.abs(margin)})`;
  }

  return { winner, scoreA, scoreB, margin, reasoning };
}

// =============================================================================
// PAIRWISE COMPARISON with position bias mitigation (F(A,B) + F(B,A))
// =============================================================================

export interface ComparisonVerdict {
  winner: 'A' | 'B' | null;
  confident: boolean;
  resultAB: ComparisonResult;
  resultBA: ComparisonResult;
  reasoning: string;
}

const COMPARE_PROMPT = `You are an expert writing evaluator. Compare these two articles and determine which is better written.

## Evaluation Criteria
- Clarity: Can sentences be understood on first read?
- Structure: Is there logical organization and flow?
- Conciseness: Does every word earn its place?
- Engagement: Does it hold the reader's attention?
- Specificity: Concrete details vs generic platitudes?

## Anti-Bias Rules
- Length != quality (shorter can be better)
- Fancy vocabulary != quality (clear > clever)
- Evaluate WRITING quality, not content agreement
- Do not favor based on position (first vs second)

## Article 1
{article_1}

## Article 2
{article_2}

## Task
Compare the two articles and decide which is better written overall.
- Choose "first" if Article 1 is better
- Choose "second" if Article 2 is better
- Choose "tie" only if they are genuinely equal in quality

Respond with JSON matching the schema exactly.`;

async function runComparison(
  article1: string,
  article2: string,
  userid: string,
): Promise<ComparisonResult> {
  const prompt = COMPARE_PROMPT
    .replace('{article_1}', article1.slice(0, 4000))
    .replace('{article_2}', article2.slice(0, 4000));

  const raw = await callOpenAIModel(
    prompt,
    'content_quality_compare_pair',
    userid,
    lighter_model,
    false,
    null,
    comparisonResultSchema,
    'ComparisonResult',
  );

  if (!raw || raw.trim() === '') {
    throw new Error('Empty response from LLM during comparison');
  }

  return comparisonResultSchema.parse(JSON.parse(raw));
}

/**
 * Compare two articles with position bias mitigation.
 * Runs F(A,B) and F(B,A) — only declares a winner if both orderings agree.
 *
 * Outcomes:
 * - Same winner both orderings → confident win (A or B)
 * - Both tie → consistent tie
 * - All other disagreements → inconclusive (position bias detected)
 */
export async function compareArticles(
  articleA: string,
  articleB: string,
  userid: string,
): Promise<ComparisonVerdict> {
  // Run both orderings
  const resultAB = await runComparison(articleA, articleB, userid);
  const resultBA = await runComparison(articleB, articleA, userid);

  // In resultAB: "first" = A wins, "second" = B wins
  // In resultBA: "first" = B wins, "second" = A wins
  const aWinsInAB = resultAB.winner === 'first';
  const bWinsInAB = resultAB.winner === 'second';
  const tieInAB = resultAB.winner === 'tie';

  const bWinsInBA = resultBA.winner === 'first';
  const aWinsInBA = resultBA.winner === 'second';
  const tieInBA = resultBA.winner === 'tie';

  // A wins consistently: A wins in both orderings
  if (aWinsInAB && aWinsInBA) {
    return {
      winner: 'A',
      confident: true,
      resultAB,
      resultBA,
      reasoning: 'Article A won in both orderings, indicating a clear preference.',
    };
  }

  // B wins consistently: B wins in both orderings
  if (bWinsInAB && bWinsInBA) {
    return {
      winner: 'B',
      confident: true,
      resultAB,
      resultBA,
      reasoning: 'Article B won in both orderings, indicating a clear preference.',
    };
  }

  // Consistent tie
  if (tieInAB && tieInBA) {
    return {
      winner: null,
      confident: true,
      resultAB,
      resultBA,
      reasoning: 'Both orderings resulted in a tie, indicating equal quality.',
    };
  }

  // Inconsistent results — position bias detected
  logger.info('Position bias detected in article comparison', {
    resultAB: resultAB.winner,
    resultBA: resultBA.winner,
  });

  return {
    winner: null,
    confident: false,
    resultAB,
    resultBA,
    reasoning: `Inconsistent results: F(A,B) chose ${resultAB.winner}, F(B,A) chose ${resultBA.winner}. Position bias detected; no reliable winner.`,
  };
}
