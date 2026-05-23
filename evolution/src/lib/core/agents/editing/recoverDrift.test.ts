// Tests for the drift magnitude classifier. The deterministic snap-to-source
// recovery is tested in `snapDriftToSource.test.ts`.

import { classifyDriftMagnitude } from './recoverDrift';
import type { EditingDriftRegion, EditingGroup } from './types';

function region(offset: number, drifted: string): EditingDriftRegion {
  return { offset, driftedText: drifted };
}

function group(n: number, atomicEdits: EditingGroup['atomicEdits']): EditingGroup {
  return { groupNumber: n, atomicEdits };
}

describe('classifyDriftMagnitude', () => {
  it('returns minor for small drift with no markup overlap', () => {
    expect(classifyDriftMagnitude([region(10, 'x')], [])).toBe('minor');
  });

  it('returns major when more than 3 regions', () => {
    const regions = [region(0, 'a'), region(10, 'b'), region(20, 'c'), region(30, 'd')];
    expect(classifyDriftMagnitude(regions, [])).toBe('major');
  });

  it('returns major when total drifted chars > 200', () => {
    const big = 'x'.repeat(201);
    expect(classifyDriftMagnitude([region(0, big)], [])).toBe('major');
  });

  it('returns major when a region overlaps any markupRange', () => {
    const groups = [group(1, [{
      groupNumber: 1, kind: 'replace',
      range: { start: 0, end: 0 }, markupRange: { start: 5, end: 20 },
      oldText: '', newText: '', contextBefore: '', contextAfter: '',
    }])];
    expect(classifyDriftMagnitude([region(10, 'inside')], groups)).toBe('major');
  });

  it('boundary: exactly 3 regions, 200 chars, no overlap → minor', () => {
    const regions = [region(0, 'a'.repeat(100)), region(50, 'b'.repeat(50)), region(100, 'c'.repeat(50))];
    expect(classifyDriftMagnitude(regions, [])).toBe('minor');
  });
});
