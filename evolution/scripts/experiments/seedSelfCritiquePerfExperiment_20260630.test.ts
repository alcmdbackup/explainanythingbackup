// Unit tests for the self_critique_revise append-only seed script
// (analyze_performance_self_critique_agent_20260630 Phase 6). Mirrors
// seedEloAgentComparisonExperiment_20260626.test.ts.
import {
  buildConfig,
  validateArgs,
  ARM,
  BASE,
  HARD_CAP_USD,
  BUDGET_USD_PER_RUN,
  SISTER_EXPERIMENT_ID,
  SISTER_ARENA_PROMPT_ID,
} from './seedSelfCritiquePerfExperiment_20260630';
import { buildConfig as buildSisterConfig } from './seedEloAgentComparisonExperiment_20260626';
import { hashStrategyConfig } from '../../src/lib/pipeline/setup/findOrCreateStrategy';

type SisterArm = Parameters<typeof buildSisterConfig>[0];
const SISTER_ARMS: SisterArm[] = [
  'generate',
  'reflect_and_generate',
  'criteria_and_generate',
  'single_pass_evaluate_criteria_and_generate',
  'proposer_approver_criteria_generate',
  'iterative_editing',
  'iterative_editing_rewrite',
  'paragraph_recombine',
  'paragraph_recombine_with_coherence_pass',
];

describe('seedSelfCritiquePerf buildConfig', () => {
  it('exposes agentType=self_critique_revise on a single seed iteration at 100% budget', () => {
    const cfg = buildConfig() as unknown as {
      iterationConfigs: { agentType: string; sourceMode: string; budgetPercent: number }[];
    };
    expect(cfg.iterationConfigs).toHaveLength(1);
    expect(cfg.iterationConfigs[0]!.agentType).toBe('self_critique_revise');
    expect(ARM).toBe('self_critique_revise');
    expect(cfg.iterationConfigs[0]!.sourceMode).toBe('seed');
    expect(cfg.iterationConfigs[0]!.budgetPercent).toBe(100);
  });

  it('matches sister BASE constants verbatim (apples-to-apples)', () => {
    // Reference: seedEloAgentComparisonExperiment_20260626.ts:112-117.
    expect(BASE.generationModel).toBe('google/gemini-2.5-flash-lite');
    expect(BASE.judgeModel).toBe('google/gemini-2.5-flash-lite');
    expect(BASE.generationTemperature).toBe(1);
    expect(BASE.budgetUsd).toBe(0.10);
    expect(BASE.maxComparisonsPerVariant).toBe(3);
    expect(BUDGET_USD_PER_RUN).toBe(0.10);
  });

  it('config hash is distinct from every sister arm (no accidental collision)', () => {
    const myHash = hashStrategyConfig(buildConfig());
    const sisterHashes = SISTER_ARMS.map((a) => hashStrategyConfig(buildSisterConfig(a)));
    for (const h of sisterHashes) {
      expect(myHash).not.toBe(h);
    }
    // Sanity: sister hashes are also all distinct.
    expect(new Set(sisterHashes).size).toBe(SISTER_ARMS.length);
  });

  it('does NOT carry criteria_ids / weakestK (self_critique has no criteria dependency)', () => {
    const iter = (buildConfig() as unknown as { iterationConfigs: Record<string, unknown>[] }).iterationConfigs[0]!;
    expect(iter.criteriaIds).toBeUndefined();
    expect(iter.weakestK).toBeUndefined();
    expect(iter.maxDispatches).toBeUndefined();
  });
});

describe('seedSelfCritiquePerf constants', () => {
  it('SISTER_EXPERIMENT_ID and SISTER_ARENA_PROMPT_ID are the exact UUIDs from the promoted EAR', () => {
    // Reference: docs/analysis/elo-agent-comparison-federal-reserve-2-20260628/*.md header.
    expect(SISTER_EXPERIMENT_ID).toBe('bc10c2e0-a51c-41a8-a2c3-34577a1fa489');
    expect(SISTER_ARENA_PROMPT_ID).toBe('6f5c85e5-0d6f-42f3-ba91-cbf2377f2317');
  });

  it('HARD_CAP_USD is set and leaves headroom above sister actual spend', () => {
    // Sister spent ~$8.27 (per dataset.csv total_spent_usd). Cap must exceed that
    // to allow ANY append, and must be finite/positive.
    expect(HARD_CAP_USD).toBeGreaterThan(8.27);
    expect(HARD_CAP_USD).toBeLessThan(50); // guard against a typo like 5000
  });
});

describe('seedSelfCritiquePerf validateArgs', () => {
  it('accepts --target staging without --i-know-this-is-prod', () => {
    expect(() => validateArgs(['node', 'seed.ts', '--target', 'staging', '--apply'])).not.toThrow();
  });

  it('rejects --target prod without --i-know-this-is-prod', () => {
    expect(() => validateArgs(['node', 'seed.ts', '--target', 'prod', '--apply'])).toThrow(/--i-know-this-is-prod/);
  });

  it('accepts --target prod WITH --i-know-this-is-prod', () => {
    expect(() =>
      validateArgs(['node', 'seed.ts', '--target', 'prod', '--i-know-this-is-prod', '--apply']),
    ).not.toThrow();
  });

  it('rejects missing --target', () => {
    expect(() => validateArgs(['node', 'seed.ts', '--apply'])).toThrow(/Missing\/invalid --target/);
  });

  it('rejects invalid --target', () => {
    expect(() => validateArgs(['node', 'seed.ts', '--target', 'gamma', '--apply'])).toThrow(/Missing\/invalid --target/);
  });
});
