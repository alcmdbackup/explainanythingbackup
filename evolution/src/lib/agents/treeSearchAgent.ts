// Tree-of-thought beam search agent for the evolution pipeline COMPETITION phase.
// Explores multiple revision strategies in parallel via beam search, selecting the best path.

import { AgentBase } from './base';
import type { AgentResult, ExecutionContext, ReadonlyPipelineState, AgentPayload, TextVariation, TreeSearchExecutionDetail } from '../types';
import type { PipelineAction } from '../core/actions';
import { BudgetExceededError } from '../types';
import { getCritiqueForVariant } from './reflectionAgent';
import { RATING_CONSTANTS } from '../config';
import { beamSearch } from '../treeOfThought/beamSearch';
import type { BeamSearchConfig, TreeSearchResult, TreeState } from '../treeOfThought/types';
import { DEFAULT_BEAM_SEARCH_CONFIG } from '../treeOfThought/types';
import { calculateLLMCost } from '@/config/llmPricing';

export class TreeSearchAgent extends AgentBase {
  readonly name = 'treeSearch';
  private readonly config: BeamSearchConfig;

  constructor(config?: Partial<BeamSearchConfig>) {
    super();
    this.config = { ...DEFAULT_BEAM_SEARCH_CONFIG, ...config };
  }

  canExecute(state: ReadonlyPipelineState): boolean {
    if (state.allCritiques.length === 0) return false;
    if (state.ratings.size === 0) return false;
    const top = state.getTopByRating(1)[0];
    if (!top) return false;
    return getCritiqueForVariant(top.id, state) !== null;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger, costTracker } = ctx;
    let variantsAdded = 0;

    // 1. Select root: highest mu with sigma > convergence threshold (underexplored high-potential)
    const root = this.selectRoot(state);
    if (!root) {
      logger.info('No suitable root variant for tree search');
      return { agentType: this.name, success: false, costUsd: 0, skipped: true, reason: 'no_suitable_root', actions: [] };
    }

    // 2. Get critique for root
    const critique = getCritiqueForVariant(root.id, state);
    if (!critique) {
      logger.info('No critique available for root variant', { rootId: root.id });
      return { agentType: this.name, success: false, costUsd: 0, skipped: true, reason: 'no_critique', actions: [] };
    }

    // 3. Reserve budget
    const estimatedCost = this.estimateCost(ctx.payload);
    await costTracker.reserveBudget(this.name, estimatedCost);

    // 4. Run beam search
    let searchResult: TreeSearchResult;
    let treeState: TreeState;
    let bestLeafText: string;
    try {
      const output = await beamSearch(root, critique, ctx, this.config);
      searchResult = output.result;
      treeState = output.treeState;
      bestLeafText = output.bestLeafText;
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      logger.error('Beam search failed', { error: String(err) });
      return { agentType: this.name, success: false, costUsd: costTracker.getAgentCost(this.name), actions: [] };
    }

    // 5. Add best leaf to pool (rate-limited: only best leaf added, root already in pool)
    let addedToPool = false;
    const addedVariants: TextVariation[] = [];
    if (searchResult.bestVariantId !== root.id && bestLeafText !== root.text) {
      const bestNode = treeState.nodes[searchResult.bestLeafNodeId];
      if (bestNode) {
        const bestVariant = {
          id: searchResult.bestVariantId,
          text: bestLeafText,
          version: root.version + searchResult.maxDepth,
          parentIds: [root.id],
          strategy: `tree_search_${bestNode.revisionAction.type}`,
          createdAt: Date.now() / 1000,
          iterationBorn: state.iteration,
        };

        if (!state.poolIds.has(bestVariant.id)) {
          addedVariants.push(bestVariant);
          variantsAdded++;
          addedToPool = true;
        }
      }
    }

    logger.info('Tree search completed', {
      treeSize: searchResult.treeSize,
      maxDepth: searchResult.maxDepth,
      prunedBranches: searchResult.prunedBranches,
      revisionPath: searchResult.revisionPath.map((a) => a.type),
      variantsAdded,
    });

    const detail: TreeSearchExecutionDetail = {
      detailType: 'treeSearch',
      rootVariantId: root.id,
      config: { beamWidth: this.config.beamWidth, branchingFactor: this.config.branchingFactor, maxDepth: this.config.maxDepth },
      result: {
        treeSize: searchResult.treeSize,
        maxDepth: searchResult.maxDepth,
        prunedBranches: searchResult.prunedBranches,
        revisionPath: searchResult.revisionPath.map(a => ({
          type: a.type,
          dimension: a.dimension,
          description: a.description,
        })),
      },
      bestLeafVariantId: searchResult.bestVariantId !== root.id ? searchResult.bestVariantId : undefined,
      addedToPool,
      totalCost: costTracker.getAgentCost(this.name),
    };

    const actions: PipelineAction[] = addedVariants.length > 0
      ? [{ type: 'ADD_TO_POOL' as const, variants: addedVariants }]
      : [];

    return {
      agentType: this.name,
      success: searchResult.maxDepth > 0,
      costUsd: costTracker.getAgentCost(this.name),
      variantsAdded,
      executionDetail: detail,
      actions,
    };
  }

  estimateCost(payload: AgentPayload): number {
    const { beamWidth: K, branchingFactor: B, maxDepth: D } = this.config;
    const textLen = payload.originalText.length;
    const avgTokens = (textLen + 500) / 4;
    const genModel = payload.config.generationModel ?? 'gpt-4.1-mini';
    const judgeModel = payload.config.judgeModel ?? 'gpt-4.1-nano';

    // Generation: K*B*D calls at generationModel pricing
    const genCostPerCall = calculateLLMCost(genModel, avgTokens, avgTokens);
    const genTotal = K * B * D * genCostPerCall;

    // Re-critique: K*(D-1) calls at generationModel pricing
    const reCritiqueTotal = K * Math.max(0, D - 1) * genCostPerCall;

    // Evaluation: ~30*D calls at judgeModel pricing
    const evalTokens = (textLen * 0.3 + 300) / 4;
    const evalCostPerCall = calculateLLMCost(judgeModel, evalTokens, evalTokens);
    const evalTotal = 30 * D * evalCostPerCall;

    // 1.3x safety margin
    return (genTotal + reCritiqueTotal + evalTotal) * 1.3;
  }

  /** Select root variant: highest mu with sigma > convergence threshold. */
  private selectRoot(state: ReadonlyPipelineState) {
    const top = state.getTopByRating(10);
    // Prefer underexplored high-potential variants
    const underexplored = top.filter((v) => {
      const rating = state.ratings.get(v.id);
      return rating && rating.sigma >= RATING_CONSTANTS.CONVERGENCE_SIGMA_THRESHOLD;
    });

    // Sort by mu descending (high potential, not conservative estimate)
    const byMu = (underexplored.length > 0 ? underexplored : top).sort((a, b) => {
      const rA = state.ratings.get(a.id);
      const rB = state.ratings.get(b.id);
      return (rB?.mu ?? 0) - (rA?.mu ?? 0);
    });

    // Verify the selected root has a critique
    for (const v of byMu) {
      if (getCritiqueForVariant(v.id, state)) return v;
    }
    return null;
  }

  // storeResults removed — tree search results are agent-local data (Phase 3 will add class fields)
}
