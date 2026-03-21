// V2 error classes extending V1's BudgetExceededError with partial results.

import type { TextVariation } from '../../types';
import { BudgetExceededError } from '../../types';

/** Thrown when budget is exceeded mid-generation but some variants were already produced. */
export class BudgetExceededWithPartialResults extends BudgetExceededError {
  constructor(
    public readonly partialVariants: TextVariation[],
    originalError: BudgetExceededError,
  ) {
    super(originalError.agentName, originalError.spent, originalError.reserved, originalError.cap);
    this.name = 'BudgetExceededWithPartialResults';
  }
}
