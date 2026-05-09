// Drift magnitude classifier. The recovery itself is now deterministic and
// lives in `snapDriftToSource.ts`; this module just owns the
// minor-vs-major decision the agent uses to pick a path.
//
// Magnitude rules (per Decisions §11):
//   - major if more than DRIFT_MAX_REGIONS regions
//   - major if total drifted chars > DRIFT_MAX_CHARS
//   - major if any region overlaps a proposer markupRange (positions unrecoverable)
//   - else minor

import { DRIFT_MAX_REGIONS, DRIFT_MAX_CHARS } from './constants';
import type { EditingDriftRegion, EditingGroup } from './types';

export type DriftMagnitude = 'minor' | 'major';

export function classifyDriftMagnitude(
  regions: EditingDriftRegion[],
  groups: EditingGroup[],
): DriftMagnitude {
  if (regions.length > DRIFT_MAX_REGIONS) return 'major';
  const totalChars = regions.reduce((sum, r) => sum + r.driftedText.length, 0);
  if (totalChars > DRIFT_MAX_CHARS) return 'major';
  for (const r of regions) {
    for (const g of groups) {
      for (const e of g.atomicEdits) {
        if (r.offset >= e.markupRange.start && r.offset < e.markupRange.end) return 'major';
      }
    }
  }
  return 'minor';
}
