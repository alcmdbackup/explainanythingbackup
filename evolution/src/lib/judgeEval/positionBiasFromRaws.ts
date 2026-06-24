// Server-side derivation of position-bias aggregates from stored raws on
// judge_eval_agreement_calls. Pure helper — no DB I/O. Called by
// getAgreementRunDetailAction once per run to populate the position-bias
// tiles in the run detail page.
//
// CRITICAL: the reverse pass's prompt swaps the texts (text_b labeled "A",
// text_a labeled "B"). So a literal "A" from the reverse pass means
// variant_b won in canonical terms. We MUST flip the reverse pass's letter
// back to canonical (A↔B; TIE unchanged) before comparing to the forward
// pass. Without the flip, the metric is INVERTED — raw-letter mismatch
// (which is what an UNBIASED judge produces) gets counted as "position
// bias", and raw-letter match (which is what a BIASED judge produces) gets
// counted as "no bias". See commit e457469ec for the run that surfaced this.
//
// Denominator: only rows where BOTH passes committed to a definite A or B
// (post-flip). One-pass TIE and mutual TIE are NOT position-bias signals —
// they're indecision. Excluding them gives a clean "of the rows where both
// judges took a side, how often did position swap flip the verdict?"

import { parseWinner } from '../shared/computeRatings';
import { parseRubricVerdict } from '../shared/rubricJudge';
import type { PositionBiasAggregates } from './agreementMetrics';

/** A row of stored raws for one (pair × repeat). Only the four raw columns + pair_kind. */
export interface RawsRow {
  pair_kind: 'article' | 'paragraph';
  holistic_forward_raw: string | null;
  holistic_reverse_raw: string | null;
  rubric_forward_raw: string | null;
  rubric_reverse_raw: string | null;
}

export interface PositionBiasByKind {
  article: PositionBiasAggregates;
  paragraph: PositionBiasAggregates;
  /** Aggregate across both kinds. */
  both: PositionBiasAggregates;
}

export const emptyBias = (): PositionBiasAggregates => ({
  holisticMismatch: 0,
  holisticParsed: 0,
  rubricMismatch: 0,
  rubricParsed: 0,
});

/** Narrow parseWinner's `string | null` return to the 3-value alphabet so the flip helper is typesafe. */
export function narrowWinner(s: string | null): 'A' | 'B' | 'TIE' | null {
  return s === 'A' || s === 'B' || s === 'TIE' ? s : null;
}

/** Flip a verdict letter from raw-prompt frame to canonical frame: A↔B, TIE/null unchanged. */
export function flipCanonical(w: 'A' | 'B' | 'TIE' | null): 'A' | 'B' | 'TIE' | null {
  if (w === 'A') return 'B';
  if (w === 'B') return 'A';
  return w;
}

/** Reduce a per-criterion verdict map to a single pass-level winner via simple majority.
 *  Returns null if no criterion voted A or B (all TIE or all unparsable). */
export function rubricPassWinner(verdicts: Record<string, string | null> | null): 'A' | 'B' | 'TIE' | null {
  if (!verdicts) return null;
  let a = 0;
  let b = 0;
  for (const v of Object.values(verdicts)) {
    if (v === 'A') a += 1;
    else if (v === 'B') b += 1;
  }
  if (a === 0 && b === 0) return null;
  if (a > b) return 'A';
  if (b > a) return 'B';
  return 'TIE';
}

/** Should this (forward, reverse-canonical) pair count toward the position-bias denominator?
 *  Both passes must have committed to A or B; TIE and null on either side are excluded. */
function bothCommitted(
  fwd: 'A' | 'B' | 'TIE' | null,
  revCanonical: 'A' | 'B' | 'TIE' | null,
): fwd is 'A' | 'B' {
  return (fwd === 'A' || fwd === 'B') && (revCanonical === 'A' || revCanonical === 'B');
}

/**
 * Compute position-bias aggregates from a batch of rows.
 *
 * @param rows - the per-(pair × repeat) raws for one run, error-free, both kinds.
 * @param dimNames - rubric dimension names (ordered). Empty array disables rubric counting.
 */
export function computePositionBiasFromRaws(
  rows: ReadonlyArray<RawsRow>,
  dimNames: ReadonlyArray<string>,
): PositionBiasByKind {
  const out: PositionBiasByKind = {
    article: emptyBias(),
    paragraph: emptyBias(),
    both: emptyBias(),
  };

  for (const r of rows) {
    const kindBucket = out[r.pair_kind];

    // Holistic: parseWinner each raw, flip reverse, only count both-committed.
    const hFwd = narrowWinner(r.holistic_forward_raw ? parseWinner(r.holistic_forward_raw) : null);
    const hRevRaw = narrowWinner(r.holistic_reverse_raw ? parseWinner(r.holistic_reverse_raw) : null);
    const hRevCanonical = flipCanonical(hRevRaw);
    if (bothCommitted(hFwd, hRevCanonical)) {
      kindBucket.holisticParsed += 1;
      out.both.holisticParsed += 1;
      if (hFwd !== hRevCanonical) {
        kindBucket.holisticMismatch += 1;
        out.both.holisticMismatch += 1;
      }
    }

    // Rubric: parseRubricVerdict needs dimension names; skip if rubric isn't configured.
    if (dimNames.length > 0) {
      const rFwdVerdicts = r.rubric_forward_raw
        ? parseRubricVerdict(r.rubric_forward_raw, dimNames as string[])
        : null;
      const rRevVerdicts = r.rubric_reverse_raw
        ? parseRubricVerdict(r.rubric_reverse_raw, dimNames as string[])
        : null;
      const rFwd = narrowWinner(rubricPassWinner(rFwdVerdicts));
      const rRev = narrowWinner(rubricPassWinner(rRevVerdicts));
      const rRevCanonical = flipCanonical(rRev);
      if (bothCommitted(rFwd, rRevCanonical)) {
        kindBucket.rubricParsed += 1;
        out.both.rubricParsed += 1;
        if (rFwd !== rRevCanonical) {
          kindBucket.rubricMismatch += 1;
          out.both.rubricMismatch += 1;
        }
      }
    }
  }

  return out;
}
