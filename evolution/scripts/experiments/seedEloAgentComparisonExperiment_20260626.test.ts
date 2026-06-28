// Unit tests for the 9-arm seed-script config builder
// (design_elo_improvement_experiment_20260626 Phase 2).
import { buildConfig } from './seedEloAgentComparisonExperiment_20260626';
import { hashStrategyConfig } from '../../src/lib/pipeline/setup/findOrCreateStrategy';

type Arm = Parameters<typeof buildConfig>[0];
const ARMS: Arm[] = [
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

describe('seedEloAgentComparison buildConfig', () => {
  it('every arm is a single iteration off the seed at 100% budget', () => {
    for (const arm of ARMS) {
      const cfg = buildConfig(arm) as unknown as {
        iterationConfigs: { agentType: string; sourceMode: string; budgetPercent: number }[];
        budgetUsd: number;
        generationModel: string;
        judgeModel: string;
      };
      expect(cfg.iterationConfigs).toHaveLength(1);
      expect(cfg.iterationConfigs[0]!.agentType).toBe(arm);
      expect(cfg.iterationConfigs[0]!.sourceMode).toBe('seed');
      expect(cfg.iterationConfigs[0]!.budgetPercent).toBe(100);
    }
  });

  it('holds budget + models constant across all arms (apples-to-apples)', () => {
    const budgets = new Set<number>();
    const models = new Set<string>();
    for (const arm of ARMS) {
      const cfg = buildConfig(arm) as unknown as { budgetUsd: number; generationModel: string; judgeModel: string };
      budgets.add(cfg.budgetUsd);
      models.add(`${cfg.generationModel}|${cfg.judgeModel}`);
    }
    expect(budgets.size).toBe(1);
    expect(models.size).toBe(1);
  });

  it('produces a distinct config_hash for each arm (no two arms collide)', () => {
    const hashes = ARMS.map((a) => hashStrategyConfig(buildConfig(a)));
    expect(new Set(hashes).size).toBe(ARMS.length);
  });

  it('criteria arms carry criteriaIds+weakestK; non-criteria arms do not', () => {
    const criteriaArms = new Set([
      'criteria_and_generate',
      'single_pass_evaluate_criteria_and_generate',
      'proposer_approver_criteria_generate',
    ]);
    for (const arm of ARMS) {
      const iter = (buildConfig(arm) as unknown as { iterationConfigs: Record<string, unknown>[] }).iterationConfigs[0]!;
      if (criteriaArms.has(arm)) {
        expect(Array.isArray(iter.criteriaIds)).toBe(true);
        expect(iter.weakestK).toBe(2);
      } else {
        expect(iter.criteriaIds).toBeUndefined();
      }
    }
  });

  it('paragraph arms carry maxDispatches to fill budget', () => {
    for (const arm of ['paragraph_recombine', 'paragraph_recombine_with_coherence_pass'] as Arm[]) {
      const iter = (buildConfig(arm) as unknown as { iterationConfigs: Record<string, unknown>[] }).iterationConfigs[0]!;
      expect(iter.maxDispatches).toBe(10);
    }
  });

  it('#3: paragraph arms use a reliable coordinatorModel (flash-lite fails coordinator JSON)', () => {
    for (const arm of ['paragraph_recombine', 'paragraph_recombine_with_coherence_pass'] as Arm[]) {
      const cfg = buildConfig(arm) as unknown as { coordinatorModel?: string };
      expect(cfg.coordinatorModel).toBe('gpt-4.1-nano');
    }
    // Non-paragraph arms don't set it.
    expect((buildConfig('generate') as unknown as { coordinatorModel?: string }).coordinatorModel).toBeUndefined();
  });
});
