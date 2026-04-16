// Tests for user free-text sanitization before writing to markdown.
describe('sanitize user text for markdown', () => {
  function sanitizeForMarkdown(text: string): string {
    // If text contains a line that is just `---` (potential frontmatter delimiter),
    // wrap the entire block in a ```text fence.
    if (/^---\s*$/m.test(text)) {
      // Escape any existing closing fences inside user text
      const escaped = text.replace(/```/g, '` ` `');
      return '```text\n' + escaped + '\n```';
    }
    return text;
  }

  it('passes through normal text unchanged', () => {
    const input = 'This is a normal project description.';
    expect(sanitizeForMarkdown(input)).toBe(input);
  });

  it('wraps text containing --- in a code fence', () => {
    const input = 'Some text\n---\nMore text';
    const result = sanitizeForMarkdown(input);
    expect(result).toContain('```text');
    expect(result).toContain('Some text');
    expect(result).toContain('More text');
  });

  it('escapes backtick fences inside user text when wrapping', () => {
    const input = 'Example:\n```js\nconsole.log("hi")\n```\n---\nEnd';
    const result = sanitizeForMarkdown(input);
    expect(result.startsWith('```text')).toBe(true);
    // Inner ``` should be escaped
    expect(result).not.toMatch(/```js/);
  });

  it('handles $VAR-like content (no shell expansion since we use Write tool)', () => {
    const input = 'Set $DATABASE_URL to the connection string';
    // No transformation needed — Write tool doesn't shell-expand
    expect(sanitizeForMarkdown(input)).toBe(input);
  });

  it('handles backticks in normal text (no --- present)', () => {
    const input = 'Use `npm install` to set up';
    expect(sanitizeForMarkdown(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(sanitizeForMarkdown('')).toBe('');
  });

  it('handles text that is just ---', () => {
    const result = sanitizeForMarkdown('---');
    expect(result).toContain('```text');
  });
});
