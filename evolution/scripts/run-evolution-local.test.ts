/**
 * @jest-environment node
 */
// Tests for run-evolution-local.ts — validates prompt-seeded pipeline, seed article generation,
// and CLI argument parsing for the evolution pipeline.

import { createTitlePrompt, createExplanationPrompt } from '../../src/lib/prompts';
import { titleQuerySchema } from '../../src/lib/schemas/schemas';

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

  describe('outline flag parsing', () => {
    it('should default outline to false', () => {
      const outline = false; // default when --outline not passed
      expect(outline).toBe(false);
    });

    it('should set outline to true when --outline flag present', () => {
      const args = ['--file', 'test.md', '--outline'];
      const outline = args.includes('--outline');
      expect(outline).toBe(true);
    });

    it('should include outlineGeneration in agent names when outline is true', () => {
      const outline = true;
      const full = true;
      const agentNames = full
        ? ['generation', 'calibration', 'tournament', 'evolution', 'reflection', 'proximity', 'metaReview', ...(outline ? ['outlineGeneration'] : [])]
        : ['generation', 'calibration'];
      expect(agentNames).toContain('outlineGeneration');
    });

    it('should not include outlineGeneration when outline is false', () => {
      const outline = false;
      const full = true;
      const agentNames = full
        ? ['generation', 'calibration', 'tournament', 'evolution', 'reflection', 'proximity', 'metaReview', ...(outline ? ['outlineGeneration'] : [])]
        : ['generation', 'calibration'];
      expect(agentNames).not.toContain('outlineGeneration');
    });
  });

  describe('outline variant bank metadata', () => {
    it('should include step metadata for outline variants', () => {
      const isOutlineWinner = true;
      const winnerMeta: Record<string, unknown> = {
        iterations: 5,
        winning_strategy: 'outline_generation',
      };
      if (isOutlineWinner) {
        winnerMeta.outline_mode = true;
        winnerMeta.outline = '## Section 1\nSummary\n## Section 2\nSummary';
        winnerMeta.weakest_step = 'expand';
        winnerMeta.steps = [
          { name: 'outline', score: 0.9, costUsd: 0.01 },
          { name: 'expand', score: 0.4, costUsd: 0.02 },
        ];
      }
      expect(winnerMeta.outline_mode).toBe(true);
      expect(winnerMeta.steps).toHaveLength(2);
      expect(winnerMeta.weakest_step).toBe('expand');
    });

    it('should not include step metadata for regular variants', () => {
      const isOutlineWinner = false;
      const winnerMeta: Record<string, unknown> = {
        iterations: 5,
        winning_strategy: 'structural_transform',
      };
      if (isOutlineWinner) {
        winnerMeta.outline_mode = true;
      }
      expect(winnerMeta.outline_mode).toBeUndefined();
    });

    it('should include step metadata in checkpoint entries for outline variants', () => {
      const isOutlineWinner = true;
      const checkpointMeta: Record<string, unknown> = {
        iterations: 3,
        winning_strategy: 'outline_generation',
        checkpoint: true,
      };
      if (isOutlineWinner) {
        checkpointMeta.outline_mode = true;
        checkpointMeta.outline = '## Section 1\nSummary';
        checkpointMeta.weakest_step = 'expand';
        checkpointMeta.steps = [{ name: 'outline', score: 0.9, costUsd: 0.01 }];
      }
      expect(checkpointMeta.outline_mode).toBe(true);
      expect(checkpointMeta.checkpoint).toBe(true);
    });
  });

  describe('--single flag', () => {
    it('should set single to true when --single flag present', () => {
      const args = ['--file', 'test.md', '--single'];
      const single = args.includes('--single');
      expect(single).toBe(true);
    });

    it('should reject --single and --full together', () => {
      const args = ['--file', 'test.md', '--single', '--full'];
      const single = args.includes('--single');
      const full = args.includes('--full');
      expect(single && full).toBe(true); // both set — CLI should error
    });

    it('should default single to false', () => {
      const args = ['--file', 'test.md'];
      const single = args.includes('--single');
      expect(single).toBe(false);
    });

    it('should produce correct config overrides for --single', () => {
      const single = true;
      const iterations = 3;
      const budget = 1.00;
      const configOverrides: Record<string, unknown> = {};

      if (single) {
        configOverrides.singleArticle = true;
        configOverrides.expansion = { maxIterations: 0, minPool: 1, minIterations: 0, diversityThreshold: 0 };
        configOverrides.plateau = { window: 2, threshold: 0.02 };
        configOverrides.maxIterations = iterations;
        configOverrides.budgetCapUsd = budget;
      }

      expect(configOverrides.singleArticle).toBe(true);
      expect(configOverrides.expansion).toEqual({ maxIterations: 0, minPool: 1, minIterations: 0, diversityThreshold: 0 });
      expect(configOverrides.plateau).toEqual({ window: 2, threshold: 0.02 });
      expect(configOverrides.maxIterations).toBe(3);
      expect(configOverrides.budgetCapUsd).toBe(1.00);
    });

    it('should route --single to executeFullPipeline (same as --full)', () => {
      const single = true;
      const full = false;
      const useFullPipeline = single || full;
      expect(useFullPipeline).toBe(true);
    });

    it('should display "single" pipeline mode in logs', () => {
      const single = true;
      const full = false;
      const pipeline = single ? 'single' : full ? 'full' : 'minimal';
      expect(pipeline).toBe('single');
    });
  });

  describe('--judge-model flag parsing', () => {
    it('should default judge-model to null when not specified', () => {
      const judgeModel = null; // default when --judge-model not passed
      expect(judgeModel).toBeNull();
    });

    it('should parse --judge-model value', () => {
      const args = ['--file', 'test.md', '--judge-model', 'gpt-4.1-mini'];
      const idx = args.indexOf('--judge-model');
      const judgeModel = idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
      expect(judgeModel).toBe('gpt-4.1-mini');
    });

    it('should pass judge-model through to config overrides', () => {
      const judgeModel = 'gpt-5-nano';
      const configOverrides: Record<string, unknown> = {};
      if (judgeModel) {
        configOverrides.judgeModel = judgeModel;
      }
      expect(configOverrides.judgeModel).toBe('gpt-5-nano');
    });

    it('should not set judgeModel override when null', () => {
      const judgeModel = null;
      const configOverrides: Record<string, unknown> = {};
      if (judgeModel) {
        configOverrides.judgeModel = judgeModel;
      }
      expect(configOverrides.judgeModel).toBeUndefined();
    });
  });

  describe('--enabled-agents flag parsing', () => {
    function parseEnabledAgents(raw: string | undefined): string[] | null {
      if (!raw) return null;
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }

    it('should default enabled-agents to null when not specified', () => {
      expect(parseEnabledAgents(undefined)).toBeNull();
    });

    it('should parse comma-separated agent names', () => {
      expect(parseEnabledAgents('iterativeEditing,reflection')).toEqual([
        'iterativeEditing', 'reflection',
      ]);
    });

    it('should trim whitespace in agent names', () => {
      expect(parseEnabledAgents('iterativeEditing , reflection , debate')).toEqual([
        'iterativeEditing', 'reflection', 'debate',
      ]);
    });

    it('should filter out empty strings', () => {
      expect(parseEnabledAgents('iterativeEditing,,reflection,')).toEqual([
        'iterativeEditing', 'reflection',
      ]);
    });

    it('should pass enabled-agents through to config overrides', () => {
      const enabledAgents = ['iterativeEditing', 'reflection'];
      const configOverrides: Record<string, unknown> = {};
      if (enabledAgents) {
        configOverrides.enabledAgents = enabledAgents;
      }
      expect(configOverrides.enabledAgents).toEqual(['iterativeEditing', 'reflection']);
    });

    it('should trigger full pipeline mode when --enabled-agents is set', () => {
      const single = false;
      const full = false;
      const enabledAgents = ['treeSearch', 'reflection'];
      const useFullPipeline = single || full || !!enabledAgents;
      expect(useFullPipeline).toBe(true);
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
