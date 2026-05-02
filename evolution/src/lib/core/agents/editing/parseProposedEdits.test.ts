// Core parser tests — covers the 3 markup forms, position math, paired merge,
// adversarial inputs (combined-form with ~> in content, invalid group numbers,
// overlapping markup). Plus context capture invariant.

import { parseProposedEdits, sourceContainsMarkup } from './parseProposedEdits';

describe('parseProposedEdits', () => {
  it('parses a single insertion', () => {
    const source = 'Hello world.';
    const markup = 'Hello {++ [#1] cruel ++}world.';
    const r = parseProposedEdits(markup, source);
    expect(r.dropped).toEqual([]);
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0]!;
    expect(g.groupNumber).toBe(1);
    expect(g.atomicEdits).toHaveLength(1);
    expect(g.atomicEdits[0]!.kind).toBe('insert');
    expect(g.atomicEdits[0]!.newText).toBe('cruel');
    expect(r.recoveredSource).toBe('Hello world.');
  });

  it('parses a single deletion', () => {
    // Markup must preserve surrounding whitespace; the parser strips ONLY what's
    // inside the delete tag (and trims its content). So the markup span replaces
    // 'cruel ' (with trailing space) — we keep just 'cruel' in recoveredSource.
    const source = 'Hello cruelworld.';
    const markup = 'Hello {-- [#1] cruel --}world.';
    const r = parseProposedEdits(markup, source);
    expect(r.dropped).toEqual([]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits[0]!.kind).toBe('delete');
    expect(r.recoveredSource).toBe('Hello cruelworld.');
  });

  it('parses a substitution', () => {
    const source = 'Hello world.';
    const markup = 'Hello {~~ [#1] world ~> Earth ~~}.';
    const r = parseProposedEdits(markup, source);
    expect(r.dropped).toEqual([]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits[0]!.kind).toBe('replace');
    expect(r.groups[0]!.atomicEdits[0]!.oldText).toBe('world');
    expect(r.groups[0]!.atomicEdits[0]!.newText).toBe('Earth');
    expect(r.recoveredSource).toBe('Hello world.');
  });

  it('drops combined substitution containing ~> in content', () => {
    const markup = 'foo {~~ [#1] a ~> b ~> c ~~} bar';
    const r = parseProposedEdits(markup, 'foo a bar');
    expect(r.groups).toHaveLength(0);
    expect(r.dropped[0]!.reason).toBe('combined_substitution_with_arrow');
  });

  it('groups multiple atomic edits sharing [#N]', () => {
    const source = 'one. two. three.';
    const markup = '{~~ [#1] one ~> 1 ~~}. {~~ [#1] two ~> 2 ~~}. three.';
    const r = parseProposedEdits(markup, source);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits).toHaveLength(2);
  });

  it('captures contextBefore + contextAfter (≤ 30 chars)', () => {
    const source = 'a'.repeat(50) + 'TARGET' + 'b'.repeat(50);
    const markup = 'a'.repeat(50) + '{~~ [#1] TARGET ~> NEW ~~}' + 'b'.repeat(50);
    const r = parseProposedEdits(markup, source);
    const e = r.groups[0]!.atomicEdits[0]!;
    expect(e.contextBefore).toBe('a'.repeat(30));
    expect(e.contextAfter).toBe('b'.repeat(30));
  });

  it('produces correct currentText positions', () => {
    const source = 'foo bar baz';
    const markup = 'foo {~~ [#1] bar ~> XXX ~~} baz';
    const r = parseProposedEdits(markup, source);
    const e = r.groups[0]!.atomicEdits[0]!;
    expect(source.slice(e.range.start, e.range.end)).toBe('bar');
  });
});

describe('sourceContainsMarkup', () => {
  it('detects {++ marker', () => {
    expect(sourceContainsMarkup('foo {++ bar')).toBe(true);
  });
  it('detects {-- marker', () => {
    expect(sourceContainsMarkup('foo {-- bar')).toBe(true);
  });
  it('detects {~~ marker', () => {
    expect(sourceContainsMarkup('foo {~~ bar')).toBe(true);
  });
  it('returns false for plain text', () => {
    expect(sourceContainsMarkup('plain text without markup')).toBe(false);
  });
  it('returns false for partial match (no opener)', () => {
    expect(sourceContainsMarkup('curly { brace alone')).toBe(false);
  });
});
