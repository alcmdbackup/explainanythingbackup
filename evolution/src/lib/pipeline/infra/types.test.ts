// Type-level assertions verifying V2 types match spec and are distinct from V1.

import { expectTypeOf } from 'expect-type';
import type { Variant as V1Variant, Match as V1Match } from '../../types';
import type { StrategyHashInput as V1StrategyConfig } from '../../shared/hashStrategyConfig';
import type {
  Variant,
  Rating,
  V2Match,
  EvolutionConfig,
  EvolutionResult,
  StrategyConfig,
} from './types';

describe('V2 types', () => {
  it('Variant is identical to V1', () => {
    expectTypeOf<Variant>().toEqualTypeOf<V1Variant>();
  });

  it('Rating has elo and uncertainty', () => {
    expectTypeOf<Rating>().toHaveProperty('elo');
    expectTypeOf<Rating>().toHaveProperty('uncertainty');
  });

  it('EvolutionConfig has all required fields', () => {
    expectTypeOf<EvolutionConfig>().toHaveProperty('iterationConfigs');
    expectTypeOf<EvolutionConfig>().toHaveProperty('budgetUsd');
    expectTypeOf<EvolutionConfig>().toHaveProperty('judgeModel');
    expectTypeOf<EvolutionConfig>().toHaveProperty('generationModel');
  });

  it('EvolutionConfig optional fields are optional', () => {
    const config: EvolutionConfig = {
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
      budgetUsd: 1.0,
      judgeModel: 'gpt-4.1-nano',
      generationModel: 'gpt-4.1-mini',
    };
    expect(config.strategiesPerRound).toBeUndefined();
    expect(config.calibrationOpponents).toBeUndefined();
    expect(config.tournamentTopK).toBeUndefined();
  });

  it('EvolutionResult has all fields', () => {
    expectTypeOf<EvolutionResult>().toHaveProperty('winner');
    expectTypeOf<EvolutionResult>().toHaveProperty('pool');
    expectTypeOf<EvolutionResult>().toHaveProperty('ratings');
    expectTypeOf<EvolutionResult>().toHaveProperty('matchHistory');
    expectTypeOf<EvolutionResult>().toHaveProperty('totalCost');
    expectTypeOf<EvolutionResult>().toHaveProperty('iterationsRun');
    expectTypeOf<EvolutionResult>().toHaveProperty('stopReason');
    expectTypeOf<EvolutionResult>().toHaveProperty('eloHistory');
    expectTypeOf<EvolutionResult>().toHaveProperty('diversityHistory');
  });

  it('V2Match is NOT assignable to V1 Match', () => {
    expectTypeOf<V2Match>().not.toEqualTypeOf<V1Match>();
  });

  it('StrategyConfig is NOT assignable to V1 StrategyConfig', () => {
    expectTypeOf<StrategyConfig>().not.toEqualTypeOf<V1StrategyConfig>();
  });
});
