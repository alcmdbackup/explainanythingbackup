/**
 * @jest-environment node
 */
// Tests for promptBankConfig.ts — validates config correctness: no duplicate prompts,
// difficulty distribution, domain coverage, model validity, and checkpoint ordering.

import {
  PROMPT_BANK,
  type Difficulty,
  type Domain,
  type MethodConfig,
} from './promptBankConfig';

describe('promptBankConfig', () => {
  describe('prompts', () => {
    it('should have exactly 5 prompts', () => {
      expect(PROMPT_BANK.prompts).toHaveLength(5);
    });

    it('should have no duplicate prompts', () => {
      const normalized = PROMPT_BANK.prompts.map((p) =>
        p.prompt.toLowerCase().trim(),
      );
      expect(new Set(normalized).size).toBe(normalized.length);
    });

    it('should have all non-empty prompt text', () => {
      for (const p of PROMPT_BANK.prompts) {
        expect(p.prompt.trim().length).toBeGreaterThan(0);
      }
    });

    it('should have difficulty distribution 1 easy / 2 medium / 2 hard', () => {
      const counts: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
      for (const p of PROMPT_BANK.prompts) {
        counts[p.difficulty]++;
      }
      expect(counts.easy).toBe(1);
      expect(counts.medium).toBe(2);
      expect(counts.hard).toBe(2);
    });

    it('should cover all 5 domains', () => {
      const domains = new Set(PROMPT_BANK.prompts.map((p) => p.domain));
      const expected: Domain[] = ['science', 'history', 'technology', 'economics', 'philosophy'];
      expect(domains.size).toBe(5);
      for (const d of expected) {
        expect(domains.has(d)).toBe(true);
      }
    });

    it('should have one prompt per domain', () => {
      const domainCounts = new Map<Domain, number>();
      for (const p of PROMPT_BANK.prompts) {
        domainCounts.set(p.domain, (domainCounts.get(p.domain) ?? 0) + 1);
      }
      for (const [, count] of domainCounts) {
        expect(count).toBe(1);
      }
    });
  });

  describe('methods', () => {
    it('should have 4 methods total', () => {
      expect(PROMPT_BANK.methods).toHaveLength(4);
    });

    it('should have 3 oneshot and 1 evolution methods', () => {
      const oneshot = PROMPT_BANK.methods.filter((m) => m.type === 'oneshot');
      const evolution = PROMPT_BANK.methods.filter((m) => m.type === 'evolution');
      expect(oneshot).toHaveLength(3);
      expect(evolution).toHaveLength(1);
    });

    it('should have no duplicate labels', () => {
      const labels = PROMPT_BANK.methods.map((m) => m.label);
      expect(new Set(labels).size).toBe(labels.length);
    });

    it('should have valid model names for oneshot methods', () => {
      const knownModels = ['gpt-4.1-mini', 'gpt-4.1', 'deepseek-chat'];
      const oneshotMethods = PROMPT_BANK.methods.filter(
        (m): m is Extract<MethodConfig, { type: 'oneshot' }> => m.type === 'oneshot',
      );
      for (const m of oneshotMethods) {
        expect(knownModels).toContain(m.model);
      }
    });

    it('should have checkpoints sorted ascending for evolution methods', () => {
      const evoMethods = PROMPT_BANK.methods.filter(
        (m): m is Extract<MethodConfig, { type: 'evolution' }> => m.type === 'evolution',
      );
      for (const m of evoMethods) {
        expect(m.checkpoints.length).toBeGreaterThan(0);
        for (let i = 1; i < m.checkpoints.length; i++) {
          expect(m.checkpoints[i]).toBeGreaterThan(m.checkpoints[i - 1]);
        }
      }
    });

    it('should have valid mode for evolution methods', () => {
      const evoMethods = PROMPT_BANK.methods.filter(
        (m): m is Extract<MethodConfig, { type: 'evolution' }> => m.type === 'evolution',
      );
      for (const m of evoMethods) {
        expect(['minimal', 'full']).toContain(m.mode);
      }
    });
  });

  describe('comparison config', () => {
    it('should have a judge model', () => {
      expect(PROMPT_BANK.comparison.judgeModel.length).toBeGreaterThan(0);
    });

    it('should have positive rounds count', () => {
      expect(PROMPT_BANK.comparison.rounds).toBeGreaterThan(0);
    });
  });
});
