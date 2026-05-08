import { capGroupsByMagnitude } from './capGroupsByMagnitude';
import type { EditingGroup } from '../../../types';

function group(num: number, oldLen: number, newLen: number, rangeStart = 0): EditingGroup {
  return {
    groupNumber: num,
    atomicEdits: [{
      groupNumber: num,
      kind: 'replace',
      range: { start: rangeStart, end: rangeStart + 1 },
      markupRange: { start: rangeStart, end: rangeStart + 1 },
      oldText: 'O'.repeat(oldLen),
      newText: 'N'.repeat(newLen),
      contextBefore: '',
      contextAfter: '',
    }],
  };
}

describe('capGroupsByMagnitude', () => {
  it('passes through when groups.length <= K', () => {
    const groups = [group(1, 5, 5), group(2, 10, 10)];
    const r = capGroupsByMagnitude(groups, 'source', 10);
    expect(r.kept).toEqual(groups);
    expect(r.dropped).toEqual([]);
  });

  it('drops smallest groups by magnitude when over K', () => {
    const source = 'a';
    const groups = [
      group(1, 5, 5),    // mag 10
      group(2, 50, 50),  // mag 100
      group(3, 1, 1),    // mag 2
    ];
    const r = capGroupsByMagnitude(groups, source, 2);
    expect(r.kept).toHaveLength(2);
    expect(r.dropped).toHaveLength(1);
    // The smallest (group 3, mag 2) should be dropped.
    expect(r.dropped[0]!.groupNumber).toBe(3);
    expect(r.dropped[0]!.reason).toBe('dropped_by_magnitude_cap');
  });

  it('retains top-1 per heading-bounded section even if its magnitude is small', () => {
    // Source has 3 sections; small group in section 2 should survive over a
    // larger group in section 1 once the cap is reached.
    const source = '# H1\n\n' + 'a'.repeat(100) + '\n\n# H2\n\n' + 'b'.repeat(100);
    const h1pos = 7;   // inside section 1
    const h2pos = 113; // inside section 2 (after '# H2\n\n')
    const groups = [
      group(1, 50, 50, h1pos),  // big in section 1
      group(2, 60, 60, h1pos),  // bigger in section 1
      group(3, 5, 5, h2pos),    // tiny in section 2
    ];
    const r = capGroupsByMagnitude(groups, source, 2);
    // Top-1 per section: section 1 keeps its biggest (groupNumber=2);
    // section 2 keeps its only (groupNumber=3). The other section-1 group is
    // dropped despite being larger than groupNumber=3.
    const keptNums = r.kept.map((g) => g.groupNumber).sort();
    expect(keptNums).toEqual([2, 3]);
  });
});
