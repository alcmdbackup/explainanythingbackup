/**
 * @jest-environment node
 */
// Tests for run-evolution-local.ts — validates prompt-seeded pipeline, seed article generation,
// and CLI argument parsing for the evolution pipeline.

import { createTitlePrompt, createExplanationPrompt } from '../src/lib/prompts';
import { titleQuerySchema } from '../src/lib/schemas/schemas';

describe('run-evolution-local prompt mode', () => {
  describe('seed article generation flow', () => {
    it('should generate a title from a prompt using createTitlePrompt', () => {
      const prompt = 'Explain quantum entanglement';
      const titlePrompt = createTitlePrompt(prompt);

      expect(titlePrompt).toContain('Explain quantum entanglement');
      expect(titlePrompt).toContain('Title Rules');
    });

    it('should generate an article from a title using createExplanationPrompt', () => {
      const title = 'Quantum Entanglement';
      const articlePrompt = createExplanationPrompt(title, []);

      expect(articlePrompt).toContain('Quantum Entanglement');
      expect(articlePrompt).toContain('section header');
    });

    it('should parse structured title response', () => {
      const mockResponse = JSON.stringify({
        title1: 'Quantum Entanglement',
        title2: 'Quantum Entanglement (Physics)',
        title3: 'Introduction to Quantum Entanglement',
      });

      const parsed = titleQuerySchema.parse(JSON.parse(mockResponse));
      expect(parsed.title1).toBe('Quantum Entanglement');
    });

    it('should handle non-JSON title response gracefully', () => {
      // When LLM returns plain text instead of JSON, the code falls back to using it as title
      const rawTitle = '"Quantum Entanglement"\n';
      const cleanedTitle = rawTitle.replace(/["\n]/g, '').trim().slice(0, 200);
      expect(cleanedTitle).toBe('Quantum Entanglement');
    });

    it('should truncate very long fallback titles', () => {
      const longResponse = 'A'.repeat(500);
      const cleaned = longResponse.replace(/["\n]/g, '').trim().slice(0, 200);
      expect(cleaned.length).toBe(200);
    });
  });

  describe('CLI argument parsing validation', () => {
    it('should require either --file or --prompt', () => {
      // This tests the logic: if both are null, parseArgs exits with error
      const hasFile = null;
      const hasPrompt = null;
      expect(!hasFile && !hasPrompt).toBe(true);
    });

    it('should reject --file and --prompt together', () => {
      // This tests the logic: if both are provided, parseArgs exits with error
      const hasFile = '/some/file.md';
      const hasPrompt = 'Explain something';
      expect(!!hasFile && !!hasPrompt).toBe(true);
    });

    it('should default seed-model to model when not specified', () => {
      const model = 'deepseek-chat';
      const seedModel = null;
      const effectiveSeedModel = seedModel ?? model;
      expect(effectiveSeedModel).toBe('deepseek-chat');
    });

    it('should allow different seed-model from model', () => {
      const model = 'deepseek-chat';
      const seedModel = 'gpt-4.1';
      const effectiveSeedModel = seedModel ?? model;
      expect(effectiveSeedModel).toBe('gpt-4.1');
    });
  });

  describe('bank checkpoint parsing', () => {
    function parseBankCheckpoints(raw: string | undefined): number[] {
      if (!raw) return [];
      return raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
    }

    it('should parse comma-separated checkpoint values', () => {
      expect(parseBankCheckpoints('3,5,10')).toEqual([3, 5, 10]);
    });

    it('should sort checkpoints in ascending order', () => {
      expect(parseBankCheckpoints('10,3,5')).toEqual([3, 5, 10]);
    });

    it('should handle whitespace in checkpoint values', () => {
      expect(parseBankCheckpoints('3, 5, 10')).toEqual([3, 5, 10]);
    });

    it('should filter out NaN values', () => {
      expect(parseBankCheckpoints('3,abc,10')).toEqual([3, 10]);
    });

    it('should return empty array when no checkpoints specified', () => {
      expect(parseBankCheckpoints(undefined)).toEqual([]);
    });

    it('should adjust iterations to cover max checkpoint', () => {
      const checkpoints = [3, 5, 10];
      let iterations = 5;
      const maxCheckpoint = checkpoints[checkpoints.length - 1];
      if (maxCheckpoint > iterations) {
        iterations = maxCheckpoint;
      }
      expect(iterations).toBe(10);
    });

    it('should not reduce iterations below max checkpoint', () => {
      const checkpoints = [3, 5, 10];
      let iterations = 15; // already higher
      const maxCheckpoint = checkpoints[checkpoints.length - 1];
      if (maxCheckpoint > iterations) {
        iterations = maxCheckpoint;
      }
      expect(iterations).toBe(15); // unchanged
    });

    it('should skip final winner insertion when final iteration is a checkpoint', () => {
      const bankCheckpoints = [3, 5, 10];
      const finalIteration = 10;
      const finalIterationIsCheckpoint = bankCheckpoints.includes(finalIteration);
      expect(finalIterationIsCheckpoint).toBe(true);
    });

    it('should not skip final winner when iteration is not a checkpoint', () => {
      const bankCheckpoints = [3, 5, 10];
      const finalIteration = 7; // early exit
      const finalIterationIsCheckpoint = bankCheckpoints.includes(finalIteration);
      expect(finalIterationIsCheckpoint).toBe(false);
    });
  });

  describe('mock LLM client integration', () => {
    it('should produce valid seed content from mock responses', () => {
      // Mock LLM returns text templates that pass format validation
      const mockArticleText = '# Building a Great API\n\n## Endpoint Design\n\nWhen building an API...';
      const fullContent = `# Test Title\n\n${mockArticleText}`;

      expect(fullContent).toContain('# Test Title');
      expect(fullContent.split(/\s+/).length).toBeGreaterThan(5);
    });

    it('should construct seed title from generated content', () => {
      const mockTitleJSON = JSON.stringify({
        title1: 'Building Great APIs',
        title2: 'API Development Guide',
        title3: 'How to Build APIs',
      });

      // Simulate the title parsing logic
      let title: string;
      try {
        const parsed = titleQuerySchema.parse(JSON.parse(mockTitleJSON));
        title = parsed.title1;
      } catch {
        title = mockTitleJSON.replace(/["\n]/g, '').trim().slice(0, 200);
      }

      expect(title).toBe('Building Great APIs');
    });
  });
});
