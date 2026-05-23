// Deterministic drift recovery: replaces the prior LLM-based recoverDrift call.
//
// Mode A's contract requires the proposer to preserve unchanged text verbatim.
// `classifyDriftMagnitude` already guarantees every drift region passed in here
// is OUTSIDE any markup span (overlap → 'major' → caller never invokes us).
// Therefore any drift outside markup is, by definition, unauthorized — we snap
// it back to the source text. The proposer's wrapped edits remain untouched
// and proceed to the approver as usual.
//
// Cost: 0 (no LLM call). Latency: O(regions). Replaces gpt-4.1-nano call that
// classified each region as 'benign'|'intentional' — under our contract,
// 'intentional' outside-markup edits are still unauthorized, so the LLM step
// only ever cost surface rate without buying anything.
//
// Splicing semantics mirror the prior `recoverDrift` patcher: regions are
// applied in reverse-offset order so earlier offsets don't shift, and the
// offset is interpreted directly against `proposedMarkup` (matches existing
// recoverDrift.ts:138-141 — same coordinate space the LLM patcher used).

import { sourceContainsMarkup } from './parseProposedEdits';
import type { EditingDriftRegion } from './types';

export interface SnapDriftResult {
  patchedMarkup: string;
  /** Per-region classifications mirroring the prior recoverDrift shape so the
   *  cycle's `driftRecovery.classifications` stays a useful forensic record. */
  classifications: EditingDriftRegion[];
  /** True when one or more source slices contained CriticMarkup delimiters and
   *  the snap was aborted to avoid corrupting the markup with embedded
   *  delimiters. The caller treats this like an unrecoverable-drift abort. */
  aborted?: boolean;
}

export function snapDriftToSource(args: {
  regions: EditingDriftRegion[];
  proposedMarkup: string;
  currentText: string;
}): SnapDriftResult {
  const { regions, proposedMarkup, currentText } = args;
  // Reverse-offset order: splicing earlier-first would shift later offsets.
  const sorted = [...regions].sort((a, b) => b.offset - a.offset);
  let patched = proposedMarkup;
  const classifications: EditingDriftRegion[] = [];
  for (const r of sorted) {
    const sourceSlice = currentText.slice(r.offset, r.offset + r.driftedText.length);
    // Guard: the upstream IterativeEditingAgent already rejects parents whose
    // source contains CriticMarkup delimiters, but a partial slice can still
    // start mid-token if the source happened to embed `{++` etc. — splicing
    // those bytes into proposedMarkup would mint fake edit markers that the
    // re-parse would treat as real edits.
    if (sourceContainsMarkup(sourceSlice)) {
      return {
        patchedMarkup: proposedMarkup,
        classifications: regions.map((rr) => ({
          offset: rr.offset,
          driftedText: rr.driftedText,
          classification: 'intentional',
        })),
        aborted: true,
      };
    }
    classifications.push({
      offset: r.offset,
      driftedText: r.driftedText,
      classification: 'benign',
      patch: sourceSlice,
    });
    patched = patched.slice(0, r.offset) + sourceSlice + patched.slice(r.offset + r.driftedText.length);
  }
  // Return classifications in offset-ascending order for stable forensics.
  return { patchedMarkup: patched, classifications: classifications.sort((a, b) => a.offset - b.offset) };
}
