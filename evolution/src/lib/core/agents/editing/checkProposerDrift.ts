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
  // Normalized comparison decides whether drift is real (cosmetic whitespace
  // differences are tolerated). If normalized strings are equal, no drift.
  const aNorm = normalizeWhitespace(recoveredSource);
  const bNorm = normalizeWhitespace(currentText);
  if (aNorm === bNorm) return { drift: false };

  // For region offsets we use RAW coordinates so downstream snap-to-source can
  // splice the matching slice from currentText directly. Normalized offsets
  // would skew when whitespace collapse rates differ between the two strings.
  let i = 0;
  const min = Math.min(recoveredSource.length, currentText.length);
  while (i < min && recoveredSource[i] === currentText[i]) i++;

  // Single region = entire mismatched suffix. No length cap: classifyDriftMagnitude
  // applies its own DRIFT_MAX_CHARS threshold for the major/minor decision, and
  // snapDriftToSource needs the full extent so its splice covers the whole drift.
  const regions: EditingDriftRegion[] = [{
    offset: i,
    driftedText: recoveredSource.slice(i),
  }];

  return {
    drift: true,
    firstDiffOffset: i,
    sample: recoveredSource.slice(Math.max(0, i - 20), i + 40),
    regions,
  };
}
