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

// ========= AI Pipeline Fixtures =========

/**
 * Fixture for testing the deterministic AI suggestion pipeline steps
 */
export interface PipelineFixture {
  name: string;
  description: string;
  category: 'insertion' | 'deletion' | 'update' | 'mixed' | 'edge-case';
  originalMarkdown: string;
  editedMarkdown: string;
  expectedStep3Output: string; // CriticMarkup from RenderCriticMarkupFromMDAstDiff
  expectedStep4Output: string; // After preprocessCriticMarkup
  expectedDiffNodeCount: number;
  expectedDiffTypes: ('ins' | 'del' | 'update')[];
}

/**
 * Comprehensive fixtures for AI pipeline testing
 * 30 cases as specified in the testing plan
 */
export const AI_PIPELINE_FIXTURES: Record<string, Record<string, PipelineFixture>> = {
  // ========= Insertions (5 cases) =========
  insertions: {
    singleWord: {
      name: 'single-word-insertion',
      description: 'Insert a single word into existing text',
      category: 'insertion',
      originalMarkdown: 'The cat sat.',
      editedMarkdown: 'The black cat sat.',
      expectedStep3Output: 'The {++black ++}cat sat.',
      expectedStep4Output: 'The {++black ++}cat sat.',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    multiWord: {
      name: 'multi-word-insertion',
      description: 'Insert multiple words into existing text',
      category: 'insertion',
      originalMarkdown: 'Hello world.',
      editedMarkdown: 'Hello beautiful new world.',
      expectedStep3Output: 'Hello {++beautiful new ++}world.',
      expectedStep4Output: 'Hello {++beautiful new ++}world.',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    sentence: {
      name: 'sentence-insertion',
      description: 'Insert a full sentence',
      category: 'insertion',
      originalMarkdown: 'First.',
      editedMarkdown: 'First. Second.',
      expectedStep3Output: 'First.{++ Second.++}',
      expectedStep4Output: 'First.{++ Second.++}',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    paragraph: {
      name: 'paragraph-insertion',
      description: 'Insert a new paragraph',
      category: 'insertion',
      originalMarkdown: 'Para 1.',
      editedMarkdown: 'Para 1.\n\nPara 2.',
      expectedStep3Output: 'Para 1.\n\n{++Para 2.++}',
      expectedStep4Output: 'Para 1.\n\n{++Para 2.++}',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    withFormatting: {
      name: 'insertion-with-formatting',
      description: 'Insert formatted text',
      category: 'insertion',
      originalMarkdown: 'Text.',
      editedMarkdown: 'Text **bold**.',
      expectedStep3Output: 'Text{++ **bold**++}.',
      expectedStep4Output: 'Text{++ **bold**++}.',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
  },

  // ========= Deletions (3 cases) =========
  deletions: {
    singleWord: {
      name: 'single-word-deletion',
      description: 'Delete a single word from text',
      category: 'deletion',
      originalMarkdown: 'The black cat sat.',
      editedMarkdown: 'The cat sat.',
      expectedStep3Output: 'The {--black --}cat sat.',
      expectedStep4Output: 'The {--black --}cat sat.',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['del'],
    },
    sentence: {
      name: 'sentence-deletion',
      description: 'Delete a sentence',
      category: 'deletion',
      originalMarkdown: 'First. Second.',
      editedMarkdown: 'First.',
      expectedStep3Output: 'First.{-- Second.--}',
      expectedStep4Output: 'First.{-- Second.--}',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['del'],
    },
    paragraph: {
      name: 'paragraph-deletion',
      description: 'Delete a paragraph',
      category: 'deletion',
      originalMarkdown: 'Para 1.\n\nPara 2.',
      editedMarkdown: 'Para 1.',
      expectedStep3Output: 'Para 1.\n\n{--Para 2.--}',
      expectedStep4Output: 'Para 1.\n\n{--Para 2.--}',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['del'],
    },
  },

  // ========= Updates (3 cases) =========
  updates: {
    wordReplacement: {
      name: 'word-replacement',
      description: 'Replace one word with another',
      category: 'update',
      originalMarkdown: 'The cat sat.',
      editedMarkdown: 'The dog sat.',
      expectedStep3Output: 'The {--cat--}{++dog++} sat.',
      expectedStep4Output: 'The {--cat--}{++dog++} sat.',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
    sentenceRewrite: {
      name: 'sentence-rewrite',
      description: 'Rewrite a sentence significantly',
      category: 'update',
      originalMarkdown: 'It was good.',
      editedMarkdown: 'It was excellent.',
      expectedStep3Output: 'It was {--good.--}{++excellent.++}',
      expectedStep4Output: 'It was {--good.--}{++excellent.++}',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
    phraseUpdate: {
      name: 'phrase-update',
      description: 'Update a phrase within text',
      category: 'update',
      originalMarkdown: 'The quick brown fox.',
      editedMarkdown: 'The slow red fox.',
      expectedStep3Output: 'The {--quick brown--}{++slow red++} fox.',
      expectedStep4Output: 'The {--quick brown--}{++slow red++} fox.',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
  },

  // ========= Mixed (3 cases) =========
  mixed: {
    insertAndDelete: {
      name: 'insert-and-delete',
      description: 'Insert and delete in same document',
      category: 'mixed',
      originalMarkdown: 'Start middle end.',
      editedMarkdown: 'Start new end.',
      expectedStep3Output: 'Start {--middle--}{++new++} end.',
      expectedStep4Output: 'Start {--middle--}{++new++} end.',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
    multipleUpdates: {
      name: 'multiple-updates',
      description: 'Multiple word replacements',
      category: 'mixed',
      originalMarkdown: 'The big red ball.',
      editedMarkdown: 'The small blue ball.',
      expectedStep3Output: 'The {--big red--}{++small blue++} ball.',
      expectedStep4Output: 'The {--big red--}{++small blue++} ball.',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
    complexEdit: {
      name: 'complex-edit',
      description: 'Multiple changes across document',
      category: 'mixed',
      originalMarkdown: 'First line.\n\nSecond line.',
      editedMarkdown: 'First modified line.\n\nThird line.',
      expectedStep3Output: 'First {++modified ++}line.\n\n{--Second--}{++Third++} line.',
      expectedStep4Output: 'First {++modified ++}line.\n\n{--Second--}{++Third++} line.',
      expectedDiffNodeCount: 3,
      expectedDiffTypes: ['ins', 'del', 'ins'],
    },
  },

  // ========= Edge Cases (16 cases) =========
  edgeCases: {
    headingChanges: {
      name: 'heading-changes',
      description: 'Change heading level',
      category: 'edge-case',
      originalMarkdown: '# Title',
      editedMarkdown: '## Title',
      expectedStep3Output: '{--# Title--}\n\n{++## Title++}',
      expectedStep4Output: '{--# Title--}\n\n{++## Title++}',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
    listModifications: {
      name: 'list-modifications',
      description: 'Add item to list',
      category: 'edge-case',
      originalMarkdown: '- Item 1\n- Item 2',
      editedMarkdown: '- Item 1\n- Item 2\n- Item 3',
      expectedStep3Output: '- Item 1\n- Item 2{++\n- Item 3++}',
      expectedStep4Output: '- Item 1\n- Item 2{++<br>- Item 3++}',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    codeBlockEdits: {
      name: 'code-block-edits',
      description: 'Changes inside code blocks',
      category: 'edge-case',
      originalMarkdown: '```js\nconst x = 1;\n```',
      editedMarkdown: '```js\nconst x = 2;\n```',
      expectedStep3Output: '{--```js\nconst x = 1;\n```--}\n\n{++```js\nconst x = 2;\n```++}',
      expectedStep4Output: '{--```js<br>const x = 1;<br>```--}\n\n{++```js<br>const x = 2;<br>```++}',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
    nestedFormatting: {
      name: 'nested-formatting',
      description: 'Nested bold and italic',
      category: 'edge-case',
      originalMarkdown: 'Plain text.',
      editedMarkdown: '**bold** and *italic* text.',
      expectedStep3Output: '{--Plain--}{++**bold** and *italic*++} text.',
      expectedStep4Output: '{--Plain--}{++**bold** and *italic*++} text.',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
    unicodeContent: {
      name: 'unicode-content',
      description: 'Emoji and unicode in diffs',
      category: 'edge-case',
      originalMarkdown: 'Hello',
      editedMarkdown: 'Hello 🎉',
      expectedStep3Output: 'Hello{++ 🎉++}',
      expectedStep4Output: 'Hello{++ 🎉++}',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    linkInDiff: {
      name: 'link-in-diff',
      description: 'Link within diff markup',
      category: 'edge-case',
      originalMarkdown: 'Text here.',
      editedMarkdown: 'Text [link](https://example.com) here.',
      expectedStep3Output: 'Text {++[link](https://example.com) ++}here.',
      expectedStep4Output: 'Text {++[link](https://example.com) ++}here.',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    imageInDiff: {
      name: 'image-in-diff',
      description: 'Image within diff markup',
      category: 'edge-case',
      originalMarkdown: 'Before.',
      editedMarkdown: 'Before. ![alt](img.png)',
      expectedStep3Output: 'Before.{++ ![alt](img.png)++}',
      expectedStep4Output: 'Before.{++ ![alt](img.png)++}',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    adjacentDiffs: {
      name: 'adjacent-diffs',
      description: 'Insertion immediately after deletion',
      category: 'edge-case',
      originalMarkdown: 'old word.',
      editedMarkdown: 'new word.',
      expectedStep3Output: '{--old--}{++new++} word.',
      expectedStep4Output: '{--old--}{++new++} word.',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
    whitespaceOnly: {
      name: 'whitespace-only',
      description: 'Only whitespace changes',
      category: 'edge-case',
      originalMarkdown: 'Hello  world.',
      editedMarkdown: 'Hello world.',
      expectedStep3Output: 'Hello {-- ++}world.',
      expectedStep4Output: 'Hello {-- ++}world.',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['del'],
    },
    escapedChars: {
      name: 'escaped-chars',
      description: 'Backticks and brackets in diff',
      category: 'edge-case',
      originalMarkdown: 'Use code.',
      editedMarkdown: 'Use `code` here.',
      expectedStep3Output: 'Use {++`++}code{++` here++}.',
      expectedStep4Output: 'Use {++`++}code{++` here++}.',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['ins', 'ins'],
    },
    emptyParagraph: {
      name: 'empty-paragraph',
      description: 'Add empty paragraphs',
      category: 'edge-case',
      originalMarkdown: 'One.\n\nTwo.',
      editedMarkdown: 'One.\n\n\n\nTwo.',
      expectedStep3Output: 'One.\n\n{++\n\n++}Two.',
      expectedStep4Output: 'One.\n\n{++<br><br>++}Two.',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    inlineCodeDiff: {
      name: 'inline-code-diff',
      description: 'Inline code in diff',
      category: 'edge-case',
      originalMarkdown: 'Run command.',
      editedMarkdown: 'Run `npm install` command.',
      expectedStep3Output: 'Run {++`npm install` ++}command.',
      expectedStep4Output: 'Run {++`npm install` ++}command.',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    longContent: {
      name: 'long-content',
      description: 'Stress test with long paragraph',
      category: 'edge-case',
      originalMarkdown: 'A '.repeat(100) + 'end.',
      editedMarkdown: 'A '.repeat(100) + 'modified end.',
      expectedStep3Output: 'A '.repeat(100) + '{++modified ++}end.',
      expectedStep4Output: 'A '.repeat(100) + '{++modified ++}end.',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    tableRowAdd: {
      name: 'table-row-add',
      description: 'Add row to markdown table',
      category: 'edge-case',
      originalMarkdown: '| A | B |\n|---|---|\n| 1 | 2 |',
      editedMarkdown: '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |',
      expectedStep3Output: '| A | B |\n|---|---|\n| 1 | 2 |{++\n| 3 | 4 |++}',
      expectedStep4Output: '| A | B |\n|---|---|\n| 1 | 2 |{++<br>| 3 | 4 |++}',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
    tableCellEdit: {
      name: 'table-cell-edit',
      description: 'Modify cell content in table',
      category: 'edge-case',
      originalMarkdown: '| A | B |\n|---|---|\n| 1 | 2 |',
      editedMarkdown: '| A | B |\n|---|---|\n| X | 2 |',
      expectedStep3Output: '| A | B |\n|---|---|\n| {--1--}{++X++} | 2 |',
      expectedStep4Output: '| A | B |\n|---|---|\n| {--1--}{++X++} | 2 |',
      expectedDiffNodeCount: 2,
      expectedDiffTypes: ['del', 'ins'],
    },
    multilineInSingleDiff: {
      name: 'multiline-in-single-diff',
      description: 'Multiple lines in single diff block',
      category: 'edge-case',
      originalMarkdown: 'Start.',
      editedMarkdown: 'Start.\n\nLine 1\nLine 2',
      expectedStep3Output: 'Start.\n\n{++Line 1\nLine 2++}',
      expectedStep4Output: 'Start.\n\n{++Line 1<br>Line 2++}',
      expectedDiffNodeCount: 1,
      expectedDiffTypes: ['ins'],
    },
  },
};

/**
 * Get all pipeline fixtures as a flat array for describe.each() usage
 */
export function getAllPipelineFixtures(): PipelineFixture[] {
  return Object.values(AI_PIPELINE_FIXTURES).flatMap((category) =>
    Object.values(category)
  );
}

/**
 * Get pipeline fixtures by category
 */
export function getPipelineFixturesByCategory(
  category: PipelineFixture['category']
): PipelineFixture[] {
  const categoryMap: Record<string, keyof typeof AI_PIPELINE_FIXTURES> = {
    insertion: 'insertions',
    deletion: 'deletions',
    update: 'updates',
    mixed: 'mixed',
    'edge-case': 'edgeCases',
  };
  const key = categoryMap[category];
  if (!key) return [];
  return Object.values(AI_PIPELINE_FIXTURES[key]);
}
