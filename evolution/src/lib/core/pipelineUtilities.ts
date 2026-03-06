// Utility functions for execution detail truncation and diff metrics computation.
// Handles JSONB size limits via 2-phase truncation and before/after state snapshots.

import type { AgentExecutionDetail, PipelineState, DiffMetrics } from '../types';
import { getOrdinal, ordinalToEloScale, createRating } from './rating';

export const MAX_DETAIL_BYTES = 100_000;

/** Slice known large arrays per detail type to fit within JSONB byte cap. */
export function sliceLargeArrays(detail: AgentExecutionDetail): AgentExecutionDetail {
  switch (detail.detailType) {
    case 'tournament':
      return { ...detail, rounds: detail.rounds.slice(0, 30) };
    case 'calibration':
      return {
        ...detail,
        entrants: detail.entrants.slice(0, 50).map(e => ({
          ...e, matches: e.matches.slice(0, 20),
        })),
      };
    case 'iterativeEditing':
      return { ...detail, cycles: detail.cycles.slice(0, 10) };
    default:
      return detail;
  }
}

/** Cap execution detail JSONB to 100KB via 2-phase truncation. */
export function truncateDetail(detail: AgentExecutionDetail): AgentExecutionDetail {
  const encoded = new TextEncoder().encode(JSON.stringify(detail));
  if (encoded.length <= MAX_DETAIL_BYTES) return detail;

  // Phase 1: Slice known large arrays
  const sliced = sliceLargeArrays(detail);
  const recheck = new TextEncoder().encode(JSON.stringify(sliced));
  if (recheck.length <= MAX_DETAIL_BYTES) {
    return { ...sliced, _truncated: true } as AgentExecutionDetail;
  }

  // Phase 2: Strip to base fields only
  return {
    detailType: detail.detailType,
    totalCost: detail.totalCost,
    _truncated: true,
  } as AgentExecutionDetail;
}

/** Lightweight snapshot of PipelineState captured before agent.execute(). */
export interface BeforeStateSnapshot {
  poolIds: string[];
  matchHistoryLength: number;
  critiquesLength: number;
  debatesLength: number;
  diversityScore: number | null;
  metaFeedbackPresent: boolean;
  /** Elo-scale ratings keyed by variant ID (converted from OpenSkill mu/sigma). */
  eloRatings: Record<string, number>;
}

export function captureBeforeState(state: PipelineState): BeforeStateSnapshot {
  const eloRatings: Record<string, number> = {};
  for (const [id, rating] of state.ratings) {
    eloRatings[id] = ordinalToEloScale(getOrdinal(rating));
  }

  return {
    poolIds: state.pool.map(v => v.id),
    matchHistoryLength: state.matchHistory.length,
    critiquesLength: state.allCritiques?.length ?? 0,
    debatesLength: state.debateTranscripts.length,
    diversityScore: state.diversityScore,
    metaFeedbackPresent: state.metaFeedback !== null,
    eloRatings,
  };
}

export function computeDiffMetrics(before: BeforeStateSnapshot, after: PipelineState): DiffMetrics {
  const beforePoolIds = new Set(before.poolIds);
  const newVariantIds = after.pool
    .filter(v => !beforePoolIds.has(v.id))
    .map(v => v.id);

  const afterEloRatings: Record<string, number> = {};
  for (const [id, rating] of after.ratings) {
    afterEloRatings[id] = ordinalToEloScale(getOrdinal(rating));
  }

  const defaultElo = ordinalToEloScale(getOrdinal(createRating()));
  const eloChanges: Record<string, number> = {};
  for (const [id, afterElo] of Object.entries(afterEloRatings)) {
    const delta = afterElo - (before.eloRatings[id] ?? defaultElo);
    if (delta !== 0) {
      eloChanges[id] = Math.round(delta * 100) / 100;
    }
  }

  return {
    variantsAdded: newVariantIds.length,
    newVariantIds,
    matchesPlayed: Math.max(0, after.matchHistory.length - before.matchHistoryLength),
    eloChanges,
    critiquesAdded: Math.max(0, (after.allCritiques?.length ?? 0) - before.critiquesLength),
    debatesAdded: Math.max(0, after.debateTranscripts.length - before.debatesLength),
    diversityScoreAfter: after.diversityScore ?? null,
    metaFeedbackPopulated: !before.metaFeedbackPresent && after.metaFeedback !== null,
  };
}

