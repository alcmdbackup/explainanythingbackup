// Proximity agent computing diversity/similarity in the variant pool.
// Supports test mode (deterministic hash embeddings) and production mode (character-based pseudo-embeddings).
// HIGH-4: Production pseudo-embeddings are a known limitation — see _embed() warning.

import { createHash } from 'crypto';
import { AgentBase } from './base';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, ProximityExecutionDetail } from '../types';

/** HIGH-5: Maximum cached embeddings before LRU eviction. */
const MAX_CACHE_SIZE = 200;

export class ProximityAgent extends AgentBase {
  readonly name = 'proximity';
  private readonly testMode: boolean;
  private readonly embeddingCache = new Map<string, number[]>();
  private _pseudoEmbeddingWarned = false;

  constructor(options?: { testMode?: boolean }) {
    super();
    this.testMode = options?.testMode ?? false;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    const { state, logger } = ctx;
    const newIds = new Set(state.newEntrantsThisIteration);
    const existingIds = state.pool.filter((v) => !newIds.has(v.id)).map((v) => v.id);

    // Initialize sparse similarity matrix if needed
    if (state.similarityMatrix === null) {
      state.similarityMatrix = {};
    }

    if (newIds.size === 0) {
      const detail: ProximityExecutionDetail = {
        detailType: 'proximity', newEntrants: 0, existingVariants: existingIds.length,
        diversityScore: state.diversityScore ?? 1.0, totalPairsComputed: 0, totalCost: 0,
      };
      return { agentType: 'proximity', success: true, costUsd: ctx.costTracker.getAgentCost(this.name), executionDetail: detail };
    }

    // Compute embeddings for all pool members not yet cached
    for (const v of state.pool) {
      if (!this.embeddingCache.has(v.id)) {
        // HIGH-5: Evict oldest entries when cache exceeds max size
        if (this.embeddingCache.size >= MAX_CACHE_SIZE) {
          const oldest = this.embeddingCache.keys().next().value;
          if (oldest !== undefined) this.embeddingCache.delete(oldest);
        }
        this.embeddingCache.set(v.id, this._embed(v.text));
      }
    }

    // Compute similarity for new vs existing (sparse)
    let pairsComputed = 0;
    for (const newId of newIds) {
      if (!state.similarityMatrix[newId]) {
        state.similarityMatrix[newId] = {};
      }

      const newEmbed = this.embeddingCache.get(newId);
      if (!newEmbed) continue;

      for (const existId of existingIds) {
        const existEmbed = this.embeddingCache.get(existId);
        if (!existEmbed) continue;

        const sim = cosineSimilarity(newEmbed, existEmbed);
        pairsComputed++;
        state.similarityMatrix[newId][existId] = sim;
        // Ensure symmetry
        if (!state.similarityMatrix[existId]) {
          state.similarityMatrix[existId] = {};
        }
        state.similarityMatrix[existId][newId] = sim;
      }
    }

    // Update diversity score
    state.diversityScore = this._computePoolDiversity(state);

    logger.info('Proximity complete', {
      newEntrants: newIds.size,
      diversityScore: state.diversityScore.toFixed(3),
    });

    const detail: ProximityExecutionDetail = {
      detailType: 'proximity',
      newEntrants: newIds.size,
      existingVariants: existingIds.length,
      diversityScore: state.diversityScore ?? 1.0,
      totalPairsComputed: pairsComputed,
      totalCost: ctx.costTracker.getAgentCost(this.name),
    };
    return { agentType: 'proximity', success: true, costUsd: ctx.costTracker.getAgentCost(this.name), executionDetail: detail };
  }

  estimateCost(payload: AgentPayload): number {
    if (this.testMode) return 0;
    // ~$0.0001 per embedding (OpenAI text-embedding-3-small)
    const numNew = payload.config.generation.strategies;
    return numNew * 0.0001;
  }

  canExecute(state: PipelineState): boolean {
    return state.pool.length >= 2;
  }

  /** Compute diversity as 1 - mean(top-k pairwise similarities). */
  _computePoolDiversity(state: PipelineState): number {
    const topN = state.getTopByRating(10);
    if (topN.length < 2) return 1.0;

    const sims: number[] = [];
    for (let i = 0; i < topN.length; i++) {
      for (let j = i + 1; j < topN.length; j++) {
        const v1 = topN[i];
        const v2 = topN[j];
        let sim: number | undefined;

        if (state.similarityMatrix?.[v1.id]) {
          sim = state.similarityMatrix[v1.id][v2.id];
        }
        if (sim === undefined && state.similarityMatrix?.[v2.id]) {
          sim = state.similarityMatrix[v2.id][v1.id];
        }
        if (sim !== undefined) {
          sims.push(sim);
        }
      }
    }

    return sims.length > 0 ? 1 - sims.reduce((a, b) => a + b, 0) / sims.length : 1.0;
  }

  /** Generate embedding vector. Test mode uses deterministic MD5-based pseudo-embedding. */
  _embed(text: string): number[] {
    if (this.testMode) {
      const hash = createHash('md5').update(text).digest('hex');
      const vec: number[] = [];
      for (let i = 0; i < 32; i += 2) {
        vec.push(parseInt(hash.slice(i, i + 2), 16) / 255);
      }
      return vec;
    }

    // HIGH-4: Production fallback — character-based pseudo-embedding (WARNING: unreliable).
    if (!this._pseudoEmbeddingWarned) {
      console.warn('[ProximityAgent] Using character-based pseudo-embeddings — similarity scores are unreliable. Real embeddings API deferred to post-MVP.');
      this._pseudoEmbeddingWarned = true;
    }
    const chars = text.toLowerCase().slice(0, 16).padEnd(16, ' ');
    return Array.from(chars).map((c) => c.charCodeAt(0) / 255);
  }

  /** Clear embedding cache (useful for testing). */
  clearCache(): void {
    this.embeddingCache.clear();
  }
}

/** Cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}
