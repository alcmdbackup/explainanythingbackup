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

describe('parseProposedEdits — adjacency-based auto-grouping', () => {
  it('parses a single unnumbered insertion → auto group 1', () => {
    const source = 'Hello world.';
    const markup = 'Hello {++ cruel ++}world.';
    const r = parseProposedEdits(markup, source);
    expect(r.dropped).toEqual([]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.groupNumber).toBe(1);
    expect(r.groups[0]!.atomicEdits[0]!.kind).toBe('insert');
    expect(r.groups[0]!.atomicEdits[0]!.newText).toBe('cruel');
  });

  it('two adjacent unnumbered inserts (single space between) → one group of 2', () => {
    const source = 'foo bar';
    const markup = '{++ A ++} {++ B ++}foo bar';
    const r = parseProposedEdits(markup, source);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits).toHaveLength(2);
  });

  it('two unnumbered inserts separated by prose → two groups', () => {
    const source = 'foo  bar';
    const markup = '{++ A ++}foo {++ B ++}bar';
    const r = parseProposedEdits(markup, source);
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0]!.groupNumber).toBe(1);
    expect(r.groups[1]!.groupNumber).toBe(2);
  });

  it('paragraph break between unnumbered spans → two groups', () => {
    const source = 'a\n\nb';
    const markup = '{++ A ++}\n\n{++ B ++}a\n\nb';
    const r = parseProposedEdits(markup, source);
    expect(r.groups).toHaveLength(2);
  });

  it('single newline between unnumbered spans → one group', () => {
    const source = 'a\nb';
    const markup = '{++ A ++}\n{++ B ++}a\nb';
    const r = parseProposedEdits(markup, source);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits).toHaveLength(2);
  });

  it('standard CriticMarkup paired form `{~~ X ~~}{++ Y ++}` → one merged replace edit', () => {
    const source = 'old text here';
    const markup = '{~~ old ~~}{++ new ++} text here';
    const r = parseProposedEdits(markup, source);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits).toHaveLength(1);
    const e = r.groups[0]!.atomicEdits[0]!;
    expect(e.kind).toBe('replace');
    expect(e.oldText).toBe('old');
    expect(e.newText).toBe('new');
  });

  it('paired delete-then-insert with adjacency (no number) → merges into replace', () => {
    const source = 'old text here';
    const markup = '{-- old --}{++ new ++} text here';
    const r = parseProposedEdits(markup, source);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits[0]!.kind).toBe('replace');
    expect(r.groups[0]!.atomicEdits[0]!.oldText).toBe('old');
    expect(r.groups[0]!.atomicEdits[0]!.newText).toBe('new');
  });

  it('explicit [#N] adjacent to unnumbered → separate groups (explicit creates boundary)', () => {
    const source = 'foo bar baz';
    const markup = '{++ [#7] A ++} {++ B ++}foo bar baz';
    const r = parseProposedEdits(markup, source);
    expect(r.groups).toHaveLength(2);
    // Explicit number honored; auto-numbering picks max(7) + 1 = 8 for the unnumbered.
    expect(r.groups.map((g) => g.groupNumber).sort((a, b) => a - b)).toEqual([7, 8]);
  });

  it('same explicit [#N] across non-adjacent spans → still merged into one group', () => {
    const source = 'one. two. three.';
    const markup = '{~~ [#1] one ~> 1 ~~}. plain text {~~ [#1] two ~> 2 ~~}. three.';
    const r = parseProposedEdits(markup, source);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits).toHaveLength(2);
  });

  it('three unnumbered spans, all adjacent → one group of 3', () => {
    const markup = '{++ A ++} {++ B ++} {++ C ++}rest';
    const r = parseProposedEdits(markup, 'rest');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits).toHaveLength(3);
  });

  it('recoveredSource is byte-equal to source for unnumbered paired-form substitution', () => {
    const source = 'Hello old text.';
    const markup = 'Hello {~~ old ~~}{++ new ++} text.';
    const r = parseProposedEdits(markup, source);
    expect(r.recoveredSource).toBe(source);
  });

  it('cross-block matching is prevented by negative lookahead — `{~~ X ~~}{~~ Y ~> Z ~~}` parses as two edits', () => {
    const source = 'one two';
    const markup = '{~~ X ~~}{~~ Y ~> Z ~~} stuff';
    const r = parseProposedEdits(markup, source);
    // One delete (`{~~ X ~~}`) + one replace (`{~~ Y ~> Z ~~}`).
    // They are adjacent (no whitespace between) → same auto-group.
    // BUT the merge logic only merges delete-then-insert pairs, not delete-then-replace.
    // So we expect 1 group with 2 atomic edits (delete + replace, both unnumbered, adjacent).
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits).toHaveLength(2);
    const kinds = r.groups[0]!.atomicEdits.map((e) => e.kind).sort();
    expect(kinds).toEqual(['delete', 'replace']);
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

// Phase 2 — Mode A parser hardening
describe('parseProposedEdits — Mode A hardening (Phase 2)', () => {
  it('strips a stray <output>…</output> wrapper before parsing', () => {
    const source = 'Hello world.';
    const wrapped = `<output>\nHello{++!++} world.\n</output>`;
    const r = parseProposedEdits(wrapped, source);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.atomicEdits[0]!.kind).toBe('insert');
  });

  it('strips an outer ```markdown fence wrap', () => {
    const source = 'foo bar';
    const wrapped = '```markdown\nfoo{++ baz++} bar\n```';
    const r = parseProposedEdits(wrapped, source);
    expect(r.groups.length).toBeGreaterThan(0);
  });

  it('tolerates whitespace inside marker tokens ({ ++, ++ }, ~~ })', () => {
    const source = 'old text';
    // Pathological-but-plausible weak-model quirk: whitespace inside the marker token.
    const markup = '{ ++new ++} old text';
    const r = parseProposedEdits(markup, source);
    expect(r.groups.length).toBeGreaterThanOrEqual(1);
    expect(r.groups[0]!.atomicEdits[0]!.kind).toBe('insert');
  });

  it('tolerates whitespace inside substitution markers', () => {
    const source = 'old text';
    const markup = '{ ~~old~>new~~ } text';
    const r = parseProposedEdits(markup, source);
    expect(r.groups.length).toBeGreaterThanOrEqual(1);
    expect(r.groups[0]!.atomicEdits[0]!.kind).toBe('replace');
  });

  it('strips a leading <source>…</source> echo block before parsing', () => {
    // Observed in production (gemini-2.5-flash-lite): the proposer echoes
    // the entire <source> block from the user prompt, then emits its actual
    // output, then closes with </output>. Without this strip, recoveredSource
    // is ~2× parent length and the structural_rewrite gate fires.
    const source = 'Hello world.';
    const echoed = `<source>\n${source}\n</source>\nHello{++ brave++} world.\n</output>`;
    const r = parseProposedEdits(echoed, source);
    expect(r.groups.length).toBeGreaterThanOrEqual(1);
    expect(r.groups[0]!.atomicEdits[0]!.kind).toBe('insert');
    // recoveredSource should match the source — the echo is gone.
    expect(r.recoveredSource).toContain('Hello world.');
    expect(r.recoveredSource).not.toContain('<source>');
    expect(r.recoveredSource).not.toContain('</source>');
    expect(r.recoveredSource).not.toContain('</output>');
  });

  it('strips a trailing </output> tag without an opening <output>', () => {
    const source = 'foo bar';
    const wrapped = 'foo{++ baz++} bar\n</output>';
    const r = parseProposedEdits(wrapped, source);
    expect(r.groups.length).toBeGreaterThanOrEqual(1);
    expect(r.recoveredSource).not.toContain('</output>');
  });
});
