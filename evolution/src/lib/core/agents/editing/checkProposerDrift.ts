// Strip-markup drift detector. Compares the parser's recoveredSource (proposed
// markup with all CriticMarkup removed, "before" content kept) against the
// agent's current.text. Any difference means the Proposer modified text outside
// its markup spans — positions become unreliable, cycle-level kill switch.
//
// Whitespace is normalized (runs of spaces collapsed; line endings tolerated)
// to absorb cosmetic LLM variance without false positives.

import type { DriftCheckResult, EditingDriftRegion } from './types';

function normalizeWhitespace(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n');
}

export function checkProposerDrift(
  recoveredSource: string,
  currentText: string,
): DriftCheckResult {
  const a = normalizeWhitespace(recoveredSource);
  const b = normalizeWhitespace(currentText);
  if (a === b) return { drift: false };

  // First diff offset (using normalized strings — close enough for human-readable
  // sample reporting; downstream recovery uses the raw strings for patching).
  let i = 0;
  const min = Math.min(a.length, b.length);
  while (i < min && a[i] === b[i]) i++;

  // Region detection: walk forward from each diff position until re-sync.
  // For now, treat the entire mismatched suffix as a single region (drift recovery
  // re-checks per-region). Conservative: maps to "minor" only when offset+span is small.
  const regions: EditingDriftRegion[] = [{
    offset: i,
    driftedText: a.slice(i, Math.min(a.length, i + 200)),
  }];

  return {
    drift: true,
    firstDiffOffset: i,
    sample: a.slice(Math.max(0, i - 20), i + 40),
    regions,
  };
}
