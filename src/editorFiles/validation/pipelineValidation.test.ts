/**
 * Tests for pipelineValidation.ts
 * Tests validation functions for the 4-step AI suggestions pipeline
 */

import {
  validateStep2Output,
  validateCriticMarkup,
  validateEditAnchors,
  extractBalancedCriticMarkup,
  parseUpdateContent,
  isInsideCodeBlock,
  escapeCriticMarkupContent,
  unescapeCriticMarkupContent,
  validateNonEmptyContent,
} from './pipelineValidation';

// ============= validateStep2Output Tests (B2) =============

describe('validateStep2Output - Content Preservation', () => {
  it('should pass for similar length content', () => {
    const original = 'This is the original content with some text.';
    const edited = 'This is the edited content with some text.';

    const result = validateStep2Output(original, edited);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('should fail for content that is too short', () => {
    const original = 'This is a long piece of original content with many words.';
    const edited = 'Short.';

    const result = validateStep2Output(original, edited);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('too short'))).toBe(true);
    expect(result.severity).toBe('error');
  });

  it('should fail for content that is too long', () => {
    const original = 'Short.';
    const edited = 'This is now a very long piece of content that is much longer than the original.';

    const result = validateStep2Output(original, edited);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('too long'))).toBe(true);
  });

  it('should detect unexpanded markers', () => {
    const original = 'Original content here.';
    const edited = 'Some content ... existing text ... more content.';

    const result = validateStep2Output(original, edited);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('unexpanded markers'))).toBe(true);
    expect(result.severity).toBe('error');
  });

  it('should detect lost headings', () => {
    const original = '# Heading 1\n## Heading 2\n### Heading 3\nContent here.';
    const edited = 'Content here with no headings.';

    const result = validateStep2Output(original, edited);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('Lost headings'))).toBe(true);
  });

  it('should pass when headings are preserved', () => {
    const original = '# Heading 1\n## Heading 2\nContent here.';
    const edited = '# Heading 1\n## Heading 2\nEdited content here.';

    const result = validateStep2Output(original, edited);

    expect(result.valid).toBe(true);
  });

  it('should handle empty content', () => {
    const result = validateStep2Output('', 'some content');

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('empty'))).toBe(true);
  });
});

// ============= validateCriticMarkup Tests (B3) =============

describe('validateCriticMarkup - Syntax Validation', () => {
  it('should pass for balanced insertions', () => {
    const content = 'Text with {++inserted++} content.';

    const result = validateCriticMarkup(content);

    expect(result.valid).toBe(true);
  });

  it('should pass for balanced deletions', () => {
    const content = 'Text with {--deleted--} content.';

    const result = validateCriticMarkup(content);

    expect(result.valid).toBe(true);
  });

  it('should pass for balanced substitutions', () => {
    const content = 'Text with {~~old~>new~~} content.';

    const result = validateCriticMarkup(content);

    expect(result.valid).toBe(true);
  });

  it('should fail for unbalanced insertions', () => {
    const content = 'Text with {++inserted content.';

    const result = validateCriticMarkup(content);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('Unbalanced insertions'))).toBe(true);
  });

  it('should fail for unbalanced deletions', () => {
    const content = 'Text with deleted--} content.';

    const result = validateCriticMarkup(content);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('Unbalanced deletions'))).toBe(true);
  });

  it('should fail for substitution without separator', () => {
    const content = 'Text with {~~old new~~} content.';

    const result = validateCriticMarkup(content);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('Missing ~> separators'))).toBe(true);
  });

  it('should pass for multiple balanced markers', () => {
    const content = '{++First++} and {--second--} and {~~old~>new~~}.';

    const result = validateCriticMarkup(content);

    expect(result.valid).toBe(true);
  });

  it('should handle empty content', () => {
    const result = validateCriticMarkup('');

    expect(result.valid).toBe(true);
  });
});

// ============= validateEditAnchors Tests (P) =============

describe('validateEditAnchors - Anchor Validation', () => {
  it('should pass when anchors exist in original', () => {
    const original = 'The sky is blue. Cats are mammals. Dogs are loyal.';
    const edits = ['The sky is blue. Cats are fascinating creatures. Dogs are loyal.'];

    const result = validateEditAnchors(edits, original);

    expect(result.valid).toBe(true);
  });

  it('should warn when no anchors found', () => {
    const original = 'The sky is blue. Cats are mammals.';
    const edits = ['Completely different content here. With new sentences.'];

    const result = validateEditAnchors(edits, original);

    expect(result.severity).toBe('warning');
  });

  it('should skip marker strings', () => {
    const original = 'Original content here.';
    const edits = ['... existing text ...'];

    const result = validateEditAnchors(edits, original);

    expect(result.valid).toBe(true);
  });

  it('should handle empty edits', () => {
    const result = validateEditAnchors([], 'Original content.');

    expect(result.valid).toBe(true);
  });
});

// ============= extractBalancedCriticMarkup Tests (H) =============

describe('extractBalancedCriticMarkup - Stack Parser', () => {
  it('should extract simple insertion', () => {
    const input = 'Text {++inserted++} more';
    const result = extractBalancedCriticMarkup(input, 5);

    expect(result).not.toBeNull();
    expect(result!.content).toBe('inserted');
    expect(result!.marker).toBe('++');
    expect(result!.endIndex).toBe(19); // 'Text {++inserted++}' ends at position 19
  });

  it('should handle nested braces', () => {
    const input = 'Text {++code with {curly}++} more';
    const result = extractBalancedCriticMarkup(input, 5);

    expect(result).not.toBeNull();
    expect(result!.content).toBe('code with {curly}');
    expect(result!.marker).toBe('++');
  });

  it('should return null for invalid start', () => {
    const input = 'Text without markup';
    const result = extractBalancedCriticMarkup(input, 0);

    expect(result).toBeNull();
  });

  it('should return null for unbalanced markup', () => {
    const input = 'Text {++unclosed';
    const result = extractBalancedCriticMarkup(input, 5);

    expect(result).toBeNull();
  });

  it('should handle deletion markers', () => {
    const input = 'Text {--deleted--} more';
    const result = extractBalancedCriticMarkup(input, 5);

    expect(result).not.toBeNull();
    expect(result!.content).toBe('deleted');
    expect(result!.marker).toBe('--');
  });

  it('should handle substitution markers', () => {
    const input = 'Text {~~old~>new~~} more';
    const result = extractBalancedCriticMarkup(input, 5);

    expect(result).not.toBeNull();
    expect(result!.content).toBe('old~>new');
    expect(result!.marker).toBe('~~');
  });
});

// ============= parseUpdateContent Tests (I) =============

describe('parseUpdateContent - First Separator Only', () => {
  it('should parse simple update', () => {
    const result = parseUpdateContent('old~>new');

    expect(result).not.toBeNull();
    expect(result!.before).toBe('old');
    expect(result!.after).toBe('new');
  });

  it('should handle content with multiple ~> by using first only', () => {
    const result = parseUpdateContent('before~>after with ~> inside');

    expect(result).not.toBeNull();
    expect(result!.before).toBe('before');
    expect(result!.after).toBe('after with ~> inside');
  });

  it('should return null for content without separator', () => {
    const result = parseUpdateContent('no separator here');

    expect(result).toBeNull();
  });

  it('should handle empty before', () => {
    const result = parseUpdateContent('~>after');

    expect(result).not.toBeNull();
    expect(result!.before).toBe('');
    expect(result!.after).toBe('after');
  });

  it('should handle empty after', () => {
    const result = parseUpdateContent('before~>');

    expect(result).not.toBeNull();
    expect(result!.before).toBe('before');
    expect(result!.after).toBe('');
  });
});

// ============= isInsideCodeBlock Tests (M) =============

describe('isInsideCodeBlock - Code Block Detection', () => {
  it('should return false outside code blocks', () => {
    const content = 'Normal text here';
    const result = isInsideCodeBlock(content, 5);

    expect(result).toBe(false);
  });

  it('should return true inside code block', () => {
    const content = '```\ncode here\n```';
    const result = isInsideCodeBlock(content, 8);

    expect(result).toBe(true);
  });

  it('should return false after code block', () => {
    const content = '```\ncode\n```\noutside';
    const result = isInsideCodeBlock(content, 18);

    expect(result).toBe(false);
  });

  it('should handle multiple code blocks', () => {
    const content = '```\nblock1\n```\ntext\n```\nblock2\n```';

    // Inside first block
    expect(isInsideCodeBlock(content, 6)).toBe(true);
    // Between blocks
    expect(isInsideCodeBlock(content, 16)).toBe(false);
    // Inside second block
    expect(isInsideCodeBlock(content, 24)).toBe(true);
  });
});

// ============= escapeCriticMarkupContent Tests (C) =============

describe('escapeCriticMarkupContent - Character Escaping', () => {
  it('should escape insertion markers', () => {
    const result = escapeCriticMarkupContent('Text with {++ and ++}');

    expect(result).toBe('Text with \\{++ and ++\\}');
  });

  it('should escape deletion markers', () => {
    const result = escapeCriticMarkupContent('Text with {-- and --}');

    expect(result).toBe('Text with \\{-- and --\\}');
  });

  it('should escape substitution markers', () => {
    const result = escapeCriticMarkupContent('Text with {~~ and ~~}');

    expect(result).toBe('Text with \\{~~ and ~~\\}');
  });

  it('should escape separator', () => {
    const result = escapeCriticMarkupContent('old~>new');

    expect(result).toBe('old\\~>new');
  });

  it('should not modify normal text', () => {
    const result = escapeCriticMarkupContent('Normal text here');

    expect(result).toBe('Normal text here');
  });
});

describe('unescapeCriticMarkupContent - Character Unescaping', () => {
  it('should unescape all markers', () => {
    const escaped = '\\{++ text ++\\} and \\{-- del --\\} and old\\~>new';
    const result = unescapeCriticMarkupContent(escaped);

    expect(result).toBe('{++ text ++} and {-- del --} and old~>new');
  });

  it('should be inverse of escape', () => {
    const original = 'Text with {++ and ++} and ~> separator';
    const escaped = escapeCriticMarkupContent(original);
    const unescaped = unescapeCriticMarkupContent(escaped);

    expect(unescaped).toBe(original);
  });
});

// ============= validateNonEmptyContent Tests (N) =============

describe('validateNonEmptyContent - Empty Content Validation', () => {
  it('should fail for empty string', () => {
    const result = validateNonEmptyContent('');

    expect(result.valid).toBe(false);
    expect(result.severity).toBe('error');
  });

  it('should fail for whitespace only', () => {
    const result = validateNonEmptyContent('   \n\t  ');

    expect(result.valid).toBe(false);
  });

  it('should pass for content with text', () => {
    const result = validateNonEmptyContent('Some content');

    expect(result.valid).toBe(true);
  });
});
