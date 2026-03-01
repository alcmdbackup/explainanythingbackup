// Zod schemas for LLM cost security tables (daily_cost_rollups and llm_cost_config).
import { z } from 'zod';

export const dailyCostRollupSchema = z.object({
  date: z.string(), // DATE as ISO string
  category: z.enum(['evolution', 'non_evolution']),
  total_cost_usd: z.number().nonnegative(),
  reserved_usd: z.number().nonnegative(),
  call_count: z.number().int().nonnegative(),
});

export type DailyCostRollup = z.infer<typeof dailyCostRollupSchema>;

export const llmCostConfigSchema = z.object({
  key: z.string(),
  value: z.object({ value: z.union([z.number(), z.boolean()]) }),
  updated_at: z.string().optional(),
  updated_by: z.string().nullable().optional(),
});

export type LlmCostConfig = z.infer<typeof llmCostConfigSchema>;

export const checkBudgetResultSchema = z.object({
  allowed: z.boolean(),
  daily_total: z.number(),
  daily_cap: z.number(),
  reserved: z.number(),
});

export type CheckBudgetResult = z.infer<typeof checkBudgetResultSchema>;
