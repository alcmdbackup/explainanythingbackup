# Patching Lexical AI Suggestion Test Gaps

## Problem Statement

The AI suggestion pipeline and diff system have solid unit/integration test coverage but **zero E2E tests** for critical user workflows:

1. No E2E test for AI suggestions panel workflow
2. No E2E test for accept/reject button interactions on diffs
3. No E2E test for diff visualization rendering
4. No integration test connecting button click → mutation → UI update
5. No test cases for common AI suggestion prompts (remove, shorten, improve)

---

## Current Test Coverage

| Component | Unit Tests | Integration | E2E |
|-----------|-----------|-------------|-----|
| DiffTagNode | ✅ 63 | ✅ | ❌ |
| Accept/Reject Logic | ✅ | ✅ 14 | ❌ |
| Hover Controls | ✅ 21 | ❌ | ❌ |
| AI Suggestion Pipeline | ❌ | ❌ | ❌ |
| Diff Visualization | ❌ | ❌ | ❌ |
| Prompt-Specific Cases | ❌ | ❌ | ❌ |

---

## Implementation Plan

### Phase 1: Unit Test Fixtures for Prompt-Specific Cases

**File:** `src/testing/utils/editor-test-helpers.ts`

Add new `promptSpecific` category to `AI_PIPELINE_FIXTURES`:

```typescript
// Add to AI_PIPELINE_FIXTURES object
promptSpecific: {
  removeFirstSentence: {
    name: 'remove-first-sentence',
    description: 'Remove the first sentence from a paragraph',
    category: 'deletion',
    originalMarkdown: `# Understanding Quantum Physics

This introductory sentence is outdated. Quantum physics describes nature at the smallest scales. It revolutionized our understanding of matter and energy.

## Key Concepts

The wave-particle duality is fundamental to quantum mechanics.`,
    editedMarkdown: `# Understanding Quantum Physics

Quantum physics describes nature at the smallest scales. It revolutionized our understanding of matter and energy.

## Key Concepts

The wave-particle duality is fundamental to quantum mechanics.`,
    expectedStep3Output: `# Understanding Quantum Physics

{--This introductory sentence is outdated. --}Quantum physics describes nature at the smallest scales. It revolutionized our understanding of matter and energy.

## Key Concepts

The wave-particle duality is fundamental to quantum mechanics.`,
    expectedStep4Output: `# Understanding Quantum Physics

{--This introductory sentence is outdated. --}Quantum physics describes nature at the smallest scales. It revolutionized our understanding of matter and energy.

## Key Concepts

The wave-particle duality is fundamental to quantum mechanics.`,
    expectedDiffNodeCount: 1,
    expectedDiffTypes: ['del'],
  },

  shortenFirstParagraph: {
    name: 'shorten-first-paragraph',
    description: 'Condense the first paragraph to key points',
    category: 'mixed',
    originalMarkdown: `# Machine Learning Basics

Machine learning is a subset of artificial intelligence that focuses on building systems that can learn from data. These systems improve their performance over time without being explicitly programmed. The field has grown significantly in recent years due to advances in computing power and the availability of large datasets.

## Types of Learning

Supervised learning uses labeled data to train models.`,
    editedMarkdown: `# Machine Learning Basics

Machine learning builds systems that learn from data and improve over time without explicit programming.

## Types of Learning

Supervised learning uses labeled data to train models.`,
    expectedStep3Output: `# Machine Learning Basics

{--Machine learning is a subset of artificial intelligence that focuses on building systems that can learn from data. These systems improve their performance over time without being explicitly programmed. The field has grown significantly in recent years due to advances in computing power and the availability of large datasets.--}{++Machine learning builds systems that learn from data and improve over time without explicit programming.++}

## Types of Learning

Supervised learning uses labeled data to train models.`,
    expectedStep4Output: `# Machine Learning Basics

{--Machine learning is a subset of artificial intelligence that focuses on building systems that can learn from data. These systems improve their performance over time without being explicitly programmed. The field has grown significantly in recent years due to advances in computing power and the availability of large datasets.--}{++Machine learning builds systems that learn from data and improve over time without explicit programming.++}

## Types of Learning

Supervised learning uses labeled data to train models.`,
    expectedDiffNodeCount: 2,
    expectedDiffTypes: ['del', 'ins'],
  },

  improveEntireArticle: {
    name: 'improve-entire-article',
    description: 'Rewrite entire article for clarity and better structure',
    category: 'mixed',
    originalMarkdown: `# Climate Change

Climate change is bad. It makes things hotter. The ice is melting and that's not good.

## Effects

There are many effects. Some are bad for animals. Some are bad for people.`,
    editedMarkdown: `# Understanding Climate Change

Climate change refers to long-term shifts in global temperatures and weather patterns. Rising greenhouse gas emissions have accelerated warming trends since the industrial era.

## Environmental and Social Effects

The consequences of climate change are far-reaching. Ecosystems face disruption as species struggle to adapt. Human communities experience increased extreme weather events, threatening food security and infrastructure.`,
    expectedStep3Output: `# {--Climate Change--}{++Understanding Climate Change++}

{--Climate change is bad. It makes things hotter. The ice is melting and that's not good.--}{++Climate change refers to long-term shifts in global temperatures and weather patterns. Rising greenhouse gas emissions have accelerated warming trends since the industrial era.++}

## {--Effects--}{++Environmental and Social Effects++}

{--There are many effects. Some are bad for animals. Some are bad for people.--}{++The consequences of climate change are far-reaching. Ecosystems face disruption as species struggle to adapt. Human communities experience increased extreme weather events, threatening food security and infrastructure.++}`,
    expectedStep4Output: `# {--Climate Change--}{++Understanding Climate Change++}

{--Climate change is bad. It makes things hotter. The ice is melting and that's not good.--}{++Climate change refers to long-term shifts in global temperatures and weather patterns. Rising greenhouse gas emissions have accelerated warming trends since the industrial era.++}

## {--Effects--}{++Environmental and Social Effects++}

{--There are many effects. Some are bad for animals. Some are bad for people.--}{++The consequences of climate change are far-reaching. Ecosystems face disruption as species struggle to adapt. Human communities experience increased extreme weather events, threatening food security and infrastructure.++}`,
    expectedDiffNodeCount: 8,
    expectedDiffTypes: ['del', 'ins', 'del', 'ins', 'del', 'ins', 'del', 'ins'],
  },
},
```

### Phase 2: Integration Tests for Prompt-Specific Cases

**File:** `src/editorFiles/lexicalEditor/__tests__/promptSpecific.integration.test.tsx`

```typescript
import { createTestEditor, setupEditorWithContent } from '@/testing/utils/editor-test-helpers';
import { getPipelineFixturesByCategory, AI_PIPELINE_FIXTURES } from '@/testing/utils/editor-test-helpers';
import { acceptDiffTag, rejectDiffTag } from '../diffTagMutations';
import { $getRoot } from 'lexical';

describe('Prompt-Specific Integration Tests', () => {
  describe('Remove First Sentence', () => {
    const fixture = AI_PIPELINE_FIXTURES.promptSpecific.removeFirstSentence;

    it('should create deletion diff for removed sentence', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      editor.getEditorState().read(() => {
        const diffNodes = getAllDiffNodes($getRoot());
        expect(diffNodes.length).toBe(fixture.expectedDiffNodeCount);
        expect(diffNodes[0].__tag).toBe('del');
      });
    });

    it('accept removes the sentence from content', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      const nodeKey = await getFirstDiffNodeKey(editor);
      acceptDiffTag(editor, nodeKey);

      const content = await getEditorMarkdown(editor);
      expect(content).not.toContain('This introductory sentence is outdated');
      expect(content).toContain('Quantum physics describes nature');
    });

    it('reject keeps the sentence in content', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      const nodeKey = await getFirstDiffNodeKey(editor);
      rejectDiffTag(editor, nodeKey);

      const content = await getEditorMarkdown(editor);
      expect(content).toContain('This introductory sentence is outdated');
    });
  });

  describe('Shorten First Paragraph', () => {
    const fixture = AI_PIPELINE_FIXTURES.promptSpecific.shortenFirstParagraph;

    it('should create deletion and insertion diffs', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      editor.getEditorState().read(() => {
        const diffNodes = getAllDiffNodes($getRoot());
        expect(diffNodes.length).toBe(fixture.expectedDiffNodeCount);
        expect(diffNodes.map(n => n.__tag)).toEqual(['del', 'ins']);
      });
    });

    it('accept all replaces verbose paragraph with concise version', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      await acceptAllDiffs(editor);

      const content = await getEditorMarkdown(editor);
      expect(content).not.toContain('subset of artificial intelligence');
      expect(content).toContain('Machine learning builds systems that learn from data');
    });

    it('reject all keeps original verbose paragraph', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      await rejectAllDiffs(editor);

      const content = await getEditorMarkdown(editor);
      expect(content).toContain('subset of artificial intelligence');
      expect(content).not.toContain('Machine learning builds systems that learn from data');
    });
  });

  describe('Improve Entire Article', () => {
    const fixture = AI_PIPELINE_FIXTURES.promptSpecific.improveEntireArticle;

    it('should create multiple diffs across headings and paragraphs', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      editor.getEditorState().read(() => {
        const diffNodes = getAllDiffNodes($getRoot());
        expect(diffNodes.length).toBe(fixture.expectedDiffNodeCount);
      });
    });

    it('accept all transforms article to improved version', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      await acceptAllDiffs(editor);

      const content = await getEditorMarkdown(editor);
      // Improved heading
      expect(content).toContain('Understanding Climate Change');
      expect(content).not.toContain('# Climate Change\n');
      // Improved content
      expect(content).toContain('long-term shifts in global temperatures');
      expect(content).not.toContain('Climate change is bad');
    });

    it('reject all keeps original poor quality article', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      await rejectAllDiffs(editor);

      const content = await getEditorMarkdown(editor);
      expect(content).toContain('Climate change is bad');
      expect(content).not.toContain('long-term shifts');
    });

    it('partial accept keeps some improvements, rejects others', async () => {
      const editor = createTestEditor();
      await setupEditorWithContent(editor, fixture.expectedStep4Output);

      // Accept first diff (heading change), reject second (paragraph)
      const diffKeys = await getAllDiffNodeKeys(editor);
      acceptDiffTag(editor, diffKeys[0]); // Accept heading deletion
      acceptDiffTag(editor, diffKeys[1]); // Accept heading insertion
      rejectDiffTag(editor, diffKeys[2]); // Reject paragraph deletion
      rejectDiffTag(editor, diffKeys[3]); // Reject paragraph insertion

      const content = await getEditorMarkdown(editor);
      expect(content).toContain('Understanding Climate Change'); // Improved heading
      expect(content).toContain('Climate change is bad'); // Original paragraph
    });
  });
});
```

### Phase 3: API Mocks for AI Suggestions

**File:** `src/__tests__/e2e/helpers/api-mocks.ts`

Add mock for `runAISuggestionsPipelineAction`:

```typescript
export async function mockAISuggestionsPipeline(
  page: Page,
  options: {
    content: string;        // Content with CriticMarkup
    success?: boolean;
    error?: string;
    delay?: number;
  }
) {
  await page.route('**/api/aiSuggestions', async (route) => {
    if (options.delay) await new Promise(r => setTimeout(r, options.delay));

    if (options.success === false) {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ success: false, error: options.error }),
      });
    } else {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({
          success: true,
          content: options.content,
          session_id: 'test-session-123',
        }),
      });
    }
  });
}

// Pre-built mock responses for generic cases
export const mockDiffContent = {
  insertion: `# Title\n\nThis is {++newly added++} content.`,
  deletion: `# Title\n\nThis is {--removed--} content.`,
  update: `# Title\n\nThis is {~~old~>new~~} content.`,
  mixed: `# Title\n\n{++Added paragraph.++}\n\nThis has {--deleted--} and {~~changed~>updated~~} words.`,
};

// Prompt-specific mock responses
export const mockPromptSpecificContent = {
  removeFirstSentence: `# Understanding Quantum Physics

{--This introductory sentence is outdated. --}Quantum physics describes nature at the smallest scales. It revolutionized our understanding of matter and energy.

## Key Concepts

The wave-particle duality is fundamental to quantum mechanics.`,

  shortenFirstParagraph: `# Machine Learning Basics

{--Machine learning is a subset of artificial intelligence that focuses on building systems that can learn from data. These systems improve their performance over time without being explicitly programmed. The field has grown significantly in recent years due to advances in computing power and the availability of large datasets.--}{++Machine learning builds systems that learn from data and improve over time without explicit programming.++}

## Types of Learning

Supervised learning uses labeled data to train models.`,

  improveEntireArticle: `# {--Climate Change--}{++Understanding Climate Change++}

{--Climate change is bad. It makes things hotter. The ice is melting and that's not good.--}{++Climate change refers to long-term shifts in global temperatures and weather patterns. Rising greenhouse gas emissions have accelerated warming trends since the industrial era.++}

## {--Effects--}{++Environmental and Social Effects++}

{--There are many effects. Some are bad for animals. Some are bad for people.--}{++The consequences of climate change are far-reaching. Ecosystems face disruption as species struggle to adapt. Human communities experience increased extreme weather events, threatening food security and infrastructure.++}`,
};
```

### Phase 4: Page Object Model Extensions

**File:** `src/__tests__/e2e/helpers/pages/ResultsPage.ts`

Add AI suggestions methods:

```typescript
// AI Suggestions Panel selectors
private aiSuggestionsPanel = '[data-testid="ai-suggestions-panel"]';
private aiPromptInput = '#ai-prompt';
private getSuggestionsButton = 'button:has-text("Get Suggestions")';
private suggestionsLoading = 'button:has-text("Composing...")';
private suggestionsSuccess = 'text="Revisions Applied"';
private suggestionsError = '[data-testid="suggestions-error"]';

// Diff node selectors
private diffNodes = '[data-diff-key]';
private insertionNodes = '[data-diff-type="ins"]';
private deletionNodes = '[data-diff-type="del"]';
private updateNodes = '[data-diff-type="update"]';
private acceptButton = '.diff-accept-btn';
private rejectButton = '.diff-reject-btn';

// AI Suggestions methods
async openAISuggestionsPanel() {
  await this.page.click('[data-testid="edit-button"]');
}

async submitAISuggestion(prompt: string) {
  await this.page.fill(this.aiPromptInput, prompt);
  await this.page.click(this.getSuggestionsButton);
}

async waitForSuggestionsComplete(timeout = 30000) {
  await this.page.waitForSelector(this.suggestionsSuccess, { timeout });
}

async waitForSuggestionsError(timeout = 10000) {
  await this.page.waitForSelector(this.suggestionsError, { timeout });
}

// Diff interaction methods
async getDiffCount() {
  return await this.page.locator(this.diffNodes).count();
}

async getInsertionCount() {
  return await this.page.locator(this.insertionNodes).count();
}

async getDeletionCount() {
  return await this.page.locator(this.deletionNodes).count();
}

async getUpdateCount() {
  return await this.page.locator(this.updateNodes).count();
}

async acceptDiff(index: number = 0) {
  const diff = this.page.locator(this.diffNodes).nth(index);
  await diff.hover();
  await diff.locator(this.acceptButton).click();
}

async rejectDiff(index: number = 0) {
  const diff = this.page.locator(this.diffNodes).nth(index);
  await diff.hover();
  await diff.locator(this.rejectButton).click();
}

async acceptAllDiffs() {
  let count = await this.getDiffCount();
  while (count > 0) {
    await this.acceptDiff(0);
    count = await this.getDiffCount();
  }
}

async rejectAllDiffs() {
  let count = await this.getDiffCount();
  while (count > 0) {
    await this.rejectDiff(0);
    count = await this.getDiffCount();
  }
}

async getDiffText(index: number = 0) {
  return await this.page.locator(this.diffNodes).nth(index).innerText();
}
```

### Phase 5: E2E Test Specs

**File:** `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts`

```typescript
import { test, expect } from '../../fixtures/auth';
import { ResultsPage } from '../../helpers/pages/ResultsPage';
import {
  mockAISuggestionsPipeline,
  mockDiffContent,
  mockPromptSpecificContent,
  mockReturnExplanationAPI,
  defaultMockExplanation
} from '../../helpers/api-mocks';

test.describe('AI Suggestions Pipeline', () => {
  test.describe('Panel Interaction', () => {
    test('should open AI suggestions panel', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();

      await resultsPage.openAISuggestionsPanel();
      await expect(page.locator('#ai-prompt')).toBeVisible();
    });

    test('should submit suggestion and show loading state', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion, delay: 1000 });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();

      await resultsPage.submitAISuggestion('Add more detail');
      await expect(page.locator('button:has-text("Composing...")')).toBeVisible();
    });

    test('should display success message after suggestions applied', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Add examples');

      await resultsPage.waitForSuggestionsComplete();
      await expect(page.locator('text="Revisions Applied"')).toBeVisible();
    });

    test('should handle suggestion error gracefully', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { success: false, error: 'Pipeline failed' });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Break it');

      await resultsPage.waitForSuggestionsError();
    });
  });

  test.describe('Diff Visualization', () => {
    test('should render insertion diff with green styling', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Add content');
      await resultsPage.waitForSuggestionsComplete();

      const insertionCount = await resultsPage.getInsertionCount();
      expect(insertionCount).toBe(1);

      const insertion = page.locator('[data-diff-type="ins"]').first();
      await expect(insertion).toHaveCSS('background-color', /rgba\(34, 197, 94/);
    });

    test('should render deletion diff with red styling and strikethrough', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.deletion });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Remove content');
      await resultsPage.waitForSuggestionsComplete();

      const deletionCount = await resultsPage.getDeletionCount();
      expect(deletionCount).toBe(1);

      const deletion = page.locator('[data-diff-type="del"]').first();
      await expect(deletion).toHaveCSS('text-decoration-line', 'line-through');
    });

    test('should render mixed diffs correctly', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.mixed });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Edit content');
      await resultsPage.waitForSuggestionsComplete();

      const totalDiffs = await resultsPage.getDiffCount();
      expect(totalDiffs).toBeGreaterThan(1);
    });
  });

  test.describe('Accept/Reject Interactions', () => {
    test('should show accept/reject buttons on hover', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Add content');
      await resultsPage.waitForSuggestionsComplete();

      const diff = page.locator('[data-diff-key]').first();
      await diff.hover();

      await expect(diff.locator('.diff-accept-btn')).toBeVisible();
      await expect(diff.locator('.diff-reject-btn')).toBeVisible();
    });

    test('should accept insertion and keep content', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Add content');
      await resultsPage.waitForSuggestionsComplete();

      const beforeCount = await resultsPage.getDiffCount();
      expect(beforeCount).toBe(1);

      await resultsPage.acceptDiff(0);

      const afterCount = await resultsPage.getDiffCount();
      expect(afterCount).toBe(0);

      const content = await resultsPage.getContent();
      expect(content).toContain('newly added');
    });

    test('should reject insertion and remove content', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.insertion });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Add content');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectDiff(0);

      const afterCount = await resultsPage.getDiffCount();
      expect(afterCount).toBe(0);

      const content = await resultsPage.getContent();
      expect(content).not.toContain('newly added');
    });

    test('should accept deletion and remove content', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.deletion });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Remove content');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.acceptDiff(0);

      const content = await resultsPage.getContent();
      expect(content).not.toContain('removed');
    });

    test('should reject deletion and keep content', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.deletion });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Remove content');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectDiff(0);

      const content = await resultsPage.getContent();
      expect(content).toContain('removed');
    });

    test('should handle accept all diffs', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockDiffContent.mixed });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Edit content');
      await resultsPage.waitForSuggestionsComplete();

      const beforeCount = await resultsPage.getDiffCount();
      expect(beforeCount).toBeGreaterThan(1);

      await resultsPage.acceptAllDiffs();

      const afterCount = await resultsPage.getDiffCount();
      expect(afterCount).toBe(0);
    });
  });

  test.describe('Prompt-Specific: Remove First Sentence', () => {
    test('should show deletion diff for first sentence', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.removeFirstSentence });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Remove the first sentence');
      await resultsPage.waitForSuggestionsComplete();

      const deletionCount = await resultsPage.getDeletionCount();
      expect(deletionCount).toBe(1);

      const diffText = await resultsPage.getDiffText(0);
      expect(diffText).toContain('introductory sentence is outdated');
    });

    test('accept removes sentence, content flows naturally', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.removeFirstSentence });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Remove the first sentence');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.acceptDiff(0);

      const content = await resultsPage.getContent();
      expect(content).not.toContain('introductory sentence is outdated');
      expect(content).toContain('Quantum physics describes nature');
    });

    test('reject keeps original first sentence', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.removeFirstSentence });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Remove the first sentence');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectDiff(0);

      const content = await resultsPage.getContent();
      expect(content).toContain('introductory sentence is outdated');
    });
  });

  test.describe('Prompt-Specific: Shorten First Paragraph', () => {
    test('should show deletion and insertion diffs for paragraph condensation', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.shortenFirstParagraph });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Shorten the first paragraph');
      await resultsPage.waitForSuggestionsComplete();

      const deletionCount = await resultsPage.getDeletionCount();
      const insertionCount = await resultsPage.getInsertionCount();
      expect(deletionCount).toBeGreaterThanOrEqual(1);
      expect(insertionCount).toBeGreaterThanOrEqual(1);
    });

    test('accept all replaces verbose with concise paragraph', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.shortenFirstParagraph });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Shorten the first paragraph');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.acceptAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).not.toContain('subset of artificial intelligence');
      expect(content).toContain('Machine learning builds systems');
    });

    test('reject all keeps original verbose paragraph', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.shortenFirstParagraph });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Shorten the first paragraph');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).toContain('subset of artificial intelligence');
    });
  });

  test.describe('Prompt-Specific: Improve Entire Article', () => {
    test('should show multiple diffs across entire article', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.improveEntireArticle });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Improve the entire article');
      await resultsPage.waitForSuggestionsComplete();

      const totalDiffs = await resultsPage.getDiffCount();
      expect(totalDiffs).toBeGreaterThan(4); // Multiple sections changed
    });

    test('accept all transforms to improved version', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.improveEntireArticle });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Improve the entire article');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.acceptAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).toContain('Understanding Climate Change');
      expect(content).toContain('long-term shifts in global temperatures');
      expect(content).not.toContain('Climate change is bad');
    });

    test('reject all keeps original poor quality article', async ({ authenticatedPage: page }) => {
      const resultsPage = new ResultsPage(page);
      await mockReturnExplanationAPI(page, defaultMockExplanation);
      await mockAISuggestionsPipeline(page, { content: mockPromptSpecificContent.improveEntireArticle });

      await resultsPage.navigate('test query');
      await resultsPage.waitForCompleteGeneration();
      await resultsPage.openAISuggestionsPanel();
      await resultsPage.submitAISuggestion('Improve the entire article');
      await resultsPage.waitForSuggestionsComplete();

      await resultsPage.rejectAllDiffs();

      const content = await resultsPage.getContent();
      expect(content).toContain('Climate change is bad');
      expect(content).not.toContain('Understanding Climate Change');
    });
  });
});
```

### Phase 6: Add Missing data-testid Attributes

**File:** `src/components/AISuggestionsPanel.tsx`

Add test IDs to key elements:

```typescript
// Panel container
<div data-testid="ai-suggestions-panel" className={...}>

// Error display
<div data-testid="suggestions-error" className="...">

// Success message (if not already present)
<div data-testid="suggestions-success">Revisions Applied</div>
```

**File:** `src/app/results/page.tsx`

Add test ID to edit button:

```typescript
<button data-testid="edit-button" onClick={...}>
```

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Modify | `src/testing/utils/editor-test-helpers.ts` - Add promptSpecific fixtures |
| Create | `src/editorFiles/lexicalEditor/__tests__/promptSpecific.integration.test.tsx` - Integration tests |
| Modify | `src/__tests__/e2e/helpers/api-mocks.ts` - Add AI suggestions mock + prompt-specific mocks |
| Modify | `src/__tests__/e2e/helpers/pages/ResultsPage.ts` - Add diff/suggestion methods |
| Create | `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts` - E2E tests |
| Modify | `src/components/AISuggestionsPanel.tsx` - Add data-testid attributes |
| Modify | `src/app/results/page.tsx` - Add data-testid to edit button |

---

## Test Count Summary

| Category | Unit | Integration | E2E |
|----------|------|-------------|-----|
| Panel Interaction | - | - | 4 |
| Diff Visualization | - | - | 3 |
| Accept/Reject Generic | - | - | 7 |
| Remove First Sentence | 3 | 3 | 3 |
| Shorten First Paragraph | 3 | 3 | 3 |
| Improve Entire Article | 3 | 4 | 3 |
| **Total** | **9** | **10** | **23** |

**Grand Total: 42 new tests**

---

## Success Criteria

- [ ] All 9 unit tests for prompt-specific fixtures pass
- [ ] All 10 integration tests for prompt-specific cases pass
- [ ] All 23 E2E tests pass locally
- [ ] Tests pass in CI (GitHub Actions)
- [ ] Mock API correctly simulates pipeline responses for each prompt type
- [ ] Accept/reject buttons trigger correct editor mutations
- [ ] Diff visualization shows correct colors/styling
- [ ] No flaky tests (retry count stays at 0)

---

## Dependencies

- Existing E2E infrastructure (Playwright, fixtures, POMs)
- Existing fixture infrastructure (`editor-test-helpers.ts`)
- `mockReturnExplanationAPI` for initial content
- Auth fixtures for authenticated tests

---

## Run Commands

```bash
# Run all tests
npm test

# Run only prompt-specific unit tests
npm test -- --grep "promptSpecific"

# Run only integration tests
npm test -- --testPathPattern="promptSpecific.integration"

# Run all E2E tests
npm run test:e2e

# Run only AI suggestions E2E tests
npx playwright test suggestions.spec.ts

# Run with UI for debugging
npx playwright test suggestions.spec.ts --ui

# Run with trace for debugging failures
npx playwright test suggestions.spec.ts --trace on
```
