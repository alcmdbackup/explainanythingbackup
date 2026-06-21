// Integration test for paragraph_recombine_with_coherence_pass — verifies the
// data-flow between iterationConfigSchema (Zod), normalizeIteration (default
// folding + FIELD_GATES stripping), and hashStrategyConfig (config_hash dedup).
//
// LLM is not invoked; this test covers schema → normalize → hash composition
// across the 5 new coherence-pass-only fields and the conditional
// perInvocationCapUsd default. No DB writes.
//
// Per Verification section of:
// docs/planning/paragraph_recombine_agent_with_coherence_pass_evolution_20260620/
//   paragraph_recombine_agent_with_coherence_pass_evolution_20260620_planning.md

import { iterationConfigSchema, strategyConfigSchema } from '@evolution/lib/schemas';
import { hashStrategyConfig } from '@evolution/lib/pipeline/setup/findOrCreateStrategy';

function baseStrategyConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    generationModel: 'gpt-4.1-nano',
    judgeModel: 'gpt-4.1-nano',
    budgetUsd: 0.05,
    iterationConfigs: [
      {
        agentType: 'paragraph_recombine_with_coherence_pass',
        budgetPercent: 100,
      },
    ],
    ...overrides,
  };
}

describe('paragraph_recombine_with_coherence_pass — schema + normalize + hash integration', () => {
  describe('iterationConfigSchema', () => {
    it('accepts the new agent type with no coherence-pass fields (all optional)', () => {
      const parsed = iterationConfigSchema.safeParse({
        agentType: 'paragraph_recombine_with_coherence_pass',
        budgetPercent: 100,
      });
      expect(parsed.success).toBe(true);
    });

    it('accepts all 5 coherence-pass fields when present + valid', () => {
      const parsed = iterationConfigSchema.safeParse({
        agentType: 'paragraph_recombine_with_coherence_pass',
        budgetPercent: 100,
        coherencePassEnabled: true,
        coherencePassProposerModel: 'gpt-4.1-nano',
        coherencePassApproverModel: 'gpt-4.1-nano',
        coherencePassRewriteTempFloor: 0.6,
        coherencePassRewriteTempCeiling: 1.0,
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects coherencePassEnabled when agentType is paragraph_recombine (sibling)', () => {
      const parsed = iterationConfigSchema.safeParse({
        agentType: 'paragraph_recombine',
        budgetPercent: 100,
        coherencePassEnabled: true,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.message.includes('coherencePassEnabled only valid'))).toBe(true);
      }
    });

    it('rejects coherencePassProposerModel on a non-coherence-pass agent', () => {
      const parsed = iterationConfigSchema.safeParse({
        agentType: 'generate',
        budgetPercent: 100,
        coherencePassProposerModel: 'gpt-4.1-nano',
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects coherencePassRewriteTempCeiling < coherencePassRewriteTempFloor (cross-field)', () => {
      const parsed = iterationConfigSchema.safeParse({
        agentType: 'paragraph_recombine_with_coherence_pass',
        budgetPercent: 100,
        coherencePassRewriteTempFloor: 1.0,
        coherencePassRewriteTempCeiling: 0.5,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.message.includes('must be >= coherencePassRewriteTempFloor'))).toBe(true);
      }
    });

    it('accepts ceiling === floor (boundary case)', () => {
      const parsed = iterationConfigSchema.safeParse({
        agentType: 'paragraph_recombine_with_coherence_pass',
        budgetPercent: 100,
        coherencePassRewriteTempFloor: 0.8,
        coherencePassRewriteTempCeiling: 0.8,
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects coherencePassRewriteTempFloor outside [0, 2] range', () => {
      const tooLow = iterationConfigSchema.safeParse({
        agentType: 'paragraph_recombine_with_coherence_pass',
        budgetPercent: 100,
        coherencePassRewriteTempFloor: -0.1,
      });
      expect(tooLow.success).toBe(false);

      const tooHigh = iterationConfigSchema.safeParse({
        agentType: 'paragraph_recombine_with_coherence_pass',
        budgetPercent: 100,
        coherencePassRewriteTempFloor: 2.1,
      });
      expect(tooHigh.success).toBe(false);
    });
  });

  describe('hashStrategyConfig — config_hash dedup behavior', () => {
    it('hashes coherencePassEnabled=true and omitted-default identically (omitted ≡ default)', () => {
      const parsedWith = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              coherencePassEnabled: true,
            },
          ],
        }),
      );
      const parsedWithout = strategyConfigSchema.parse(baseStrategyConfig());
      expect(hashStrategyConfig(parsedWith)).toBe(hashStrategyConfig(parsedWithout));
    });

    it('hashes coherencePassEnabled=true vs coherencePassEnabled=false DISTINCTLY (A/B design)', () => {
      const parsedTrue = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              coherencePassEnabled: true,
            },
          ],
        }),
      );
      const parsedFalse = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              coherencePassEnabled: false,
            },
          ],
        }),
      );
      expect(hashStrategyConfig(parsedTrue)).not.toBe(hashStrategyConfig(parsedFalse));
    });

    it('paragraph_recombine_with_coherence_pass and paragraph_recombine produce DISTINCT hashes', () => {
      const newAgent = strategyConfigSchema.parse(baseStrategyConfig());
      const oldAgent = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [{ agentType: 'paragraph_recombine', budgetPercent: 100 }],
        }),
      );
      expect(hashStrategyConfig(newAgent)).not.toBe(hashStrategyConfig(oldAgent));
    });

    it('coherencePassEnabled=false produces same hash whether perInvocationCapUsd is omitted or set to the conditional default ($0.05)', () => {
      // normalizeIteration folds: coherencePassEnabled=false → perInvocationCapUsd default = 0.05
      const omitted = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              coherencePassEnabled: false,
            },
          ],
        }),
      );
      const explicit = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              coherencePassEnabled: false,
              perInvocationCapUsd: 0.05,
            },
          ],
        }),
      );
      expect(hashStrategyConfig(omitted)).toBe(hashStrategyConfig(explicit));
    });

    it('coherencePassEnabled=true produces same hash whether perInvocationCapUsd is omitted or set to the conditional default ($0.10)', () => {
      // normalizeIteration folds: coherencePassEnabled=true → perInvocationCapUsd default = 0.10
      const omitted = strategyConfigSchema.parse(baseStrategyConfig());
      const explicit = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              perInvocationCapUsd: 0.10,
            },
          ],
        }),
      );
      expect(hashStrategyConfig(omitted)).toBe(hashStrategyConfig(explicit));
    });

    it('hashes differ when coherencePassProposerModel differs', () => {
      const a = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              coherencePassProposerModel: 'gpt-4.1-nano',
            },
          ],
        }),
      );
      const b = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              coherencePassProposerModel: 'gpt-4.1-mini',
            },
          ],
        }),
      );
      expect(hashStrategyConfig(a)).not.toBe(hashStrategyConfig(b));
    });

    it('hashes differ when coherencePassRewriteTempFloor differs', () => {
      const a = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              coherencePassRewriteTempFloor: 0.6,
            },
          ],
        }),
      );
      const b = strategyConfigSchema.parse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine_with_coherence_pass',
              budgetPercent: 100,
              coherencePassRewriteTempFloor: 0.8,
            },
          ],
        }),
      );
      expect(hashStrategyConfig(a)).not.toBe(hashStrategyConfig(b));
    });
  });

  describe('FIELD_GATES — stripping ignored fields on non-coherence-pass agent types', () => {
    // FIELD_GATES strips fields the runtime ignores for a given agentType. Schema
    // already rejects coherence-pass fields on other agents, so the canonical
    // path is "schema rejects upstream". This test pins that contract.
    it('schema rejects strategy with coherencePassRewriteTempCeiling on paragraph_recombine — gate not even reached', () => {
      const parsed = strategyConfigSchema.safeParse(
        baseStrategyConfig({
          iterationConfigs: [
            {
              agentType: 'paragraph_recombine',
              budgetPercent: 100,
              coherencePassRewriteTempCeiling: 1.2,
            },
          ],
        }),
      );
      expect(parsed.success).toBe(false);
    });
  });
});
