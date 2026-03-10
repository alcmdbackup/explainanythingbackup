// Tree-of-thought beam search agent for the evolution pipeline COMPETITION phase.
// Explores multiple revision strategies in parallel via beam search, selecting the best path.

import { AgentBase } from './base';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, TreeSearchExecutionDetail } from '../types';
import { BudgetExceededError } from '../types';
import { getCritiqueForVariant } from './reflectionAgent';
import { RATING_CONSTANTS } from '../config';
import { beamSearch } from '../treeOfThought/beamSearch';
import type { BeamSearchConfig, TreeSearchResult, TreeState } from '../treeOfThought/types';
import { DEFAULT_BEAM_SEARCH_CONFIG } from '../treeOfThought/types';

export class TreeSearchAgent extends AgentBase {
  readonly name = 'treeSearch';
  private readonly config: BeamSearchConfig;

  constructor(config?: Partial<BeamSearchConfig>) {
    super();
    this.config = { ...DEFAULT_BEAM_SEARCH_CONFIG, ...config };
  }

  canExecute(state: PipelineState): boolean {
    if (!state.allCritiques || state.allCritiques.length === 0) return false;
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
      return { agentType: this.name, success: false, costUsd: 0, skipped: true, reason: 'no_suitable_root' };
    }

    // 2. Get critique for root
    const critique = getCritiqueForVariant(root.id, state);
    if (!critique) {
      logger.info('No critique available for root variant', { rootId: root.id });
      return { agentType: this.name, success: false, costUsd: 0, skipped: true, reason: 'no_critique' };
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
      return { agentType: this.name, success: false, costUsd: costTracker.getAgentCost(this.name) };
    }

    // 5. Add best leaf to pool (rate-limited: only best leaf added, root already in pool)
    let addedToPool = false;
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
          state.addToPool(bestVariant);
          variantsAdded++;
          addedToPool = true;
        }
      }
    }

    // 6. Store tree search results in state for visualization
    this.storeResults(state, searchResult, treeState);

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

    return {
      agentType: this.name,
      success: searchResult.maxDepth > 0,
      costUsd: costTracker.getAgentCost(this.name),
      variantsAdded,
      executionDetail: detail,
    };
  }

  estimateCost(payload: AgentPayload): number {
    const { beamWidth: K, branchingFactor: B, maxDepth: D } = this.config;
    const textLen = payload.originalText.length;
    const avgTokens = (textLen + 500) / 4;

    // Generation: K*B*D calls at generationModel (gpt-4.1-mini) pricing ($0.40/$1.60 per 1M tokens)
    const genCostPerCall = (avgTokens / 1_000_000) * 0.40 + (avgTokens / 1_000_000) * 1.60;
    const genTotal = K * B * D * genCostPerCall;

    // Re-critique: K*(D-1) calls at generationModel pricing
    const reCritiqueTotal = K * Math.max(0, D - 1) * genCostPerCall;

    // Evaluation: ~30*D calls at judgeModel (gpt-4.1-nano) pricing ($0.10/$0.40 per 1M tokens)
    const evalTokens = (textLen * 0.3 + 300) / 4;
    const evalCostPerCall = (evalTokens / 1_000_000) * 0.10 + (evalTokens / 1_000_000) * 0.40;
    const evalTotal = 30 * D * evalCostPerCall;

    // 1.3x safety margin
    return (genTotal + reCritiqueTotal + evalTotal) * 1.3;
  }

  /** Select root variant: highest mu with sigma > convergence threshold. */
  private selectRoot(state: PipelineState) {
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

  /** Store tree search results on pipeline state (for visualization and checkpointing). */
  private storeResults(state: PipelineState, result: TreeSearchResult, treeState: TreeState): void {
    const existingResults = state.treeSearchResults ?? [];
    state.treeSearchResults = [...existingResults, result];
    const existingStates = state.treeSearchStates ?? [];
    state.treeSearchStates = [...existingStates, treeState];
  }
}
