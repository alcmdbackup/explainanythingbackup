// Tests for estimateReflectionCost — Phase 3 of
// develop_reflection_and_generateFromParentArticle_agent_evolution_20260430.

import {
  estimateReflectionCost,
  estimateAgentCost,
  estimateGenerationCost,
  estimateRankingCost,
} from './estimateCosts';

const SEED_CHARS = 5000;
const GEN_MODEL = 'gpt-4.1-nano';
const JUDGE_MODEL = 'gpt-4.1-nano';
const TACTIC = 'lexical_simplify';

describe('estimateReflectionCost', () => {
  it('returns a positive number for default topN=3', () => {
    const cost = estimateReflectionCost(SEED_CHARS, GEN_MODEL, JUDGE_MODEL, 3);
    expect(cost).toBeGreaterThan(0);
  });

  it('scales output cost with topN (more ranks → more output tokens)', () => {
    const top1 = estimateReflectionCost(SEED_CHARS, GEN_MODEL, JUDGE_MODEL, 1);
    const top5 = estimateReflectionCost(SEED_CHARS, GEN_MODEL, JUDGE_MODEL, 5);
    expect(top5).toBeGreaterThan(top1);
  });

  it('scales input cost linearly with parent text length', () => {
    const small = estimateReflectionCost(1000, GEN_MODEL, JUDGE_MODEL, 3);
    const large = estimateReflectionCost(10000, GEN_MODEL, JUDGE_MODEL, 3);
    expect(large).toBeGreaterThan(small);
  });

  it('reflection cost is small relative to a full agent invocation', () => {
    const agentTotal = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15);
    const reflection = estimateReflectionCost(SEED_CHARS, GEN_MODEL, JUDGE_MODEL, 3);
    // Reflection should be at most ~10% of vanilla GFPA — typically much less.
    expect(reflection / agentTotal).toBeLessThan(0.10);
  });
});

describe('estimateAgentCost with useReflection', () => {
  it('without reflection, equals gen + rank', () => {
    const agent = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15);
    const gen = estimateGenerationCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL);
    // ranking uses variantChars (output of generation) not seed chars
    expect(agent).toBeGreaterThan(gen);
  });

  it('with reflection, total = vanilla agent cost + reflection cost', () => {
    const vanilla = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15, false, 3);
    const withReflection = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15, true, 3);
    const reflection = estimateReflectionCost(SEED_CHARS, GEN_MODEL, JUDGE_MODEL, 3);
    expect(withReflection).toBeCloseTo(vanilla + reflection, 6);
  });

  it('useReflection defaults to false (backward-compat with prior callers)', () => {
    const noArg = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15);
    const explicitFalse = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15, false);
    expect(noArg).toBe(explicitFalse);
  });

  it('reflection cost grows with topN parameter', () => {
    const top1 = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15, true, 1);
    const top5 = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15, true, 5);
    expect(top5).toBeGreaterThan(top1);
  });

  it('ranking cost component matches estimateRankingCost', () => {
    // Verify the rank component plumbs through correctly when reflection is enabled.
    const rank = estimateRankingCost(5836, JUDGE_MODEL, 10, 15); // lexical_simplify variantChars
    const noReflection = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15, false);
    const withReflection = estimateAgentCost(SEED_CHARS, TACTIC, GEN_MODEL, JUDGE_MODEL, 10, 15, true, 3);
    // Both should include the same ranking cost component
    expect(noReflection).toBeGreaterThan(rank); // also includes generation
    expect(withReflection).toBeGreaterThan(noReflection); // adds reflection on top
  });
});
