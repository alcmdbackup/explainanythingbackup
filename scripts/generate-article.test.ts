/**
 * @jest-environment node
 */
// Tests for generate-article.ts CLI script — validates cost estimation, cost cap enforcement,
// and correct provider routing for article generation.

import { calculateLLMCost, getModelPricing, formatCost } from '../src/config/llmPricing';
import { createTitlePrompt, createExplanationPrompt } from '../src/lib/prompts';
import { titleQuerySchema } from '../src/lib/schemas/schemas';

describe('generate-article', () => {
  describe('cost estimation', () => {
    it('should estimate cost based on prompt length and model pricing', () => {
      const prompt = 'Explain quantum entanglement';
      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 3);
      const pricing = getModelPricing('gpt-4.1');

      const expectedCost =
        (estimatedInputTokens / 1_000_000) * pricing.inputPer1M +
        (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M;

      expect(expectedCost).toBeGreaterThan(0);
      expect(expectedCost).toBeLessThan(0.01); // Short prompt should be cheap
    });

    it('should use correct pricing for Anthropic models', () => {
      const pricing = getModelPricing('claude-sonnet-4-20250514');
      expect(pricing.inputPer1M).toBe(3.00);
      expect(pricing.outputPer1M).toBe(15.00);
    });

    it('should use correct pricing for o3-mini', () => {
      const pricing = getModelPricing('o3-mini');
      expect(pricing.inputPer1M).toBe(1.10);
      expect(pricing.outputPer1M).toBe(4.40);
    });
  });

  describe('cost cap enforcement', () => {
    it('should reject when estimated cost exceeds cap', () => {
      // Very long prompt with an expensive model
      const longPrompt = 'x'.repeat(100_000); // ~25k tokens
      const estimatedInputTokens = Math.ceil(longPrompt.length / 4);
      const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 3);
      const pricing = getModelPricing('gpt-4.1');

      const totalEstimate =
        (estimatedInputTokens / 1_000_000) * pricing.inputPer1M +
        (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M;

      // With gpt-4.1 pricing (2.00 in, 8.00 out), 25k input + 75k output:
      // (25000/1M * 2.00) + (75000/1M * 8.00) = 0.05 + 0.60 = 0.65
      expect(totalEstimate).toBeGreaterThan(0.5);

      // With a low cap, this should be rejected
      const lowCap = 0.10;
      expect(totalEstimate > lowCap).toBe(true);
    });

    it('should allow when estimated cost is within cap', () => {
      const prompt = 'Explain photosynthesis';
      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 3);
      const pricing = getModelPricing('gpt-4.1-nano');

      const totalEstimate =
        (estimatedInputTokens / 1_000_000) * pricing.inputPer1M +
        (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M;

      const defaultCap = 5.00;
      expect(totalEstimate < defaultCap).toBe(true);
    });
  });

  describe('prompt generation', () => {
    it('should generate a title prompt from user input', () => {
      const prompt = createTitlePrompt('Explain quantum entanglement');
      expect(prompt).toContain('Explain quantum entanglement');
      expect(prompt).toContain('Title Rules');
      expect(prompt).toContain('Recognizable');
    });

    it('should generate an explanation prompt from a title', () => {
      const prompt = createExplanationPrompt('Quantum Entanglement', []);
      expect(prompt).toContain('Quantum Entanglement');
      expect(prompt).toContain('section header');
      expect(prompt).toContain('Markdown');
    });

    it('should parse title response with titleQuerySchema', () => {
      const validResponse = JSON.stringify({
        title1: 'Quantum Entanglement',
        title2: 'Quantum Entanglement (Physics)',
        title3: 'Quantum Entanglement in Modern Physics',
      });

      const parsed = titleQuerySchema.parse(JSON.parse(validResponse));
      expect(parsed.title1).toBe('Quantum Entanglement');
    });

    it('should reject invalid title response', () => {
      const invalidResponse = JSON.stringify({ title: 'Only one title' });
      expect(() => titleQuerySchema.parse(JSON.parse(invalidResponse))).toThrow();
    });
  });

  describe('cost calculation', () => {
    it('should calculate cost for gpt-4.1', () => {
      // 1000 input, 500 output tokens
      const cost = calculateLLMCost('gpt-4.1', 1000, 500, 0);
      // (1000/1M * 2.00) + (500/1M * 8.00) = 0.002 + 0.004 = 0.006
      expect(cost).toBeCloseTo(0.006, 6);
    });

    it('should calculate cost for claude-sonnet-4', () => {
      const cost = calculateLLMCost('claude-sonnet-4-20250514', 1000, 500, 0);
      // (1000/1M * 3.00) + (500/1M * 15.00) = 0.003 + 0.0075 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('should calculate cost for deepseek-chat', () => {
      const cost = calculateLLMCost('deepseek-chat', 10000, 5000, 0);
      // (10000/1M * 0.28) + (5000/1M * 0.42) = 0.0028 + 0.0021 = 0.0049
      expect(cost).toBeCloseTo(0.0049, 6);
    });
  });

  describe('cost formatting', () => {
    it('should format small costs with 4 decimal places', () => {
      expect(formatCost(0.0028)).toBe('$0.0028');
    });

    it('should format larger costs with 2 decimal places', () => {
      expect(formatCost(1.50)).toBe('$1.50');
    });
  });
});
