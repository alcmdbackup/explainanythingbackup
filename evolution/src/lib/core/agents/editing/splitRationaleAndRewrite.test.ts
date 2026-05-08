import { splitRationaleAndRewrite } from './splitRationaleAndRewrite';

describe('splitRationaleAndRewrite', () => {
  it('extracts rationale + rewrite from well-formed two-section response', () => {
    const r = splitRationaleAndRewrite(
      '## Rationale\n' +
      'Tightened the lede.\n\n' +
      '## Rewrite\n' +
      'New article body here.',
    );
    expect(r.parseFailed).toBe(false);
    expect(r.rationale).toBe('Tightened the lede.');
    expect(r.rewrite).toBe('New article body here.');
  });

  it('parseFailed=true when ## Rewrite header is missing', () => {
    const r = splitRationaleAndRewrite('Just some prose, no headers.');
    expect(r.parseFailed).toBe(true);
    expect(r.rewrite).toBe('Just some prose, no headers.');
    expect(r.rationale).toBe('');
  });

  it('strips an outer ```markdown fence wrap', () => {
    const r = splitRationaleAndRewrite(
      '```markdown\n## Rationale\nfoo\n## Rewrite\nbar\n```',
    );
    expect(r.parseFailed).toBe(false);
    expect(r.rationale).toBe('foo');
    expect(r.rewrite).toBe('bar');
  });

  it('strips stray <output>/<source> tags', () => {
    const r = splitRationaleAndRewrite(
      '<output>\n## Rationale\nx\n## Rewrite\ny\n</output>',
    );
    expect(r.parseFailed).toBe(false);
    expect(r.rationale).toBe('x');
    expect(r.rewrite).toBe('y');
  });

  it('handles missing rationale section gracefully (only rewrite present)', () => {
    const r = splitRationaleAndRewrite('## Rewrite\njust the rewrite');
    expect(r.parseFailed).toBe(false);
    expect(r.rationale).toBe('');
    expect(r.rewrite).toBe('just the rewrite');
  });

  it('treats LLM refusal text as parseFailed (no headers)', () => {
    const r = splitRationaleAndRewrite("I cannot help with that request.");
    expect(r.parseFailed).toBe(true);
    expect(r.rewrite).toBe('I cannot help with that request.');
  });
});
