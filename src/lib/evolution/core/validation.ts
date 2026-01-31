// State transition guard predicates for agent-step phase contracts.
// Returns violation lists; empty means valid.

import type { PipelineState, AgentStepPhase } from '../types';

/** Validate PipelineState against expected agent-step phase requirements. */
export function validateStateContracts(state: PipelineState, expectedPhase: AgentStepPhase): string[] {
  const violations: string[] = [];

  // Pool integrity (always validated)
  if (state.pool.length !== state.poolIds.size) {
    violations.push(
      `Pool size mismatch: ${state.pool.length} variants vs ${state.poolIds.size} ids`,
    );
  }
  for (const v of state.pool) {
    if (!state.poolIds.has(v.id)) {
      violations.push(`Variation ${v.id} in pool but not in poolIds`);
    }
  }

  // Check parent references
  for (const v of state.pool) {
    for (const parentId of v.parentIds) {
      if (!state.poolIds.has(parentId)) {
        violations.push(`Variation ${v.id} has parentId ${parentId} not in pool`);
      }
    }
  }

  // Phase 1: Calibration complete — elo_ratings must exist
  if (expectedPhase >= 1) {
    if (state.eloRatings.size === 0) {
      violations.push('Phase 1 complete but no eloRatings');
    } else {
      for (const v of state.pool) {
        if (!state.eloRatings.has(v.id)) {
          violations.push(`No eloRating for pool member ${v.id}`);
        }
      }
    }
  }

  // Phase 2: Tournament — match_history must exist
  if (expectedPhase >= 2) {
    if (state.eloRatings.size === 0) {
      violations.push('Phase 2 complete but no eloRatings');
    } else {
      for (const id of state.eloRatings.keys()) {
        if (!state.poolIds.has(id)) {
          violations.push(`eloRating for unknown variation ${id}`);
        }
      }
    }
    if (state.matchHistory.length === 0) {
      violations.push('Phase 2 complete but no matchHistory');
    }
  }

  // Phase 3: Review — critiques and scores
  if (expectedPhase >= 3) {
    if (state.dimensionScores === null) violations.push('Phase 3 complete but no dimensionScores');
    if (state.allCritiques === null) violations.push('Phase 3 complete but no allCritiques');
  }

  // Phase 4: Proximity — diversity metrics
  if (expectedPhase >= 4) {
    if (state.diversityScore === null) violations.push('Phase 4 complete but no diversityScore');
  }

  // Phase 5: Meta-review
  if (expectedPhase >= 5) {
    if (state.metaFeedback === null) violations.push('Phase 5 complete but no metaFeedback');
  }

  return violations;
}

/** Validate append-only pool contract (no variants were removed). */
export function validatePoolAppendOnly(poolBefore: string[], poolAfter: string[]): string[] {
  const beforeSet = new Set(poolBefore);
  const afterSet = new Set(poolAfter);
  const violations: string[] = [];
  for (const vid of beforeSet) {
    if (!afterSet.has(vid)) {
      violations.push(`Variant ${vid} was removed from pool (violates append-only)`);
    }
  }
  return violations;
}
