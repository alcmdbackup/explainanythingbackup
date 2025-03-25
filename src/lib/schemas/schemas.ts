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
 * Schema for user query data, extends llmQuerySchema with user query
 * @example
 * {
 *   user_query: "How does photosynthesis work?",
 *   title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants..."
 * }
 */
export const userQueryInsertSchema = llmQuerySchema.extend({
    user_query: z.string(),
});

/**
 * Schema for individual source data
 * @example
 * {
 *   text: "Original source text...",
 *   explanation_id: 123,
 *   ranking: {
 *     similarity: 0.95
 *   }
 * }
 */
export const sourceSchema = z.object({
    text: z.string(),
    explanation_id: z.number(),
    ranking: z.object({
        similarity: z.number()
    })
});

/**
 * Schema for inserting explanation data
 * @example
 * {
 *   title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants...",
 *   sources: [
 *     {
 *       text: "Original source text...",
 *       explanation_id: 123,
 *       ranking: {
 *         similarity: 0.95
 *       }
 *     }
 *   ]
 * }
 */
export const explanationInsertSchema = llmQuerySchema.extend({
    sources: z.array(sourceSchema)
});

/**
 * Full explanation schema including database fields
 */
export const ExplanationFullDbSchema = explanationInsertSchema.extend({
    id: z.number(),
    timestamp: z.string(), // or z.date() if you prefer working with Date objects
});

/**
 * Full user query schema including database fields
 * @example
 * {
 *   id: 123,
 *   timestamp: "2024-03-20T10:30:00Z",
 *   title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants...",
 *   user_query: "How does photosynthesis work?"
 * }
 */
export const userQueryFullDbSchema = userQueryInsertSchema.extend({
    id: z.number(),
    timestamp: z.string(), // or z.date() if you prefer working with Date objects
});

// Derive types from schemas
export type LlmQueryType = z.infer<typeof llmQuerySchema>;
export type UserQueryInsertType = z.infer<typeof userQueryInsertSchema>;
export type ExplanationInsertType = z.infer<typeof explanationInsertSchema>;
export type ExplanationFullDbType = z.infer<typeof ExplanationFullDbSchema>;
export type UserQueryFullDbType = z.infer<typeof userQueryFullDbSchema>;

// Add new type for source
export type SourceType = z.infer<typeof sourceSchema>;
