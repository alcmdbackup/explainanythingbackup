// Unit tests for runSectionEdit: mock LLM, edit acceptance/rejection, format validation.

import { runSectionEdit } from './sectionEditRunner';
import type { ArticleSection } from './types';
import type { EvolutionLLMClient } from '../types';
import type { DiffComparisonResult } from '../diffComparison';

// Mock compareWithDiff — its ESM dependencies (unified/remark-parse) don't load in jest.
// We control the verdict via mockCompareWithDiff to test the runner's branching logic.
let mockVerdict: DiffComparisonResult = { verdict: 'ACCEPT', confidence: 1, changesFound: 1 };
jest.mock('../diffComparison', () => ({
  compareWithDiff: jest.fn(async () => mockVerdict),
}));

// ─── Test fixtures ────────────────────────────────────────────────

const FULL_ARTICLE = `# Test Article

Intro paragraph here. It sets the stage.

## Section One

This section needs improvement. It is unclear and lacks detail.

## Section Two

This section is already good. It provides clear explanations.
`;

const TEST_SECTION: ArticleSection = {
  index: 1,
  heading: 'Section One',
  body: '\nThis section needs improvement. It is unclear and lacks detail.\n',
  markdown: '## Section One\n\nThis section needs improvement. It is unclear and lacks detail.\n',
  isPreamble: false,
};

const WEAKNESS = { dimension: 'clarity', description: 'Section is unclear and lacks detail.' };

// ─── Mock LLM client ─────────────────────────────────────────────

function createMockLLMClient(editResponse: string): EvolutionLLMClient {
  return {
    async complete(prompt: string): Promise<string> {
      return editResponse;
    },
    async completeStructured(): Promise<never> {
      throw new Error('Not used in section edit runner');
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('runSectionEdit', () => {
  beforeEach(() => {
    mockVerdict = { verdict: 'ACCEPT', confidence: 1, changesFound: 1 };
  });

  it('accepts improved section when judge verdict is ACCEPT', async () => {
    const improvedSection = `## Section One

This section has been significantly improved. It now provides clear and detailed explanations that readers can follow easily.
`;
    mockVerdict = { verdict: 'ACCEPT', confidence: 1, changesFound: 3 };
    const llm = createMockLLMClient(improvedSection);

    const result = await runSectionEdit(TEST_SECTION, FULL_ARTICLE, WEAKNESS, llm, 'test');

    expect(result.improved).toBe(true);
    expect(result.sectionIndex).toBe(1);
    expect(result.markdown).toBe(improvedSection);
  });

  it('rejects edit when judge verdict is REJECT', async () => {
    const worseSection = `## Section One

Bad content here. Worse than before.
`;
    mockVerdict = { verdict: 'REJECT', confidence: 1, changesFound: 2 };
    const llm = createMockLLMClient(worseSection);

    const result = await runSectionEdit(TEST_SECTION, FULL_ARTICLE, WEAKNESS, llm, 'test');

    expect(result.improved).toBe(false);
    expect(result.markdown).toBe(TEST_SECTION.markdown);
  });

  it('rejects edit that fails section format validation', async () => {
    // Return a section with H1 (not allowed in non-preamble sections)
    const badFormat = `# This is an H1

Should not appear in a section.
`;
    const llm = createMockLLMClient(badFormat);

    const result = await runSectionEdit(TEST_SECTION, FULL_ARTICLE, WEAKNESS, llm, 'test');

    expect(result.improved).toBe(false);
  });

  it('returns original section index', async () => {
    const improvedSection = `## Section One

Better content now. It explains things clearly and thoroughly.
`;
    mockVerdict = { verdict: 'ACCEPT', confidence: 1, changesFound: 1 };
    const llm = createMockLLMClient(improvedSection);

    const result = await runSectionEdit(TEST_SECTION, FULL_ARTICLE, WEAKNESS, llm, 'test');

    expect(result.sectionIndex).toBe(1);
  });

  it('handles UNSURE verdict from judge (no improvement)', async () => {
    const editedSection = `## Section One

Slightly different content here. It has minor changes.
`;
    mockVerdict = { verdict: 'UNSURE', confidence: 0.5, changesFound: 1 };
    const llm = createMockLLMClient(editedSection);

    const result = await runSectionEdit(TEST_SECTION, FULL_ARTICLE, WEAKNESS, llm, 'test');

    expect(result.improved).toBe(false);
  });
});
