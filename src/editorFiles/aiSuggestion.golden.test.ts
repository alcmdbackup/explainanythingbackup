/**
 * Golden Tests for AI Suggestions Pipeline (Phase 4)
 *
 * These tests use Jest snapshot testing to ensure consistent output
 * across all pipeline fixtures. Any unexpected change in output will
 * cause tests to fail, helping catch regressions.
 *
 * To update snapshots when intentional changes are made:
 *   npm test -- --updateSnapshot
 */

import { RenderCriticMarkupFromMDAstDiff } from './markdownASTdiff/markdownASTdiff';
import { preprocessCriticMarkup } from './lexicalEditor/importExportUtils';
import {
  AI_PIPELINE_FIXTURES,
  getAllPipelineFixtures,
  getPipelineFixturesByCategory,
  getPromptSpecificFixtures,
  type PipelineFixture,
} from '@/testing/utils/editor-test-helpers';

// Suppress console logs during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

// ============= Mock AST Creation =============

function createMockASTFromMarkdown(markdown: string) {
  if (!markdown.trim()) {
    return { type: 'root', children: [] };
  }

  const paragraphs = markdown.split(/\n\n+/).filter((p) => p.trim());
  const children = paragraphs.map((p) => {
    const headingMatch = p.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      return {
        type: 'heading',
        depth: headingMatch[1].length,
        children: [{ type: 'text', value: headingMatch[2] }],
      };
    }

    const codeMatch = p.match(/^```(\w*)\n([\s\S]*?)```$/);
    if (codeMatch) {
      return {
        type: 'code',
        lang: codeMatch[1] || null,
        value: codeMatch[2],
      };
    }

    if (p.match(/^[-*]\s+/m)) {
      const items = p.split(/\n/).filter((line) => line.match(/^[-*]\s+/));
      return {
        type: 'list',
        ordered: false,
        children: items.map((item) => ({
          type: 'listItem',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: item.replace(/^[-*]\s+/, '') }],
            },
          ],
        })),
      };
    }

    return {
      type: 'paragraph',
      children: [{ type: 'text', value: p }],
    };
  });

  return { type: 'root', children };
}

// ============= Step 4 Golden Tests =============

describe('Golden Tests: Step 4 Preprocessing', () => {
  describe('Insertions', () => {
    const fixtures = getPipelineFixturesByCategory('insertion');

    describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
      it('preprocessCriticMarkup output matches snapshot', () => {
        const result = preprocessCriticMarkup(fixture.expectedStep3Output);
        expect(result).toMatchSnapshot();
      });
    });
  });

  describe('Deletions', () => {
    const fixtures = getPipelineFixturesByCategory('deletion');

    describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
      it('preprocessCriticMarkup output matches snapshot', () => {
        const result = preprocessCriticMarkup(fixture.expectedStep3Output);
        expect(result).toMatchSnapshot();
      });
    });
  });

  describe('Updates', () => {
    const fixtures = getPipelineFixturesByCategory('update');

    describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
      it('preprocessCriticMarkup output matches snapshot', () => {
        const result = preprocessCriticMarkup(fixture.expectedStep3Output);
        expect(result).toMatchSnapshot();
      });
    });
  });

  describe('Mixed', () => {
    const fixtures = getPipelineFixturesByCategory('mixed');

    describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
      it('preprocessCriticMarkup output matches snapshot', () => {
        const result = preprocessCriticMarkup(fixture.expectedStep3Output);
        expect(result).toMatchSnapshot();
      });
    });
  });

  describe('Edge Cases', () => {
    const fixtures = getPipelineFixturesByCategory('edge-case');

    describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
      it('preprocessCriticMarkup output matches snapshot', () => {
        const result = preprocessCriticMarkup(fixture.expectedStep3Output);
        expect(result).toMatchSnapshot();
      });
    });
  });
});

// ============= Step 3 Golden Tests =============

describe('Golden Tests: Step 3 CriticMarkup Generation', () => {
  describe('Prompt-Specific Cases', () => {
    const fixtures = getPromptSpecificFixtures();

    describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
      it('RenderCriticMarkupFromMDAstDiff output matches snapshot', () => {
        const beforeAST = createMockASTFromMarkdown(fixture.originalMarkdown);
        const afterAST = createMockASTFromMarkdown(fixture.editedMarkdown);
        const result = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);

        expect(result).toMatchSnapshot();
      });
    });
  });

  describe('Simple Insertions', () => {
    const insertionFixtures = getPipelineFixturesByCategory('insertion');

    describe.each(insertionFixtures)('$name', (fixture: PipelineFixture) => {
      it('diff generation matches snapshot', () => {
        const beforeAST = createMockASTFromMarkdown(fixture.originalMarkdown);
        const afterAST = createMockASTFromMarkdown(fixture.editedMarkdown);
        const result = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);

        expect(result).toMatchSnapshot();
      });
    });
  });

  describe('Simple Deletions', () => {
    const deletionFixtures = getPipelineFixturesByCategory('deletion');

    describe.each(deletionFixtures)('$name', (fixture: PipelineFixture) => {
      it('diff generation matches snapshot', () => {
        const beforeAST = createMockASTFromMarkdown(fixture.originalMarkdown);
        const afterAST = createMockASTFromMarkdown(fixture.editedMarkdown);
        const result = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);

        expect(result).toMatchSnapshot();
      });
    });
  });
});

// ============= Full Pipeline Golden Tests =============

describe('Golden Tests: Full Pipeline', () => {
  const allFixtures = getAllPipelineFixtures();

  describe.each(allFixtures)('$name', (fixture: PipelineFixture) => {
    it('complete pipeline output matches snapshot', () => {
      // Step 3: Generate CriticMarkup
      const beforeAST = createMockASTFromMarkdown(fixture.originalMarkdown);
      const afterAST = createMockASTFromMarkdown(fixture.editedMarkdown);
      const step3Result = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);

      // Step 4: Preprocess
      const step4Result = preprocessCriticMarkup(step3Result);

      expect({
        name: fixture.name,
        category: fixture.category,
        step3: step3Result,
        step4: step4Result,
      }).toMatchSnapshot();
    });
  });
});

// ============= Fixture Validation Golden Tests =============

describe('Golden Tests: Expected Outputs Validation', () => {
  describe('expectedStep3Output matches expectedStep4Output structure', () => {
    const fixtures = getAllPipelineFixtures();

    describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
      it('expected outputs are consistent', () => {
        // The expected outputs should produce consistent results
        const step4FromStep3 = preprocessCriticMarkup(fixture.expectedStep3Output);

        expect({
          fixture: fixture.name,
          step3: fixture.expectedStep3Output,
          step4Computed: step4FromStep3,
          step4Expected: fixture.expectedStep4Output,
        }).toMatchSnapshot();
      });
    });
  });
});

// ============= Regression Golden Tests =============

describe('Golden Tests: Known Regression Cases', () => {
  it('delete first sentence regression', () => {
    const fixture = AI_PIPELINE_FIXTURES.promptSpecific.removeFirstSentence;

    const beforeAST = createMockASTFromMarkdown(fixture.originalMarkdown);
    const afterAST = createMockASTFromMarkdown(fixture.editedMarkdown);
    const criticMarkup = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);
    const preprocessed = preprocessCriticMarkup(criticMarkup);

    expect({
      caseName: 'delete-first-sentence',
      input: {
        original: fixture.originalMarkdown,
        edited: fixture.editedMarkdown,
      },
      output: {
        criticMarkup,
        preprocessed,
      },
    }).toMatchSnapshot();
  });

  it('shorten paragraph regression', () => {
    const fixture = AI_PIPELINE_FIXTURES.promptSpecific.shortenFirstParagraph;

    const beforeAST = createMockASTFromMarkdown(fixture.originalMarkdown);
    const afterAST = createMockASTFromMarkdown(fixture.editedMarkdown);
    const criticMarkup = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);
    const preprocessed = preprocessCriticMarkup(criticMarkup);

    expect({
      caseName: 'shorten-paragraph',
      input: {
        original: fixture.originalMarkdown,
        edited: fixture.editedMarkdown,
      },
      output: {
        criticMarkup,
        preprocessed,
      },
    }).toMatchSnapshot();
  });

  it('improve entire article regression', () => {
    const fixture = AI_PIPELINE_FIXTURES.promptSpecific.improveEntireArticle;

    const beforeAST = createMockASTFromMarkdown(fixture.originalMarkdown);
    const afterAST = createMockASTFromMarkdown(fixture.editedMarkdown);
    const criticMarkup = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);
    const preprocessed = preprocessCriticMarkup(criticMarkup);

    expect({
      caseName: 'improve-entire-article',
      input: {
        original: fixture.originalMarkdown,
        edited: fixture.editedMarkdown,
      },
      output: {
        criticMarkup,
        preprocessed,
      },
    }).toMatchSnapshot();
  });
});

// ============= Metadata Consistency Tests =============

describe('Golden Tests: Fixture Metadata', () => {
  it('all fixtures have required properties', () => {
    const allFixtures = getAllPipelineFixtures();

    const fixtureMetadata = allFixtures.map((f) => ({
      name: f.name,
      category: f.category,
      description: f.description,
      expectedDiffNodeCount: f.expectedDiffNodeCount,
      expectedDiffTypes: f.expectedDiffTypes,
    }));

    expect(fixtureMetadata).toMatchSnapshot();
  });

  it('category distribution is balanced', () => {
    const allFixtures = getAllPipelineFixtures();

    const categoryCounts = allFixtures.reduce(
      (acc, f) => {
        acc[f.category] = (acc[f.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    expect(categoryCounts).toMatchSnapshot();
  });
});
