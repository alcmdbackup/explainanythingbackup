// Core beam search algorithm for tree-of-thought revision strategy.
// Maintains top-K candidates at each depth, generates B revisions per candidate, evaluates via hybrid two-stage filter.

import { v4 as uuidv4 } from 'uuid';
import type { ExecutionContext, Critique, TextVariation } from '../types';
import { BudgetExceededError } from '../types';
import type { TreeState, TreeSearchResult, BeamSearchConfig, TreeNode } from './types';
import { DEFAULT_BEAM_SEARCH_CONFIG } from './types';
import { createRootNode, createChildNode, getPath, getBestLeaf, pruneSubtree } from './treeNode';
import { selectRevisionActions, buildRevisionPrompt } from './revisionActions';
import { filterByParentComparison, rankSurvivors } from './evaluator';
import type { EvalCandidate } from './evaluator';
import { validateFormat } from '../agents/formatValidator';
import { compareWithDiff } from '../diffComparison';
import { compareWithBiasMitigation } from '../comparison';
import { extractJSON } from '../core/jsonParser';

/**
 * Run beam search starting from a root variant with its critique.
 * Returns the tree search result with the best leaf and full revision path.
 */
export async function beamSearch(
  rootVariant: TextVariation,
  rootCritique: Critique,
  ctx: ExecutionContext,
  config: BeamSearchConfig = DEFAULT_BEAM_SEARCH_CONFIG,
): Promise<{ result: TreeSearchResult; treeState: TreeState; bestLeafText: string }> {
  const { llmClient, logger } = ctx;
  const { beamWidth, branchingFactor, maxDepth } = config;

  // Initialize tree with root
  const { node: rootNode, state: treeState } = createRootNode(rootVariant.id);

  // Active beam: candidates at current depth
  let beam: Array<{ node: TreeNode; text: string; critique: Critique }> = [
    { node: rootNode, text: rootVariant.text, critique: rootCritique },
  ];

  let actualMaxDepth = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    logger.debug('Beam search depth', { depth, beamSize: beam.length });

    // Re-critique at depth >= 2 to prevent stale critiques on already-modified text
    // (depth 1 starts from root with fresh critique; depth 2+ has revised text needing re-evaluation)
    if (depth >= 2) {
      beam = await reCritiqueBeam(beam, ctx);
    }

    // Generate B revisions per candidate
    let allCandidates: EvalCandidate[];
    try {
      allCandidates = await generateCandidates(beam, branchingFactor, treeState, ctx);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        logger.warn('Budget exhausted during generation at depth', { depth });
        break;
      }
      throw err;
    }

    if (allCandidates.length === 0) {
      logger.info('No valid candidates generated, stopping beam search', { depth });
      break;
    }

    // Stage 1: Parent-relative filter
    const callDiff = (before: string, after: string) => {
      const call = (prompt: string) => llmClient.complete(prompt, 'treeSearch', { model: ctx.payload.config.judgeModel });
      return compareWithDiff(before, after, call);
    };
    const callPairwise = (textA: string, textB: string) => {
      const call = (prompt: string) => llmClient.complete(prompt, 'treeSearch', { model: ctx.payload.config.judgeModel });
      return compareWithBiasMitigation(textA, textB, call);
    };

    let filterResult;
    try {
      filterResult = await filterByParentComparison(allCandidates, callDiff, callPairwise);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        logger.warn('Budget exhausted during evaluation at depth', { depth });
        break;
      }
      throw err;
    }

    // Mark rejected candidates as pruned in tree
    for (const rejected of filterResult.rejected) {
      rejected.node.pruned = true;
    }

    if (filterResult.survivors.length === 0) {
      logger.info('All candidates rejected at depth, stopping beam search', { depth });
      break;
    }

    // Stage 2: Sibling mini-tournament for ranking
    let rankedSurvivors: EvalCandidate[];
    try {
      const matchResults = await runMiniTournament(filterResult.survivors, ctx);
      rankedSurvivors = rankSurvivors(filterResult.survivors, treeState, beamWidth, matchResults);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        logger.warn('Budget exhausted during mini-tournament at depth', { depth });
        // Save partial survivors before propagating
        rankedSurvivors = filterResult.survivors.slice(0, beamWidth);
        throw err; // Let TreeSearchAgent handle graceful degradation
      }
      throw err;
    }

    // Mark non-selected survivors as pruned
    const selectedIds = new Set(rankedSurvivors.map((s) => s.node.id));
    for (const s of filterResult.survivors) {
      if (!selectedIds.has(s.node.id)) {
        pruneSubtree(treeState, s.node.id);
      }
    }

    // Update beam for next depth — map parent critiques from current beam
    const critiqueByNodeId = new Map(beam.map((b) => [b.node.id, b.critique]));
    beam = rankedSurvivors.map((s) => ({
      node: s.node,
      text: s.text,
      // Use parent's critique (from previous beam) as starting point for next re-critique
      critique: critiqueByNodeId.get(s.node.parentNodeId ?? '') ?? rootCritique,
    }));

    actualMaxDepth = depth;
    logger.debug('Beam search depth complete', {
      depth,
      survivors: rankedSurvivors.length,
      rejected: filterResult.rejected.length,
    });
  }

  // Build result
  const bestLeaf = getBestLeaf(treeState);
  const treeSize = Object.keys(treeState.nodes).length;
  const prunedBranches = Object.values(treeState.nodes).filter((n) => n.pruned).length;

  // Update node values from final ranking
  for (const b of beam) {
    b.node.value = beam.indexOf(b) === 0 ? 1 : 0;
  }

  const result: TreeSearchResult = {
    bestLeafNodeId: bestLeaf?.id ?? rootNode.id,
    bestVariantId: bestLeaf?.variantId ?? rootVariant.id,
    revisionPath: bestLeaf ? getPath(treeState, bestLeaf.id) : [],
    treeSize,
    maxDepth: actualMaxDepth,
    prunedBranches,
  };

  // Find best leaf's text from the final beam
  const bestLeafText = beam.find((b) => b.node.id === result.bestLeafNodeId)?.text ?? rootVariant.text;

  return { result, treeState, bestLeafText };
}

// ─── Internal helpers ────────────────────────────────────────────

/** Generate B candidate revisions per beam member. Propagates BudgetExceededError. */
async function generateCandidates(
  beam: Array<{ node: TreeNode; text: string; critique: Critique }>,
  branchingFactor: number,
  treeState: TreeState,
  ctx: ExecutionContext,
): Promise<EvalCandidate[]> {
  const { llmClient, logger } = ctx;
  const candidates: EvalCandidate[] = [];
  let budgetError: BudgetExceededError | null = null;

  const generationPromises: Array<Promise<void>> = [];

  for (const member of beam) {
    const actions = selectRevisionActions(member.critique, branchingFactor);

    for (const action of actions) {
      generationPromises.push(
        (async () => {
          try {
            const prompt = buildRevisionPrompt(member.text, action);
            const revisedText = await llmClient.complete(prompt, 'treeSearch');

            // Format validation
            const formatResult = validateFormat(revisedText);
            if (!formatResult.valid) {
              logger.debug('Revision failed format validation', { action: action.type, issues: formatResult.issues });
              return;
            }

            // Create child node in tree
            const variantId = uuidv4();
            const childNode = createChildNode(member.node.id, variantId, action, treeState);

            candidates.push({
              node: childNode,
              text: revisedText,
              parentText: member.text,
            });
          } catch (err) {
            if (err instanceof BudgetExceededError) {
              budgetError = err;
              return; // Don't rethrow — captured for post-settlement propagation
            }
            logger.debug('Revision generation failed', { action: action.type, error: String(err) });
          }
        })(),
      );
    }
  }

  await Promise.allSettled(generationPromises);

  // Propagate budget error after all promises settle (allSettled swallows thrown errors)
  if (budgetError) throw budgetError;

  return candidates;
}

/** Re-critique beam members to get fresh dimension scores. Propagates BudgetExceededError. */
async function reCritiqueBeam(
  beam: Array<{ node: TreeNode; text: string; critique: Critique }>,
  ctx: ExecutionContext,
): Promise<Array<{ node: TreeNode; text: string; critique: Critique }>> {
  const { llmClient, logger } = ctx;
  let budgetError: BudgetExceededError | null = null;

  const results = await Promise.allSettled(
    beam.map(async (member) => {
      try {
        const critique = await runInlineCritique(member.text, member.node.variantId, llmClient, 'treeSearch');
        if (critique) {
          return { ...member, critique };
        }
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          budgetError = err;
          return member; // Capture error, don't rethrow into allSettled
        }
        logger.debug('Re-critique failed, using previous critique', { nodeId: member.node.id });
      }
      return member;
    }),
  );

  // Propagate budget error after all promises settle
  if (budgetError) throw budgetError;

  return results
    .filter((r): r is PromiseFulfilledResult<typeof beam[0]> => r.status === 'fulfilled')
    .map((r) => r.value);
}

/** Run a mini-tournament between survivors. Returns match results for ranking. */
async function runMiniTournament(
  survivors: EvalCandidate[],
  ctx: ExecutionContext,
): Promise<Map<string, Map<string, 'A' | 'B' | 'TIE'>>> {
  const { llmClient } = ctx;
  const matchResults = new Map<string, Map<string, 'A' | 'B' | 'TIE'>>();

  if (survivors.length <= 1) return matchResults;

  // Run pairwise comparisons for adjacent-ranked pairs (1 round)
  const pairs: Array<[EvalCandidate, EvalCandidate]> = [];
  for (let i = 0; i < survivors.length - 1; i++) {
    pairs.push([survivors[i], survivors[i + 1]]);
  }

  const results = await Promise.allSettled(
    pairs.map(async ([a, b]) => {
      const call = (prompt: string) =>
        llmClient.complete(prompt, 'treeSearch', { model: ctx.payload.config.judgeModel });
      const result = await compareWithBiasMitigation(a.text, b.text, call);
      return { aId: a.node.variantId, bId: b.node.variantId, winner: result.winner };
    }),
  );

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { aId, bId, winner } = r.value;

    if (!matchResults.has(aId)) matchResults.set(aId, new Map());
    if (!matchResults.has(bId)) matchResults.set(bId, new Map());
    matchResults.get(aId)!.set(bId, winner);
    // Store reverse mapping
    const reverseWinner = winner === 'A' ? 'B' : winner === 'B' ? 'A' : 'TIE';
    matchResults.get(bId)!.set(aId, reverseWinner);
  }

  return matchResults;
}

/**
 * Inline critique for re-evaluation at depth >= 2.
 * Duplicates the prompt structure from IterativeEditingAgent.runInlineCritique.
 */
async function runInlineCritique(
  text: string,
  variantId: string,
  llmClient: ExecutionContext['llmClient'],
  agentName: string,
): Promise<Critique | null> {
  const { CRITIQUE_DIMENSIONS } = await import('../agents/reflectionAgent');
  const dimensionsList = CRITIQUE_DIMENSIONS.map((d: string) => `- ${d}`).join('\n');
  const prompt = `You are an expert writing critic. Analyze this text across multiple quality dimensions.

## Text to Analyze
"""${text}"""

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
    "scores": {
        "clarity": 7,
        "structure": 8
    },
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

  const response = await llmClient.complete(prompt, agentName);
  const data = extractJSON<{
    scores?: Record<string, number>;
    good_examples?: Record<string, string | string[]>;
    bad_examples?: Record<string, string | string[]>;
    notes?: Record<string, string>;
  }>(response);
  if (!data || !data.scores || typeof data.scores !== 'object') return null;

  const toArrayRecord = (
    obj: Record<string, string | string[]> | undefined,
  ): Record<string, string[]> => {
    if (!obj) return {};
    const result: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = Array.isArray(v) ? v : [v];
    }
    return result;
  };

  return {
    variationId: variantId,
    dimensionScores: data.scores,
    goodExamples: toArrayRecord(data.good_examples),
    badExamples: toArrayRecord(data.bad_examples),
    notes: data.notes ?? {},
    reviewer: 'llm',
  };
}
