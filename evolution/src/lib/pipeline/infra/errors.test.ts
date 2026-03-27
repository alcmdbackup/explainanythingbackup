// Tests for V2 error classes.

import { BudgetExceededError, BudgetExceededWithPartialResults } from '../../types';
import type { Variant } from '../../types';

describe('BudgetExceededWithPartialResults', () => {
  const originalError = new BudgetExceededError('generateAgent', 0.85, 0.1, 0.9);
  const partialVariants: Variant[] = [
    { text: 'Partial variant 1' } as Variant,
    { text: 'Partial variant 2' } as Variant,
  ];

  it('sets name to BudgetExceededWithPartialResults', () => {
    const err = new BudgetExceededWithPartialResults(partialVariants, originalError);
    expect(err.name).toBe('BudgetExceededWithPartialResults');
  });

  it('inherits BudgetExceededError properties (agentName, spent, reserved, cap)', () => {
    const err = new BudgetExceededWithPartialResults(partialVariants, originalError);
    expect(err.agentName).toBe('generateAgent');
    expect(err.spent).toBe(0.85);
    expect(err.reserved).toBe(0.1);
    expect(err.cap).toBe(0.9);
  });

  it('stores partialData and is instanceof both classes', () => {
    const err = new BudgetExceededWithPartialResults(partialVariants, originalError);
    expect(err.partialData).toBe(partialVariants);
    expect(err.partialData).toHaveLength(2);
    expect(err).toBeInstanceOf(BudgetExceededWithPartialResults);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toBeInstanceOf(Error);
  });
});
