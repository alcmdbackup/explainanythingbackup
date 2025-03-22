import { z } from 'zod';

/**
 * Base schema for LLM query data
 * @example
 * {
 *   title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants..."
 * }
 */
export const llmQuerySchema = z.object({
    title: z.string(),
    content: z.string(),
});

/**
 * Schema for inserting search data, extends llmQuerySchema with user query
 * @example
 * {
 *   user_query: "How does photosynthesis work?",
 *   title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants..."
 * }
 */
export const searchInsertSchema = llmQuerySchema.extend({
    user_query: z.string(),
});

/**
 * Full search schema including database fields
 */
export const SearchFullDbSchema = searchInsertSchema.extend({
    id: z.number(),
    timestamp: z.string(), // or z.date() if you prefer working with Date objects
});

// Derive types from schemas
export type SearchFullDbType = z.infer<typeof SearchFullDbSchema>;
export type SearchInsertType = z.infer<typeof searchInsertSchema>;
export type LlmQueryType = z.infer<typeof llmQuerySchema>;