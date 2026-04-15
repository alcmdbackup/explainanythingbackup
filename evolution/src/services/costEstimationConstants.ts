// Pure constants for cost-estimation actions and their consumers.
// Lives outside costEstimationActions.ts because Next.js disallows non-function
// exports from `'use server'` files.

export const COST_ERROR_HISTOGRAM_BUCKETS = [
  { label: '<-25%',    min: -Infinity, max: -25 },
  { label: '-25..-5%', min: -25,       max: -5 },
  { label: '-5..+5%',  min: -5,        max: 5 },
  { label: '+5..+25%', min: 5,         max: 25 },
  { label: '>+25%',    min: 25,        max: Infinity },
] as const;
