// Shared utilities for agent implementations.
// Provides budget error handling for Promise.allSettled results.

import { BudgetExceededError } from '../types';

/** Re-throw BudgetExceededError from any rejected promise in a settled batch. */
export function rethrowBudgetErrors(results: PromiseSettledResult<unknown>[]): void {
  for (const r of results) {
    if (r.status === 'rejected' && r.reason instanceof BudgetExceededError) {
      throw r.reason;
    }
  }
}
