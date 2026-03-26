// V2 error classes extending V1's BudgetExceededError with partial results.

import { BudgetExceededError } from '../../types';

/** Thrown when budget is exceeded mid-generation/ranking but some results were already produced. */
export class BudgetExceededWithPartialResults extends BudgetExceededError {
  constructor(
    public readonly partialData: unknown,
    originalError: BudgetExceededError,
  ) {
    super(originalError.agentName, originalError.spent, originalError.reserved, originalError.cap);
    this.name = 'BudgetExceededWithPartialResults';
  }
}
