// Shared factory for creating TextVariation objects, eliminating duplication across 6+ agents.
import { v4 as uuidv4 } from 'uuid';
import type { TextVariation } from '../types';

interface CreateTextVariationParams {
  text: string;
  strategy: string;
  iterationBorn: number;
  parentIds?: string[];
  version?: number;
  /** Optional cost in USD for per-variant attribution. */
  costUsd?: number;
}

export function createTextVariation(params: CreateTextVariationParams): TextVariation {
  return {
    id: uuidv4(),
    text: params.text,
    strategy: params.strategy,
    iterationBorn: params.iterationBorn,
    parentIds: params.parentIds ?? [],
    version: params.version ?? 0,
    createdAt: Date.now() / 1000,
    ...(params.costUsd !== undefined && { costUsd: params.costUsd }),
  };
}
