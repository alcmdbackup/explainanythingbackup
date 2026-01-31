// Proximity agent computing diversity/similarity in the variant pool.
// Supports test mode (deterministic hash embeddings) and production mode (LLM-based embeddings).

import { createHash } from 'crypto';
import { AgentBase } from './base';
import type { AgentResult, ExecutionContext, PipelineState, AgentPayload, TextVariation } from '../types';

export class ProximityAgent extends AgentBase {
  readonly name = 'proximity';
  private readonly testMode: boolean;
  private readonly embeddingCache = new Map<string, number[]>();

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
      return { agentType: 'proximity', success: true, costUsd: 0 };
    }

    const idToVar = new Map<string, TextVariation>(state.pool.map((v) => [v.id, v]));

    // Compute embeddings for new entrants
    for (const vid of newIds) {
      if (!this.embeddingCache.has(vid) && idToVar.has(vid)) {
        this.embeddingCache.set(vid, this._embed(idToVar.get(vid)!.text));
      }
    }

    // Compute embeddings for existing pool members
    for (const existId of existingIds) {
      if (!this.embeddingCache.has(existId) && idToVar.has(existId)) {
        this.embeddingCache.set(existId, this._embed(idToVar.get(existId)!.text));
      }
    }

    // Compute similarity for new vs existing (sparse)
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

    return { agentType: 'proximity', success: true, costUsd: 0 };
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
    const topN = state.getTopByElo(10);
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
      // Convert hex pairs to floats in [0, 1]
      const vec: number[] = [];
      for (let i = 0; i < 32; i += 2) {
        vec.push(parseInt(hash.slice(i, i + 2), 16) / 255);
      }
      return vec;
    }

    // Production fallback: character-based embedding.
    // Real OpenAI embedding integration deferred to post-MVP production path.
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
