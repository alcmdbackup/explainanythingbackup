import { validateEditGroups } from './validateEditGroups';
import type { EditingAtomicEdit, EditingGroup } from './types';

function edit(args: Partial<EditingAtomicEdit> & { range: { start: number; end: number } }): EditingAtomicEdit {
  return {
    groupNumber: args.groupNumber ?? 1,
    kind: args.kind ?? 'replace',
    range: args.range,
    markupRange: args.markupRange ?? { start: 0, end: 0 },
    oldText: args.oldText ?? '',
    newText: args.newText ?? '',
    contextBefore: args.contextBefore ?? '',
    contextAfter: args.contextAfter ?? '',
  };
}

function group(n: number, edits: EditingAtomicEdit[]): EditingGroup {
  return { groupNumber: n, atomicEdits: edits };
}

describe('validateEditGroups — hard rules', () => {
  it('drops a group whose newText exceeds the length cap (500 chars)', () => {
    const text = 'foo bar baz';
    const g = group(1, [edit({ range: { start: 4, end: 7 }, oldText: 'bar', newText: 'x'.repeat(501) })]);
    const r = validateEditGroups([g], text);
    expect(r.approverGroups).toHaveLength(0);
    expect(r.droppedPreApprover[0]!.reason).toBe('newText_too_long');
  });

  it('drops a group whose oldText contains a paragraph break', () => {
    const text = 'foo\n\nbar';
    const g = group(1, [edit({ range: { start: 0, end: 5 }, oldText: 'foo\n\n', newText: 'x' })]);
    const r = validateEditGroups([g], text);
    expect(r.droppedPreApprover[0]!.reason).toBe('oldText_contains_paragraph_break');
  });

  it('drops a group whose newText introduces a heading line', () => {
    const text = 'plain text';
    const g = group(1, [edit({ range: { start: 0, end: 5 }, oldText: 'plain', newText: '# Heading' })]);
    const r = validateEditGroups([g], text);
    expect(r.droppedPreApprover[0]!.reason).toBe('newText_introduces_heading');
  });

  it('drops a group whose range crosses a heading line', () => {
    const text = '# Heading\nbody';
    const g = group(1, [edit({ range: { start: 0, end: 14 }, oldText: '# Heading\nbody', newText: 'replaced' })]);
    const r = validateEditGroups([g], text);
    expect(r.droppedPreApprover[0]!.reason).toBe('range_crosses_heading');
  });

  it('drops a group with code-fence markers in newText', () => {
    const text = 'plain text';
    const g = group(1, [edit({ range: { start: 0, end: 5 }, oldText: 'plain', newText: '```code```' })]);
    const r = validateEditGroups([g], text);
    expect(r.droppedPreApprover[0]!.reason).toBe('code_fence_in_edit');
  });

  it('keeps a clean group', () => {
    const text = 'Hello world.';
    const g = group(1, [edit({ range: { start: 6, end: 11 }, oldText: 'world', newText: 'Earth' })]);
    const r = validateEditGroups([g], text);
    expect(r.approverGroups).toHaveLength(1);
    expect(r.droppedPreApprover).toHaveLength(0);
  });

  it('group-level coherence: any atomic edit failing drops the WHOLE group', () => {
    const text = 'Hello world.';
    const g = group(1, [
      edit({ range: { start: 6, end: 11 }, oldText: 'world', newText: 'Earth' }), // valid
      edit({ range: { start: 0, end: 5 }, oldText: 'Hello', newText: '# Heading' }), // bad
    ]);
    const r = validateEditGroups([g], text);
    expect(r.approverGroups).toHaveLength(0);
  });
});

describe('validateEditGroups — caps', () => {
  it('drops excess groups when cycle cap (30 atomic edits) is exceeded', () => {
    const text = 'a'.repeat(100);
    // 11 groups × 3 atomic edits = 33 → 3 groups dropped (number-order: highest first).
    const groups: EditingGroup[] = Array.from({ length: 11 }, (_, i) =>
      group(i + 1, Array.from({ length: 3 }, () => edit({ range: { start: 0, end: 0 }, oldText: '', newText: 'x' }))),
    );
    const r = validateEditGroups(groups, text);
    expect(r.approverGroups.length).toBeLessThan(11);
  });

  it('drops a single group exceeding the per-group cap (5 atomic edits)', () => {
    const text = 'short';
    const g = group(1, Array.from({ length: 6 }, () => edit({ range: { start: 0, end: 0 }, oldText: '', newText: 'x' })));
    const r = validateEditGroups([g], text);
    expect(r.approverGroups).toHaveLength(0);
    expect(r.droppedPreApprover[0]!.reason).toMatch(/group_too_large/);
  });
});

describe('validateEditGroups — size-ratio guardrail (Decisions §17)', () => {
  it('drops groups until the ratio is ≤ 1.5×', () => {
    const text = 'a'.repeat(100); // baseLen = 100
    // Two groups, each adds 60 chars. Both = 220 chars projected (2.2×). Drop one → 160 chars (1.6× still). Drop both → 100 (1.0×).
    const groups: EditingGroup[] = [
      group(1, [edit({ range: { start: 0, end: 0 }, oldText: '', newText: 'x'.repeat(60) })]),
      group(2, [edit({ range: { start: 0, end: 0 }, oldText: '', newText: 'y'.repeat(60) })]),
    ];
    const r = validateEditGroups(groups, text);
    // After dropping until ratio ≤ 1.5: should keep nothing OR keep one if it fits within 1.5x.
    // 100 + 60 = 160 → 1.6× still > 1.5×. Both dropped.
    expect(r.approverGroups).toHaveLength(0);
    expect(r.droppedPreApprover.some((d) => d.reason === 'size_ratio_guardrail')).toBe(true);
  });

  it('keeps groups when projected size is within ratio', () => {
    const text = 'a'.repeat(100); // baseLen = 100
    const g = group(1, [edit({ range: { start: 0, end: 0 }, oldText: '', newText: 'x'.repeat(40) })]); // 140 chars = 1.4×
    const r = validateEditGroups([g], text);
    expect(r.approverGroups).toHaveLength(1);
  });

  it('flags sizeExplosion when a SINGLE group exceeds the cap on its own', () => {
    const text = 'a'.repeat(100); // baseLen = 100
    const g = group(1, [edit({ range: { start: 0, end: 0 }, oldText: '', newText: 'x'.repeat(200) })]); // 300 chars = 3×
    const r = validateEditGroups([g], text);
    expect(r.sizeExplosion).toBe(true);
  });

  it('does NOT flag sizeExplosion when there are no input groups', () => {
    const r = validateEditGroups([], 'foo');
    expect(r.sizeExplosion).toBe(false);
    expect(r.approverGroups).toHaveLength(0);
  });
});
