import { coalesceAdjacentGroups } from './coalesceAdjacentGroups';
import type { EditingGroup } from '../../../types';

function group(num: number, atomics: Array<{ kind: 'insert' | 'delete' | 'replace'; rangeStart: number; rangeEnd: number }>): EditingGroup {
  return {
    groupNumber: num,
    atomicEdits: atomics.map((a, i) => ({
      groupNumber: num,
      kind: a.kind,
      range: { start: a.rangeStart, end: a.rangeEnd },
      markupRange: { start: a.rangeStart, end: a.rangeEnd },
      oldText: 'O',
      newText: 'N',
      contextBefore: '',
      contextAfter: '',
    })),
  };
}

describe('coalesceAdjacentGroups', () => {
  it('returns input unchanged when there are 0 or 1 groups', () => {
    const source = 'abc';
    expect(coalesceAdjacentGroups([], source)).toEqual([]);
    const g = group(1, [{ kind: 'insert', rangeStart: 0, rangeEnd: 1 }]);
    expect(coalesceAdjacentGroups([g], source)).toEqual([g]);
  });

  it('merges two adjacent same-kind groups within 24-char gap of whitespace', () => {
    const source = 'abc   def'; // 3-char ws gap
    const g1 = group(1, [{ kind: 'insert', rangeStart: 3, rangeEnd: 3 }]);
    const g2 = group(2, [{ kind: 'insert', rangeStart: 6, rangeEnd: 6 }]);
    const out = coalesceAdjacentGroups([g1, g2], source);
    expect(out).toHaveLength(1);
    expect(out[0]!.atomicEdits).toHaveLength(2);
  });

  it('does NOT merge when gap > 24 chars', () => {
    const source = 'abc' + ' '.repeat(30) + 'def';
    const g1 = group(1, [{ kind: 'insert', rangeStart: 3, rangeEnd: 3 }]);
    const g2 = group(2, [{ kind: 'insert', rangeStart: 33, rangeEnd: 33 }]);
    expect(coalesceAdjacentGroups([g1, g2], source)).toHaveLength(2);
  });

  it('does NOT merge across paragraph boundary (\\n\\n)', () => {
    const source = 'abc\n\ndef';
    const g1 = group(1, [{ kind: 'insert', rangeStart: 3, rangeEnd: 3 }]);
    const g2 = group(2, [{ kind: 'insert', rangeStart: 5, rangeEnd: 5 }]);
    expect(coalesceAdjacentGroups([g1, g2], source)).toHaveLength(2);
  });

  it('does NOT merge different kinds (insert + delete)', () => {
    const source = 'abc def';
    const g1 = group(1, [{ kind: 'insert', rangeStart: 3, rangeEnd: 3 }]);
    const g2 = group(2, [{ kind: 'delete', rangeStart: 4, rangeEnd: 7 }]);
    expect(coalesceAdjacentGroups([g1, g2], source)).toHaveLength(2);
  });
});
