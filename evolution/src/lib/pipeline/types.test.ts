// Type-level assertions verifying V2 types match spec and are distinct from V1.

import { expectTypeOf } from 'expect-type';
import type { TextVariation as V1TextVariation, Match as V1Match } from '../types';
import type { StrategyConfig as V1StrategyConfig } from '../shared/strategyConfig';
import type {
  TextVariation,
  Rating,
  V2Match,
  EvolutionConfig,
  EvolutionResult,
  V2StrategyConfig,
} from './types';

describe('V2 types', () => {
  it('TextVariation is identical to V1', () => {
    expectTypeOf<TextVariation>().toEqualTypeOf<V1TextVariation>();
  });

  it('Rating has mu and sigma', () => {
    expectTypeOf<Rating>().toHaveProperty('mu');
    expectTypeOf<Rating>().toHaveProperty('sigma');
  });

  it('EvolutionConfig has all required fields', () => {
    expectTypeOf<EvolutionConfig>().toHaveProperty('iterations');
    expectTypeOf<EvolutionConfig>().toHaveProperty('budgetUsd');
    expectTypeOf<EvolutionConfig>().toHaveProperty('judgeModel');
    expectTypeOf<EvolutionConfig>().toHaveProperty('generationModel');
  });

  it('EvolutionConfig optional fields are optional', () => {
    const config: EvolutionConfig = {
      iterations: 5,
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
    expectTypeOf<EvolutionResult>().toHaveProperty('muHistory');
    expectTypeOf<EvolutionResult>().toHaveProperty('diversityHistory');
  });

  it('V2Match is NOT assignable to V1 Match', () => {
    expectTypeOf<V2Match>().not.toEqualTypeOf<V1Match>();
  });

  it('V2StrategyConfig is NOT assignable to V1 StrategyConfig', () => {
    expectTypeOf<V2StrategyConfig>().not.toEqualTypeOf<V1StrategyConfig>();
  });
});
