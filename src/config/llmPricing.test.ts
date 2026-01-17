/**
 * Unit tests for LLM pricing configuration.
 * Tests cost calculation accuracy.
 */

import {
  getModelPricing,
  calculateLLMCost,
  formatCost,
  LLM_PRICING
} from './llmPricing';

describe('LLM Pricing', () => {
  describe('getModelPricing', () => {
    it('should return exact match pricing', () => {
      const pricing = getModelPricing('gpt-4o');
      expect(pricing.inputPer1M).toBe(2.50);
      expect(pricing.outputPer1M).toBe(10.00);
    });

    it('should return pricing for versioned model', () => {
      const pricing = getModelPricing('gpt-4o-2024-11-20');
      expect(pricing.inputPer1M).toBe(2.50);
    });

    it('should return pricing with prefix match', () => {
      // Should match gpt-4o prefix
      const pricing = getModelPricing('gpt-4o-some-future-version');
      expect(pricing.inputPer1M).toBe(2.50);
    });

    it('should return default pricing for unknown model', () => {
      const pricing = getModelPricing('unknown-model-xyz');
      expect(pricing.inputPer1M).toBe(10.00);
      expect(pricing.outputPer1M).toBe(30.00);
    });

    it('should return reasoning pricing for o1 models', () => {
      const pricing = getModelPricing('o1');
      expect(pricing.reasoningPer1M).toBe(60.00);
    });
  });

  describe('calculateLLMCost', () => {
    it('should calculate cost correctly for gpt-4o', () => {
      // 1000 input tokens + 500 output tokens
      // (1000/1M * 2.50) + (500/1M * 10.00) = 0.0025 + 0.005 = 0.0075
      const cost = calculateLLMCost('gpt-4o', 1000, 500);
      expect(cost).toBeCloseTo(0.0075, 6);
    });

    it('should calculate cost correctly for gpt-4o-mini', () => {
      // 10000 input + 5000 output
      // (10000/1M * 0.15) + (5000/1M * 0.60) = 0.0015 + 0.003 = 0.0045
      const cost = calculateLLMCost('gpt-4o-mini', 10000, 5000);
      expect(cost).toBeCloseTo(0.0045, 6);
    });

    it('should include reasoning tokens for o1 models', () => {
      // 1000 input + 500 output + 2000 reasoning
      // (1000/1M * 15) + (500/1M * 60) + (2000/1M * 60) = 0.015 + 0.03 + 0.12 = 0.165
      const cost = calculateLLMCost('o1', 1000, 500, 2000);
      expect(cost).toBeCloseTo(0.165, 6);
    });

    it('should handle zero tokens', () => {
      const cost = calculateLLMCost('gpt-4o', 0, 0, 0);
      expect(cost).toBe(0);
    });

    it('should handle large token counts', () => {
      // 1M input + 1M output for gpt-4o
      // (1M/1M * 2.50) + (1M/1M * 10.00) = 2.50 + 10.00 = 12.50
      const cost = calculateLLMCost('gpt-4o', 1000000, 1000000);
      expect(cost).toBeCloseTo(12.5, 2);
    });

    it('should round to 6 decimal places', () => {
      const cost = calculateLLMCost('gpt-4o', 1, 1);
      // Very small number, should have at most 6 decimal places
      expect(cost.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(6);
    });
  });

  describe('formatCost', () => {
    it('should format small costs with 4 decimal places', () => {
      expect(formatCost(0.0001)).toBe('$0.0001');
      expect(formatCost(0.0099)).toBe('$0.0099');
    });

    it('should format regular costs with 2 decimal places', () => {
      expect(formatCost(0.01)).toBe('$0.01');
      expect(formatCost(1.50)).toBe('$1.50');
      expect(formatCost(100.00)).toBe('$100.00');
    });
  });

  describe('LLM_PRICING configuration', () => {
    it('should have pricing for major OpenAI models', () => {
      expect(LLM_PRICING['gpt-4o']).toBeDefined();
      expect(LLM_PRICING['gpt-4o-mini']).toBeDefined();
      expect(LLM_PRICING['gpt-4-turbo']).toBeDefined();
      expect(LLM_PRICING['gpt-3.5-turbo']).toBeDefined();
    });

    it('should have pricing for o1 models with reasoning', () => {
      expect(LLM_PRICING['o1']).toBeDefined();
      expect(LLM_PRICING['o1'].reasoningPer1M).toBeDefined();
      expect(LLM_PRICING['o1-mini']).toBeDefined();
    });

    it('should have pricing for Claude models', () => {
      expect(LLM_PRICING['claude-3-5-sonnet-20241022']).toBeDefined();
      expect(LLM_PRICING['claude-3-opus-20240229']).toBeDefined();
      expect(LLM_PRICING['claude-3-haiku-20240307']).toBeDefined();
    });

    it('should have output pricing >= input pricing for all models', () => {
      for (const [model, pricing] of Object.entries(LLM_PRICING)) {
        expect(pricing.outputPer1M).toBeGreaterThanOrEqual(pricing.inputPer1M);
      }
    });
  });
});
