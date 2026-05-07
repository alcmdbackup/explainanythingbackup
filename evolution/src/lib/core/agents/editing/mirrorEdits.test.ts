// Tests for the mirror-edit toolkit used by the proposer/approver criteria agent.
// Covers: invertAtomicEdit (insert→delete / delete→insert / replace→reverse-replace),
// constructMirrorGroup (multi-edit position arithmetic), roundTripApply (idempotency),
// and renderMirrorMarkup (CriticMarkup rendering).

import {
  invertAtomicEdit,
  constructMirrorGroup,
  roundTripApply,
  renderMirrorMarkup,
  applyEditsRTL,
} from './mirrorEdits';
import type { EditingAtomicEdit, EditingGroup } from '../../../types';

function atomicInsert(start: number, text: string, groupNumber = 1): EditingAtomicEdit {
  return {
    groupNumber,
    kind: 'insert',
    range: { start, end: start },
    markupRange: { start: 0, end: 0 },
    oldText: '',
    newText: text,
    contextBefore: '',
    contextAfter: '',
  };
}
function atomicDelete(start: number, end: number, oldText: string, groupNumber = 1): EditingAtomicEdit {
  return {
    groupNumber,
    kind: 'delete',
    range: { start, end },
    markupRange: { start: 0, end: 0 },
    oldText,
    newText: '',
    contextBefore: '',
    contextAfter: '',
  };
}
function atomicReplace(start: number, end: number, oldText: string, newText: string, groupNumber = 1): EditingAtomicEdit {
  return {
    groupNumber,
    kind: 'replace',
    range: { start, end },
    markupRange: { start: 0, end: 0 },
    oldText,
    newText,
    contextBefore: '',
    contextAfter: '',
  };
}
function group(atomicEdits: EditingAtomicEdit[], groupNumber = 1): EditingGroup {
  return { groupNumber, atomicEdits };
}

describe('invertAtomicEdit', () => {
  it('flips insert → delete', () => {
    const original = 'Hello world.';
    const insert = atomicInsert(6, 'beautiful ');
    const articleAfter = applyEditsRTL(original, [insert]);
    expect(articleAfter).toBe('Hello beautiful world.');

    const inverted = invertAtomicEdit(insert, articleAfter, [insert]);
    expect(inverted.kind).toBe('delete');
    expect(inverted.range.start).toBe(6);
    expect(inverted.range.end).toBe(6 + 'beautiful '.length);
    expect(inverted.oldText).toBe('beautiful ');
    expect(inverted.newText).toBe('');
  });

  it('flips delete → insert', () => {
    const original = 'Hello cruel world.';
    const del = atomicDelete(6, 12, 'cruel ');
    const articleAfter = applyEditsRTL(original, [del]);
    expect(articleAfter).toBe('Hello world.');

    const inverted = invertAtomicEdit(del, articleAfter, [del]);
    expect(inverted.kind).toBe('insert');
    expect(inverted.range.start).toBe(6);
    expect(inverted.range.end).toBe(6); // zero-width gap
    expect(inverted.oldText).toBe('');
    expect(inverted.newText).toBe('cruel ');
  });

  it('flips replace → reverse-replace', () => {
    const original = 'Hello cruel world.';
    const rep = atomicReplace(6, 12, 'cruel ', 'lovely ');
    const articleAfter = applyEditsRTL(original, [rep]);
    expect(articleAfter).toBe('Hello lovely world.');

    const inverted = invertAtomicEdit(rep, articleAfter, [rep]);
    expect(inverted.kind).toBe('replace');
    expect(inverted.range.start).toBe(6);
    expect(inverted.range.end).toBe(6 + 'lovely '.length);
    expect(inverted.oldText).toBe('lovely ');
    expect(inverted.newText).toBe('cruel ');
  });
});

describe('constructMirrorGroup', () => {
  it('produces an article-after-apply matching applyEditsRTL output', () => {
    const original = 'A B C D E';
    const g = group([atomicReplace(2, 3, 'B', 'X')]);
    const { articleAfterApply } = constructMirrorGroup(g, original);
    expect(articleAfterApply).toBe('A X C D E');
  });

  it('handles a multi-edit group with offset shift', () => {
    // Two inserts at positions 0 and 6. After right-to-left apply, both are present.
    const original = 'Hello world.';
    const g = group([
      atomicInsert(0, 'PRE: '),
      atomicInsert(6, 'beautiful '),
    ]);
    const { mirrorGroup, articleAfterApply } = constructMirrorGroup(g, original);
    expect(articleAfterApply).toBe('PRE: Hello beautiful world.');
    // Mirror group should have 2 inverted edits, each delete kind.
    expect(mirrorGroup.atomicEdits).toHaveLength(2);
    expect(mirrorGroup.atomicEdits.every(e => e.kind === 'delete')).toBe(true);
  });
});

describe('roundTripApply (idempotency)', () => {
  it('forward then mirror returns the original text (single insert)', () => {
    const original = 'Hello world.';
    const g = group([atomicInsert(6, 'beautiful ')]);
    const result = roundTripApply(g, original);
    expect(result.success).toBe(true);
    expect(result.finalText).toBe(original);
  });

  it('forward then mirror returns the original text (single delete)', () => {
    const original = 'Hello cruel world.';
    const g = group([atomicDelete(6, 12, 'cruel ')]);
    expect(roundTripApply(g, original).success).toBe(true);
  });

  it('forward then mirror returns the original text (single replace)', () => {
    const original = 'Hello cruel world.';
    const g = group([atomicReplace(6, 12, 'cruel ', 'lovely ')]);
    expect(roundTripApply(g, original).success).toBe(true);
  });

  it('forward then mirror returns the original text (multi-edit group)', () => {
    const original = 'one two three four five';
    const g = group([
      atomicReplace(0, 3, 'one', 'ONE'),
      atomicReplace(8, 13, 'three', 'THREE'),
    ]);
    const result = roundTripApply(g, original);
    expect(result.success).toBe(true);
    expect(result.finalText).toBe(original);
  });
});

describe('renderMirrorMarkup', () => {
  it('produces mirror article matching forward-applied output', () => {
    const original = 'Hello world.';
    const g = group([atomicInsert(6, 'beautiful ')]);
    const { mirrorArticleA, mirrorGroups } = renderMirrorMarkup(original, [g]);
    expect(mirrorArticleA).toBe('Hello beautiful world.');
    expect(mirrorGroups).toHaveLength(1);
    expect(mirrorGroups[0]!.atomicEdits[0]!.kind).toBe('delete');
  });

  it('renders CriticMarkup with group numbers (delete pattern for mirror of insert)', () => {
    const original = 'Hello world.';
    const g = group([atomicInsert(6, 'beautiful ')], 7);
    const { mirrorMarkupString } = renderMirrorMarkup(original, [g]);
    // Mirror is a delete of 'beautiful ' from A'; markup pattern: {-- [#7] beautiful  --}
    expect(mirrorMarkupString).toContain('{-- [#7]');
    expect(mirrorMarkupString).toContain('beautiful');
    expect(mirrorMarkupString).toContain('--}');
  });
});
