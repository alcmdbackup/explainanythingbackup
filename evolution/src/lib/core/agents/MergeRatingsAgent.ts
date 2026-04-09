// MergeRatingsAgent: applies match buffers from work agents to global ratings in
// randomized (Fisher-Yates) order. Reusable for both generate and swiss iterations.
// Also writes one row per match to evolution_arena_comparisons (Critical Fix J — sole writer
// of in-run match rows; sync_to_arena later backfills prompt_id).
//
// See planning doc: docs/planning/generate_rank_evolution_parallel_20260331/_planning.md

import { Agent } from '../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from '../types';
import type { ExecutionDetailBase, Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { createRating, updateRating, updateDraw } from '../../shared/computeRatings';
import type { V2Match } from '../../pipeline/infra/types';
import { computeTop15Cutoff } from '../../pipeline/loop/rankSingleVariant';
import { mergeRatingsExecutionDetailSchema } from '../../schemas';
import { SeededRandom, deriveSeed } from '../../shared/seededRandom';
import type { z } from 'zod';

// ─── Public types ─────────────────────────────────────────────────

export interface MergeMatchEntry {
  match: V2Match;
  idA: string;
  idB: string;
}

export interface MergeRatingsInput {
  iterationType: 'generate' | 'swiss';
  /** One inner array per source agent (1 for swiss, N for generate). */
  matchBuffers: ReadonlyArray<ReadonlyArray<MergeMatchEntry>>;
  /** Variants to add to the pool (generate iterations only — empty for swiss). */
  newVariants: ReadonlyArray<Variant>;
  /** Global pool — MUTATED (variants pushed). */
  pool: Variant[];
  /** Global ratings — MUTATED with shuffled-order updates. */
  ratings: Map<string, Rating>;
  /** Global match counts — MUTATED. */
  matchCounts: Map<string, number>;
  /** Global match history — appended in shuffled order. */
  matchHistory: V2Match[];
}

export interface MergeRatingsOutput {
  matchesApplied: number;
  arenaRowsWritten: number;
}

export type MergeRatingsExecutionDetail = z.infer<typeof mergeRatingsExecutionDetailSchema>
  & ExecutionDetailBase;

// ─── Helpers ──────────────────────────────────────────────────────

interface VariantSnapshotEntry {
  id: string;
  mu: number;
  sigma: number;
  matchCount: number;
}

function captureVariants(
  pool: ReadonlyArray<Variant>,
  ratings: ReadonlyMap<string, Rating>,
  matchCounts: ReadonlyMap<string, number>,
): VariantSnapshotEntry[] {
  return pool.map((v) => {
    const r = ratings.get(v.id) ?? createRating();
    return {
      id: v.id,
      mu: r.mu,
      sigma: r.sigma,
      matchCount: matchCounts.get(v.id) ?? 0,
    };
  });
}

function diffVariants(
  before: VariantSnapshotEntry[],
  after: VariantSnapshotEntry[],
): Array<VariantSnapshotEntry & { muDelta: number; sigmaDelta: number }> {
  const beforeMap = new Map(before.map((v) => [v.id, v]));
  return after.map((a) => {
    const b = beforeMap.get(a.id);
    return {
      ...a,
      muDelta: b ? a.mu - b.mu : 0,
      sigmaDelta: b ? a.sigma - b.sigma : 0,
    };
  });
}

// ─── Agent class ──────────────────────────────────────────────────

export class MergeRatingsAgent extends Agent<
  MergeRatingsInput,
  MergeRatingsOutput,
  MergeRatingsExecutionDetail
> {
  readonly name = 'merge_ratings';
  readonly executionDetailSchema = mergeRatingsExecutionDetailSchema;

  readonly detailViewConfig: DetailFieldDef[] = [
    { key: 'iterationType', label: 'Iteration Type', type: 'badge' },
    {
      key: 'before', label: 'Pool Before Merge', type: 'object',
      children: [
        { key: 'poolSize', label: 'Pool Size', type: 'number' },
        { key: 'top15Cutoff', label: 'Top-15% Cutoff', type: 'number' },
      ],
    },
    {
      key: 'before.variants', label: 'Variants Before', type: 'table',
      columns: [
        { key: 'id', label: 'ID' },
        { key: 'mu', label: 'μ' },
        { key: 'sigma', label: 'σ' },
        { key: 'matchCount', label: 'Matches' },
      ],
    },
    {
      key: 'input', label: 'Merge Input', type: 'object',
      children: [
        { key: 'matchBufferCount', label: 'Buffer Count', type: 'number' },
        { key: 'totalMatchesIn', label: 'Total Matches', type: 'number' },
        { key: 'newVariantsAdded', label: 'New Variants', type: 'number' },
      ],
    },
    {
      key: 'matchesApplied', label: 'Matches Applied (shuffled)', type: 'table',
      columns: [
        { key: 'indexInShuffledOrder', label: '#' },
        { key: 'winnerId', label: 'Winner' },
        { key: 'loserId', label: 'Loser' },
        { key: 'result', label: 'Result' },
        { key: 'confidence', label: 'Confidence' },
      ],
    },
    {
      key: 'after', label: 'Pool After Merge', type: 'object',
      children: [
        { key: 'poolSize', label: 'Pool Size', type: 'number' },
        { key: 'top15Cutoff', label: 'Top-15% Cutoff', type: 'number' },
        { key: 'top15CutoffDelta', label: 'Cutoff Δ', type: 'number' },
      ],
    },
    {
      key: 'after.variants', label: 'Variants After', type: 'table',
      columns: [
        { key: 'id', label: 'ID' },
        { key: 'mu', label: 'μ' },
        { key: 'muDelta', label: 'Δμ' },
        { key: 'sigma', label: 'σ' },
        { key: 'sigmaDelta', label: 'Δσ' },
        { key: 'matchCount', label: 'Matches' },
      ],
    },
    { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
    { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
  ];

  async execute(
    input: MergeRatingsInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<MergeRatingsOutput, MergeRatingsExecutionDetail>> {
    const startMs = Date.now();
    const {
      iterationType, matchBuffers, newVariants, pool, ratings, matchCounts, matchHistory,
    } = input;

    // (A) Snapshot the BEFORE state
    const beforeVariants = captureVariants(pool, ratings, matchCounts);
    const beforeTop15Cutoff = computeTop15Cutoff(ratings);

    // Add new variants from generate iterations and seed them with default ratings.
    for (const v of newVariants) {
      pool.push(v);
      if (!ratings.has(v.id)) ratings.set(v.id, createRating());
    }

    // (B) Concatenate all match buffers.
    const allMatches: MergeMatchEntry[] = [];
    for (const buf of matchBuffers) {
      for (const m of buf) allMatches.push(m);
    }

    // Fisher-Yates shuffle via seeded RNG (deriveSeed makes this deterministic per merge).
    const subSeed = deriveSeed(
      ctx.randomSeed,
      'merge_ratings',
      `iter${ctx.iteration}`,
      `exec${ctx.executionOrder}`,
    );
    const rng = new SeededRandom(subSeed);
    rng.shuffle(allMatches);

    // Sequentially apply OpenSkill updates in shuffled order, capturing per-match state
    // for the arena_comparisons row writes.
    interface AppliedSnapshot {
      indexInShuffledOrder: number;
      winnerId: string;
      loserId: string;
      result: 'win' | 'draw';
      confidence: number;
    }
    const matchesAppliedSnapshot: AppliedSnapshot[] = [];
    interface ArenaRowPayload {
      run_id: string;
      entry_a: string;
      entry_b: string;
      winner: 'a' | 'b' | 'draw';
      confidence: number;
      iteration: number;
      invocation_id: string | null;
      entry_a_mu_before: number;
      entry_a_sigma_before: number;
      entry_b_mu_before: number;
      entry_b_sigma_before: number;
      entry_a_mu_after: number;
      entry_a_sigma_after: number;
      entry_b_mu_after: number;
      entry_b_sigma_after: number;
      status: string;
    }
    const arenaRows: ArenaRowPayload[] = [];

    for (let i = 0; i < allMatches.length; i++) {
      const entry = allMatches[i]!;
      const { match, idA, idB } = entry;
      matchHistory.push(match);

      // Capture state BEFORE applying
      const aBefore = ratings.get(idA) ?? createRating();
      const bBefore = ratings.get(idB) ?? createRating();
      if (!ratings.has(idA)) ratings.set(idA, aBefore);
      if (!ratings.has(idB)) ratings.set(idB, bBefore);

      // Apply OpenSkill update — skip on zero-confidence (LLM total failure).
      const isFailure = match.confidence === 0;
      const isDraw = match.confidence < 0.3 || match.result === 'draw';

      let aAfter = aBefore;
      let bAfter = bBefore;
      if (!isFailure) {
        if (isDraw) {
          const [newA, newB] = updateDraw(aBefore, bBefore);
          aAfter = newA;
          bAfter = newB;
          ratings.set(idA, aAfter);
          ratings.set(idB, bAfter);
        } else {
          const winnerRating = match.winnerId === idA ? aBefore : bBefore;
          const loserRating = match.winnerId === idA ? bBefore : aBefore;
          const [newW, newL] = updateRating(winnerRating, loserRating);
          ratings.set(match.winnerId, newW);
          ratings.set(match.loserId, newL);
          aAfter = ratings.get(idA)!;
          bAfter = ratings.get(idB)!;
        }
      }

      matchCounts.set(idA, (matchCounts.get(idA) ?? 0) + 1);
      matchCounts.set(idB, (matchCounts.get(idB) ?? 0) + 1);

      if (matchesAppliedSnapshot.length < 50) {
        matchesAppliedSnapshot.push({
          indexInShuffledOrder: i,
          winnerId: match.winnerId,
          loserId: match.loserId,
          result: match.result,
          confidence: match.confidence,
        });
      }

      // Build arena_comparisons row payload (Fix J — MergeRatingsAgent is the sole writer).
      // entry_a/entry_b are stored in (idA, idB) order regardless of winner.
      const winnerSlot: 'a' | 'b' | 'draw' = match.result === 'draw'
        ? 'draw'
        : (match.winnerId === idA ? 'a' : 'b');
      arenaRows.push({
        run_id: ctx.runId,
        entry_a: idA,
        entry_b: idB,
        winner: winnerSlot,
        confidence: match.confidence,
        iteration: ctx.iteration,
        invocation_id: ctx.invocationId === '' ? null : ctx.invocationId,
        entry_a_mu_before: aBefore.mu,
        entry_a_sigma_before: aBefore.sigma,
        entry_b_mu_before: bBefore.mu,
        entry_b_sigma_before: bBefore.sigma,
        entry_a_mu_after: aAfter.mu,
        entry_a_sigma_after: aAfter.sigma,
        entry_b_mu_after: bAfter.mu,
        entry_b_sigma_after: bAfter.sigma,
        status: 'completed',
      });
    }

    // Bulk insert arena_comparisons rows (Fix J). Best-effort: errors logged but non-fatal.
    let arenaRowsWritten = 0;
    if (arenaRows.length > 0) {
      try {
        const { error } = await ctx.db.from('evolution_arena_comparisons').insert(arenaRows);
        if (error) {
          ctx.logger.warn('MergeRatingsAgent: arena_comparisons insert failed', {
            phaseName: 'merge_ratings',
            error: error.message.slice(0, 500),
            count: arenaRows.length,
          });
        } else {
          arenaRowsWritten = arenaRows.length;
        }
      } catch (err) {
        ctx.logger.warn('MergeRatingsAgent: arena_comparisons insert exception', {
          phaseName: 'merge_ratings',
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        });
      }
    }

    // (C) Snapshot the AFTER state
    const afterVariantsRaw = captureVariants(pool, ratings, matchCounts);
    const afterTop15Cutoff = computeTop15Cutoff(ratings);
    const afterVariants = diffVariants(beforeVariants, afterVariantsRaw);

    const detail: MergeRatingsExecutionDetail = {
      detailType: 'merge_ratings',
      totalCost: 0, // No LLM calls — patched to 0 anyway by Agent.run() since cost diff is 0.
      iterationType,
      before: {
        poolSize: beforeVariants.length,
        variants: beforeVariants,
        top15Cutoff: beforeTop15Cutoff,
      },
      input: {
        matchBufferCount: matchBuffers.length,
        totalMatchesIn: allMatches.length,
        matchesPerBuffer: matchBuffers.map((b) => b.length),
        newVariantsAdded: newVariants.length,
      },
      matchesApplied: matchesAppliedSnapshot,
      matchesAppliedTotal: allMatches.length,
      matchesAppliedTruncated: allMatches.length > 50,
      after: {
        poolSize: afterVariants.length,
        variants: afterVariants,
        top15Cutoff: afterTop15Cutoff,
        top15CutoffDelta: afterTop15Cutoff - beforeTop15Cutoff,
      },
      variantsAddedToPool: newVariants.map((v) => v.id),
      durationMs: Date.now() - startMs,
    };

    return {
      result: { matchesApplied: allMatches.length, arenaRowsWritten },
      detail,
      childVariantIds: newVariants.map((v) => v.id),
    };
  }
}
