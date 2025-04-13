import { z } from 'zod';

// Add near the top with other type definitions
export enum MatchMode {
  Normal = "normal",
  Skip = "skip",
  Force = "force"
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
    topic_id: z.number(),
    ranking: z.object({
        similarity: z.number()
    })
});


/**
 * Schema for enhanced source data with title and content
 * Extends the base sourceSchema with additional explanation details
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
export const sourceWithCurrentContentSchema = sourceSchema.extend({
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
export const userQueryInsertSchema = llmQuerySchema.extend({
    sources: z.array(sourceWithCurrentContentSchema),
    user_query: z.string(),
});

/**
 * Schema for inserting explanation data
 * @example
 * {
 *   explanation_title: "Photosynthesis Process",
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
export const explanationInsertSchema = userQueryInsertSchema.omit({ user_query: true }).extend({
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
 *   sources: [...],
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
export const userQueryFullDbSchema = userQueryInsertSchema.extend({
    id: z.number(),
    timestamp: z.string(), // or z.date() if you prefer working with Date objects
});

// Derive types from schemas
export type LlmQueryType = z.infer<typeof llmQuerySchema>;
export type SourceType = z.infer<typeof sourceSchema>;
export type sourceWithCurrentContentType = z.infer<typeof sourceWithCurrentContentSchema>;
export type UserQueryInsertType = z.infer<typeof userQueryInsertSchema>;
export type ExplanationInsertType = z.infer<typeof explanationInsertSchema>;
export type ExplanationFullDbType = z.infer<typeof ExplanationFullDbSchema>;
export type UserQueryFullDbType = z.infer<typeof userQueryFullDbSchema>;

/*export const llmResponseWithSourcesSchema = z.object({
    title: z.string(),
    content: z.string(),
    sources: z.array(z.object({
        text: z.string(),
        explanation_id: z.number(),
        title: z.string(),
        content: z.string(),
        ranking: z.object({
            similarity: z.number()
        })
    }))
});

export type LlmResponseWithSourcesType = z.infer<typeof llmResponseWithSourcesSchema>;*/

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
    sources: z.array(sourceWithCurrentContentSchema).optional()
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
 *     sources: [...]
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
    data: userQueryInsertSchema
  }),
  z.object({
    match_found: z.literal(true),
    data: matchingSourceReturnSchema
  })
]);

export type QueryResponseType = z.infer<typeof queryResponseSchema>;

