import { matchesGlob } from 'node:path/posix';
import { z } from 'zod';

// Add near the top with other type definitions
export enum MatchMode {
  Normal = "normal",
  SkipMatch = "skipMatch",
  ForceMatch = "forceMatch"
}

/**
 * Base schema for LLM query data
 * @example
 * {
 *   explanation_title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants..."
 * }
 */
export const llmQuerySchema = z.object({
    explanation_title: z.string(),
    content: z.string(),
});

/**
 * Schema for title query results: requires 3 article titles as strings
 * @example
 * {
 *   title1: "Photosynthesis Process",
 *   title2: "Photosynthesis Process",
 *   title3: "Photosynthesis Process"
 * }
 */
export const titleQuerySchema = z.object({
    title1: z.string(),
    title2: z.string(),
    title3: z.string(),
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
export const matchSchema = z.object({
    text: z.string(),
    explanation_id: z.number(),
    topic_id: z.number(),
    ranking: z.object({
        similarity: z.number()
    })
});


/**
 * Schema for enhanced source data with title and content
 * Extends the base matchSchema with additional explanation details
 * @example
 * {
 *   text: "Original source text...",
 *   explanation_id: 123,
 *   title: "Photosynthesis Process",
 *   content: "Detailed explanation content...",
 *   ranking: {
 *     similarity: 0.95
 *   }
 * }
 */
export const matchWithCurrentContentSchema = matchSchema.extend({
    current_title: z.string(),
    current_content: z.string(),
});


/**
 * Schema for user query data, extends llmQuerySchema with user query
 * @example
 * {
 *   user_query: "How does photosynthesis work?",
 *   explanation_title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants..."
 * }
 */
export const userQueryDataSchema = llmQuerySchema.extend({
    matches: z.array(matchWithCurrentContentSchema),
    user_query: z.string(),
});

/**
 * Schema for inserting user query data, extends userQueryDataSchema with explanation_id
 * @example
 * {
 *   user_query: "How does photosynthesis work?",
 *   explanation_title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants...",
 *   matches: [...],
 *   explanation_id: 123
 * }
 */
export const userQueryInsertSchema = userQueryDataSchema.extend({
    explanation_id: z.number(),
});

/**
 * Schema for inserting explanation data
 * @example
 * {
 *   explanation_title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants...",
 *   matches: [
 *     {
 *       text: "Original source text...",
 *       explanation_id: 123,
 *       topic_id: 456,
 *       current_title: "Photosynthesis Process",
 *       current_content: "Detailed explanation content...",
 *       ranking: {
 *         similarity: 0.95
 *       }
 *     }
 *   ],
 *   primary_topic_id: 1,
 *   secondary_topic_id: 2
 * }
 */
export const explanationInsertSchema = llmQuerySchema.extend({
    primary_topic_id: z.number(),
    secondary_topic_id: z.number().optional()
});

/**
 * Full explanation schema including database fields
 * @example
 * {
 *   id: 123,
 *   timestamp: "2024-03-20T10:30:00Z",
 *   explanation_title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants...",
 *   primary_topic_id: 1,
 *   secondary_topic_id: 2
 * }
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
 *   explanation_title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants...",
 *   user_query: "How does photosynthesis work?"
 * }
 */
export const userQueryFullDbSchema = userQueryDataSchema.extend({
    id: z.number(),
    timestamp: z.string(), // or z.date() if you prefer working with Date objects
});

// Derive types from schemas
export type LlmQueryType = z.infer<typeof llmQuerySchema>;
export type MatchType = z.infer<typeof matchSchema>;
export type matchWithCurrentContentType = z.infer<typeof matchWithCurrentContentSchema>;
export type UserQueryDataType = z.infer<typeof userQueryDataSchema>;
export type ExplanationInsertType = z.infer<typeof explanationInsertSchema>;
export type ExplanationFullDbType = z.infer<typeof ExplanationFullDbSchema>;
export type UserQueryFullDbType = z.infer<typeof userQueryFullDbSchema>;
export type UserQueryInsertType = z.infer<typeof userQueryInsertSchema>;

/**
 * Schema for topic data
 * @example
 * {
 *   topic_title: "Physics",
 *   topic_description: "Fundamental science of matter and energy"
 * }
 */
export const topicInsertSchema = z.object({
    topic_title: z.string(),
    topic_description: z.string().optional(),
});

/**
 * Full topic schema including database fields
 * @example
 * {
 *   id: 123,
 *   topic_title: "Physics",
 *   topic_description: "Fundamental science of matter and energy",
 *   created_at: "2024-03-20T10:30:00Z",
 *   updated_at: "2024-03-20T10:30:00Z"
 * }
 */
export const topicFullDbSchema = topicInsertSchema.extend({
    id: z.number(),
    created_at: z.string(),
    updated_at: z.string()
});

export type TopicInsertType = z.infer<typeof topicInsertSchema>;
export type TopicFullDbType = z.infer<typeof topicFullDbSchema>;


export const matchingSourceLLMSchema = z.object({
    selectedSourceIndex: z.number().int()
  });
  
export type matchingSourceLLMType = z.infer<typeof matchingSourceLLMSchema>;

export const matchingSourceReturnSchema = z.object({
    topic_id: z.number().int(),
    explanation_id: z.number().int(),
});

export type MatchingSourceReturnType = z.infer<typeof matchingSourceReturnSchema>;

/**
 * Schema for query response that either contains a new explanation or a matching source
 * @example
 * // When no match is found:
 * {
 *   match_found: false,
 *   data: {
 *     user_query: "How does photosynthesis work?",
 *     explanation_title: "Photosynthesis Process",
 *     content: "...",
 *     matches: [...]
 *   }
 * }
 * 
 * // When match is found:
 * {
 *   match_found: true,
 *   data: {
 *     topic_id: 123,
 *     explanation_id: 456
 *   }
 * }
 */
export const queryResponseSchema = z.discriminatedUnion('match_found', [
  z.object({
    match_found: z.literal(false),
    data: userQueryDataSchema
  }),
  z.object({
    match_found: z.literal(true),
    data: matchingSourceReturnSchema
  })
]);

export type QueryResponseType = z.infer<typeof queryResponseSchema>;

