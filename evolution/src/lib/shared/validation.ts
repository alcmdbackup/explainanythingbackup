// State transition guard predicates for agent-step phase contracts.
// Returns violation lists; empty means valid.

import type { ReadonlyPipelineState, AgentStepPhase } from '../types';

/** Validate PipelineState against expected agent-step phase requirements. */
export function validateStateContracts(state: ReadonlyPipelineState, expectedPhase: AgentStepPhase): string[] {
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

  // Phase 1: Calibration complete — ratings must exist
  if (expectedPhase >= 1) {
    if (state.ratings.size === 0) {
      violations.push('Phase 1 complete but no ratings');
    } else {
      for (const v of state.pool) {
        if (!state.ratings.has(v.id)) {
          violations.push(`No rating for pool member ${v.id}`);
        }
      }
    }
  }

  // Phase 2: Tournament — match_history and rating keys must be valid
  if (expectedPhase >= 2) {
    for (const id of state.ratings.keys()) {
      if (!state.poolIds.has(id)) {
        violations.push(`Rating for unknown variation ${id}`);
      }
    }
    if (state.matchHistory.length === 0) {
      violations.push('Phase 2 complete but no matchHistory');
    }
  }

  // Phase 3: Review — critiques and scores
  if (expectedPhase >= 3) {
    if (state.dimensionScores === null) violations.push('Phase 3 complete but no dimensionScores');
    if (state.allCritiques.length === 0) violations.push('Phase 3 complete but no allCritiques');
  }

  // Phase 4: Proximity — diversity metrics
  if (expectedPhase >= 4) {
    if (state.diversityScore === 0) violations.push('Phase 4 complete but no diversityScore');
  }

  // Phase 5: Meta-review
  if (expectedPhase >= 5) {
    if (state.metaFeedback === null) violations.push('Phase 5 complete but no metaFeedback');
  }

  return violations;
}

/**
 * Phase-independent structural validation of PipelineState.
 * Checks pool/poolIds consistency, parent ID integrity, and ratings key validity.
 * Returns an array of violation strings (empty = valid).
 */
export function validateStateIntegrity(state: ReadonlyPipelineState): string[] {
  const violations: string[] = [];

  // 1. Pool/poolIds consistency: every variant's id should be in poolIds
  for (const v of state.pool) {
    if (!state.poolIds.has(v.id)) {
      violations.push(`Variant ${v.id} in pool but missing from poolIds`);
    }
  }
  // Every id in poolIds should correspond to a variant in pool
  const poolIdSet = new Set(state.pool.map((v) => v.id));
  for (const id of state.poolIds) {
    if (!poolIdSet.has(id)) {
      violations.push(`poolIds contains ${id} with no corresponding variant in pool`);
    }
  }

  // 2. Parent ID integrity: every parentId should exist in poolIds
  for (const v of state.pool) {
    for (const parentId of v.parentIds) {
      if (!state.poolIds.has(parentId)) {
        violations.push(`Variant ${v.id} references parentId ${parentId} not in poolIds`);
      }
    }
  }

  // 3. Ratings keys subset of poolIds
  for (const id of state.ratings.keys()) {
    if (!state.poolIds.has(id)) {
      violations.push(`ratings contains key ${id} not in poolIds`);
    }
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
