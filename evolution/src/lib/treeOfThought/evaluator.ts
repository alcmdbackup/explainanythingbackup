// Hybrid two-stage evaluation for tree-of-thought beam search.
// Stage 1: Parent-relative filter via compareWithDiff or compareWithBiasMitigation.
// Stage 2: Sibling mini-tournament using Swiss pairing with local OpenSkill ratings.

import type { TreeNode, TreeState, RevisionActionType } from './types';
import type { Rating } from '../core/rating';
import type { DiffComparisonResult } from '../diffComparison';
import type { ComparisonResult } from '../comparison';
import { createRating, updateRating, updateDraw, getOrdinal } from '../core/rating';

/** Action types that use diff-based comparison (surgical, single-dimension edits). */
const DIFF_ELIGIBLE_TYPES: Set<RevisionActionType> = new Set([
  'edit_dimension',
  'lexical_simplify',
]);

/** Candidate with its tree node and text for evaluation. */
export interface EvalCandidate {
  node: TreeNode;
  text: string;
  parentText: string;
}

/** Result of Stage 1 parent-relative filtering. */
export interface FilterResult {
  survivors: EvalCandidate[];
  rejected: EvalCandidate[];
  allUnsure: boolean;
}

/**
 * Stage 1: Filter candidates by comparing each to its parent.
 * Uses compareWithDiff for surgical edits, compareWithBiasMitigation for broad revisions.
 * Rejects candidates that don't improve on their parent.
 */
export async function filterByParentComparison(
  candidates: EvalCandidate[],
  callDiff: (before: string, after: string) => Promise<DiffComparisonResult>,
  callPairwise: (textA: string, textB: string) => Promise<ComparisonResult>,
): Promise<FilterResult> {
  if (candidates.length === 0) {
    return { survivors: [], rejected: [], allUnsure: false };
  }

  const results = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const useDiff = DIFF_ELIGIBLE_TYPES.has(candidate.node.revisionAction.type);

      if (useDiff) {
        const diffResult = await callDiff(candidate.parentText, candidate.text);
        return { candidate, accepted: diffResult.verdict === 'ACCEPT', unsure: diffResult.verdict === 'UNSURE' };
      } else {
        const pairResult = await callPairwise(candidate.parentText, candidate.text);
        // B = after text = candidate. Winner 'B' means candidate is better.
        return { candidate, accepted: pairResult.winner === 'B', unsure: pairResult.winner === 'TIE' };
      }
    }),
  );

  const survivors: EvalCandidate[] = [];
  const rejected: EvalCandidate[] = [];
  let unsureCount = 0;
  let settledCount = 0;

  for (const result of results) {
    if (result.status === 'rejected') {
      // LLM call failed — treat as rejection (conservative)
      continue;
    }
    settledCount++;
    const { candidate, accepted, unsure } = result.value;
    if (unsure) unsureCount++;
    if (accepted) {
      survivors.push(candidate);
    } else {
      rejected.push(candidate);
    }
  }

  const allUnsure = settledCount > 0 && unsureCount === settledCount;

  // If ALL candidates were UNSURE, fall back: re-evaluate all using pairwise comparison
  if (allUnsure && candidates.length > 0) {
    const fallbackResults = await Promise.allSettled(
      candidates.map(async (candidate) => {
        const result = await callPairwise(candidate.parentText, candidate.text);
        return { candidate, accepted: result.winner === 'B' };
      }),
    );

    const fallbackSurvivors: EvalCandidate[] = [];
    const fallbackRejected: EvalCandidate[] = [];
    for (const r of fallbackResults) {
      if (r.status === 'rejected') continue;
      if (r.value.accepted) {
        fallbackSurvivors.push(r.value.candidate);
      } else {
        fallbackRejected.push(r.value.candidate);
      }
    }
    return { survivors: fallbackSurvivors, rejected: fallbackRejected, allUnsure: true };
  }

  return { survivors, rejected, allUnsure };
}

/**
 * Stage 2: Rank surviving candidates via local OpenSkill ratings from match results.
 * Creates local ratings (NOT state.ratings), applies match outcomes, sorts by ordinal.
 * Returns candidates sorted best-first, with ancestry diversity slot.
 */
export function rankSurvivors(
  survivors: EvalCandidate[],
  treeState: TreeState,
  beamWidth: number,
  matchResults: Map<string, Map<string, 'A' | 'B' | 'TIE'>>,
): EvalCandidate[] {
  if (survivors.length <= 1) return survivors;

  // Build local ratings from match results
  const localRatings = new Map<string, Rating>();
  for (const s of survivors) {
    localRatings.set(s.node.variantId, createRating());
  }

  // Apply match results to local ratings (deduplicate symmetric pairs)
  const completedPairs = new Set<string>();
  for (const [idA, opponents] of matchResults) {
    for (const [idB, winner] of opponents) {
      const pairKey = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
      if (completedPairs.has(pairKey)) continue;
      completedPairs.add(pairKey);

      const rA = localRatings.get(idA) ?? createRating();
      const rB = localRatings.get(idB) ?? createRating();

      if (winner === 'A') {
        const [newA, newB] = updateRating(rA, rB);
        localRatings.set(idA, newA);
        localRatings.set(idB, newB);
      } else if (winner === 'B') {
        const [newB, newA] = updateRating(rB, rA);
        localRatings.set(idA, newA);
        localRatings.set(idB, newB);
      } else {
        const [newA, newB] = updateDraw(rA, rB);
        localRatings.set(idA, newA);
        localRatings.set(idB, newB);
      }
    }
  }

  // Sort by ordinal (best first)
  const sorted = [...survivors].sort((a, b) => {
    const ordA = getOrdinal(localRatings.get(a.node.variantId) ?? createRating());
    const ordB = getOrdinal(localRatings.get(b.node.variantId) ?? createRating());
    return ordB - ordA;
  });

  // Apply ancestry diversity slot: top K-1 by ordinal, last slot for different lineage
  if (sorted.length > beamWidth) {
    return selectWithAncestryDiversity(sorted, beamWidth);
  }
  return sorted.slice(0, beamWidth);
}

/**
 * Select top K candidates with ancestry diversity:
 * Top K-1 by ordinal, last slot reserved for a candidate from a different parent lineage.
 */
function selectWithAncestryDiversity(sorted: EvalCandidate[], k: number): EvalCandidate[] {
  if (k <= 1 || sorted.length <= k) return sorted.slice(0, k);

  const topKMinus1 = sorted.slice(0, k - 1);
  const topParents = new Set(topKMinus1.map((c) => c.node.parentNodeId));

  // Find highest-ranked candidate with a different parent
  const diverseCandidate = sorted.slice(k - 1).find((c) => !topParents.has(c.node.parentNodeId));

  if (diverseCandidate) {
    return [...topKMinus1, diverseCandidate];
  }
  // No diversity candidate available — take next best
  return sorted.slice(0, k);
}
