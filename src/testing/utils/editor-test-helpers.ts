/**
 * Test helpers for Editor & Lexical System testing (Phase 7)
 * Provides mock factories for markdown AST nodes, diff operations, and fixtures
 */

// ========= Mock AST Node Factories =========

export interface MdastNode {
  type: string;
  value?: string;
  depth?: number;
  url?: string;
  title?: string | null;
  alt?: string | null;
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean | null;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  align?: (string | null)[] | null;
  children?: MdastNode[];
  [key: string]: any;
}

/**
 * Create a mock text node
 */
export const createMockTextNode = (value: string): MdastNode => ({
  type: 'text',
  value,
});

/**
 * Create a mock paragraph node
 */
export const createMockParagraph = (children: MdastNode[] | string): MdastNode => {
  if (typeof children === 'string') {
    return {
      type: 'paragraph',
      children: [createMockTextNode(children)],
    };
  }
  return {
    type: 'paragraph',
    children,
  };
};

/**
 * Create a mock heading node
 */
export const createMockHeading = (
  depth: number,
  children: MdastNode[] | string
): MdastNode => {
  if (typeof children === 'string') {
    return {
      type: 'heading',
      depth,
      children: [createMockTextNode(children)],
    };
  }
  return {
    type: 'heading',
    depth,
    children,
  };
};

/**
 * Create a mock code block node
 */
export const createMockCodeBlock = (
  value: string,
  lang: string | null = null,
  meta: string | null = null
): MdastNode => ({
  type: 'code',
  lang,
  meta,
  value,
});

/**
 * Create a mock list node
 */
export const createMockList = (
  children: MdastNode[],
  ordered = false,
  start: number | null = null
): MdastNode => ({
  type: 'list',
  ordered,
  start,
  children,
});

/**
 * Create a mock list item node
 */
export const createMockListItem = (
  children: MdastNode[] | string,
  checked: boolean | null = null
): MdastNode => {
  if (typeof children === 'string') {
    return {
      type: 'listItem',
      checked,
      children: [createMockParagraph(children)],
    };
  }
  return {
    type: 'listItem',
    checked,
    children,
  };
};

/**
 * Create a mock link node
 */
export const createMockLink = (
  url: string,
  children: MdastNode[] | string,
  title: string | null = null
): MdastNode => {
  if (typeof children === 'string') {
    return {
      type: 'link',
      url,
      title,
      children: [createMockTextNode(children)],
    };
  }
  return {
    type: 'link',
    url,
    title,
    children,
  };
};

/**
 * Create a mock emphasis node
 */
export const createMockEmphasis = (children: MdastNode[] | string): MdastNode => {
  if (typeof children === 'string') {
    return {
      type: 'emphasis',
      children: [createMockTextNode(children)],
    };
  }
  return {
    type: 'emphasis',
    children,
  };
};

/**
 * Create a mock strong node
 */
export const createMockStrong = (children: MdastNode[] | string): MdastNode => {
  if (typeof children === 'string') {
    return {
      type: 'strong',
      children: [createMockTextNode(children)],
    };
  }
  return {
    type: 'strong',
    children,
  };
};

/**
 * Create a mock inline code node
 */
export const createMockInlineCode = (value: string): MdastNode => ({
  type: 'inlineCode',
  value,
});

/**
 * Create a mock blockquote node
 */
export const createMockBlockquote = (children: MdastNode[]): MdastNode => ({
  type: 'blockquote',
  children,
});

/**
 * Create a mock table node
 */
export const createMockTable = (
  rows: MdastNode[],
  align: string[] | null = null
): MdastNode => ({
  type: 'table',
  align,
  children: rows,
});

/**
 * Create a mock table row node
 */
export const createMockTableRow = (cells: MdastNode[]): MdastNode => ({
  type: 'tableRow',
  children: cells,
});

/**
 * Create a mock table cell node
 */
export const createMockTableCell = (children: MdastNode[] | string): MdastNode => {
  if (typeof children === 'string') {
    return {
      type: 'tableCell',
      children: [createMockTextNode(children)],
    };
  }
  return {
    type: 'tableCell',
    children,
  };
};

/**
 * Create a mock root node
 */
export const createMockRoot = (children: MdastNode[]): MdastNode => ({
  type: 'root',
  children,
});

/**
 * Create a mock image node
 */
export const createMockImage = (
  url: string,
  alt: string | null = null,
  title: string | null = null
): MdastNode => ({
  type: 'image',
  url,
  alt,
  title,
});

// ========= Test Fixtures =========

/**
 * Common markdown text samples for testing
 */
export const MARKDOWN_FIXTURES = {
  // Simple sentences
  simple: {
    short: 'Hello world.',
    medium: 'This is a test sentence.',
    long: 'This is a longer test sentence with more words to test similarity algorithms.',
  },

  // Sentences with URLs
  withUrls: {
    single: 'Check out [this link](https://example.com?foo=bar&baz=qux) for more info.',
    multiple:
      'Visit [site one](https://example.com) and [site two](https://test.com?query=value).',
  },

  // Multiple sentences
  multiSentence: {
    two: 'First sentence here. Second sentence here.',
    three: 'First sentence. Second sentence. Third sentence.',
    withAbbrev: 'Dr. Smith visited Mt. Everest. It was amazing.',
  },

  // Paragraphs with different similarity levels
  similarPairs: {
    veryHigh: {
      before: 'The quick brown fox jumps over the lazy dog.',
      after: 'The quick brown fox jumps over the sleepy dog.',
    },
    high: {
      before: 'The weather is nice today.',
      after: 'The weather is beautiful today.',
    },
    medium: {
      before: 'This is a test of the emergency broadcast system.',
      after: 'This is a test of the notification system.',
    },
    low: {
      before: 'The cat sat on the mat.',
      after: 'The dog ran in the park.',
    },
    veryLow: {
      before: 'Completely different content here.',
      after: 'Totally unrelated text over there.',
    },
  },

  // Edge cases
  edgeCases: {
    empty: '',
    singleWord: 'Hello',
    whitespace: '   \n\t  ',
    specialChars: 'Test with special chars: @#$%^&*()',
    multiline: 'Line one\nLine two\nLine three',
  },

  // Code and formatting
  formatted: {
    withBold: 'This is **bold text** in a sentence.',
    withItalic: 'This is *italic text* in a sentence.',
    withCode: 'This is `inline code` in a sentence.',
    mixed: 'This has **bold**, *italic*, and `code` formatting.',
  },
};

// ========= CriticMarkup Assertion Helpers =========

/**
 * Check if a string contains CriticMarkup insertion
 */
export const hasCriticInsertion = (text: string): boolean => {
  return /\{\+\+[\s\S]+?\+\+\}/.test(text);
};

/**
 * Check if a string contains CriticMarkup deletion
 */
export const hasCriticDeletion = (text: string): boolean => {
  return /\{--[\s\S]+?--\}/.test(text);
};

/**
 * Check if a string contains CriticMarkup substitution
 */
export const hasCriticSubstitution = (text: string): boolean => {
  return /\{~~[\s\S]+?~>[\s\S]+?~~\}/.test(text);
};

/**
 * Extract text from CriticMarkup insertions
 */
export const extractCriticInsertions = (text: string): string[] => {
  const matches = text.match(/\{\+\+([\s\S]+?)\+\+\}/g);
  if (!matches) return [];
  return matches.map((m) => m.replace(/\{\+\+|\+\+\}/g, ''));
};

/**
 * Extract text from CriticMarkup deletions
 */
export const extractCriticDeletions = (text: string): string[] => {
  const matches = text.match(/\{--([\s\S]+?)--\}/g);
  if (!matches) return [];
  return matches.map((m) => m.replace(/\{--|--\}/g, ''));
};

/**
 * Extract text from CriticMarkup substitutions
 */
export const extractCriticSubstitutions = (text: string): Array<{ before: string; after: string }> => {
  const matches = text.match(/\{~~([\s\S]+?)~>([\s\S]+?)~~\}/g);
  if (!matches) return [];
  return matches.map((m) => {
    const parts = m.match(/\{~~([\s\S]+?)~>([\s\S]+?)~~\}/);
    return {
      before: parts?.[1] || '',
      after: parts?.[2] || '',
    };
  });
};

/**
 * Count total CriticMarkup operations in text
 */
export const countCriticOperations = (text: string): number => {
  const insertions = (text.match(/\{\+\+[\s\S]+?\+\+\}/g) || []).length;
  const deletions = (text.match(/\{--[\s\S]+?--\}/g) || []).length;
  const substitutions = (text.match(/\{~~[\s\S]+?~>[\s\S]+?~~\}/g) || []).length;
  return insertions + deletions + substitutions;
};

/**
 * Remove all CriticMarkup from text (keep only final version)
 */
export const removeCriticMarkup = (text: string): string => {
  return text
    .replace(/\{--.*?--\}/g, '') // Remove deletions
    .replace(/\{\+\+(.*?)\+\+\}/g, '$1') // Keep insertions
    .replace(/\{~~.*?~>(.*?)~~\}/g, '$1'); // Keep substitution "after" text
};

// ========= Diff Library Mock Helpers =========

/**
 * Create a mock diff part (for mocking 'diff' library)
 */
export const createMockDiffPart = (
  value: string,
  added = false,
  removed = false
): { value: string; added?: boolean; removed?: boolean } => ({
  value,
  ...(added && { added }),
  ...(removed && { removed }),
});

/**
 * Create mock diff results
 */
export const createMockWordDiff = (
  parts: Array<{ value: string; added?: boolean; removed?: boolean }>
) => parts;

// ========= Similarity Calculation Helpers =========

/**
 * Calculate simple word-based similarity (for test assertions)
 * Returns 0 (identical) to 1 (completely different)
 */
export const calculateSimpleSimilarity = (a: string, b: string): number => {
  if (a === b) return 0;

  const aWords = a.split(/\s+/).filter((w) => w.length > 0);
  const bWords = b.split(/\s+/).filter((w) => w.length > 0);

  const commonWords = aWords.filter((word) => bWords.includes(word));
  const maxLength = Math.max(aWords.length, bWords.length);

  if (maxLength === 0) return 0;

  const similarity = commonWords.length / maxLength;
  return 1 - similarity; // Convert to diff ratio
};
