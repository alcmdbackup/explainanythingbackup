import { matchesGlob } from 'node:path/posix';
import { z } from 'zod';

// Add near the top with other type definitions
export enum MatchMode {
  Normal = "normal",
  SkipMatch = "skipMatch",
  ForceMatch = "forceMatch"
}

export enum UserInputType {
  Query = "query",
  TitleFromLink = "title from link",
  TitleFromRegenerate = "title from regenerate"
}

/**
 * Base schema for LLM query data
 * @example
 * {
 *   explanation_title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants..."
 * }
 */
export const explanationBaseSchema = z.object({
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
 * Schema for inserting user query data, extends userQueryDataSchema with explanation_id, userid, newExplanation, and userInputType
 * @example
 * {
 *   user_query: "How does photosynthesis work?",
 *   explanation_title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants...",
 *   matches: [...],
 *   explanation_id: 123,
 *   userid: "user123",
 *   newExplanation: true,
 *   userInputType: UserInputType.Query
 * }
 */
export const userQueryInsertSchema = z.object({
    matches: z.array(matchWithCurrentContentSchema),
    user_query: z.string(),
    explanation_id: z.number(),
    userid: z.string(),
    newExplanation: z.boolean(),
    userInputType: z.nativeEnum(UserInputType),
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
export const explanationInsertSchema = explanationBaseSchema.extend({
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

// Derive types from schemas
export type explanationBaseType = z.infer<typeof explanationBaseSchema>;
export type MatchType = z.infer<typeof matchSchema>;
export type matchWithCurrentContentType = z.infer<typeof matchWithCurrentContentSchema>;
export type ExplanationInsertType = z.infer<typeof explanationInsertSchema>;
export type ExplanationFullDbType = z.infer<typeof ExplanationFullDbSchema>;
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

/**
 * Schema for tag data
 * @example
 * {
 *   tag_name: "beginner",
 *   tag_description: "Suitable for beginners with no prior knowledge"
 * }
 */
export const tagInsertSchema = z.object({
    tag_name: z.string(),
    tag_description: z.string().optional(),
});

/**
 * Full tag schema including database fields
 * @example
 * {
 *   id: 123,
 *   tag_name: "beginner",
 *   tag_description: "Suitable for beginners with no prior knowledge",
 *   created_at: "2024-03-20T10:30:00Z"
 * }
 */
export const tagFullDbSchema = tagInsertSchema.extend({
    id: z.number(),
    created_at: z.string()
});

export type TagInsertType = z.infer<typeof tagInsertSchema>;
export type TagFullDbType = z.infer<typeof tagFullDbSchema>;

/**
 * Schema for explanation-tag relationship data
 * @example
 * {
 *   explanation_id: 456,
 *   tag_id: 123
 * }
 */
export const explanationTagInsertSchema = z.object({
    explanation_id: z.number(),
    tag_id: z.number(),
});

/**
 * Full explanation-tag schema including database fields
 * @example
 * {
 *   id: 789,
 *   explanation_id: 456,
 *   tag_id: 123,
 *   created_at: "2024-03-20T10:30:00Z"
 * }
 */
export const explanationTagFullDbSchema = explanationTagInsertSchema.extend({
    id: z.number(),
    created_at: z.string()
});

export type ExplanationTagInsertType = z.infer<typeof explanationTagInsertSchema>;
export type ExplanationTagFullDbType = z.infer<typeof explanationTagFullDbSchema>;

export const matchFoundFromListSchema = z.object({
    selectedSourceIndex: z.number().int()
  });
  
export type matchFoundFromListType = z.infer<typeof matchFoundFromListSchema>;

/**
 * Schema for difficulty evaluation results
 * @example
 * {
 *   difficultyLevel: 1  // 1=beginner, 2=normal, 3=expert
 * }
 */
export const difficultyEvaluationSchema = z.object({
    difficultyLevel: z.number().int().min(1).max(3)
});

export type DifficultyEvaluationType = z.infer<typeof difficultyEvaluationSchema>;

export const matchingSourceReturnSchema = z.object({
    topic_id: z.number().int(),
    explanation_id: z.number().int(),
});

export type MatchingSourceReturnType = z.infer<typeof matchingSourceReturnSchema>;

export const userLibrarySchema = z.object({
  id: z.number().int().positive(),
  explanationid: z.number().int().positive(),
  userid: z.string(),
  created: z.string().datetime(), // ISO 8601 string, e.g. "2024-06-01T12:34:56.789Z"
});

export type userLibraryType = z.infer<typeof userLibrarySchema>;

export const userSavedExplanationSchema = ExplanationFullDbSchema.extend({
  saved_timestamp: z.string().datetime(), // ISO 8601 string, e.g. "2024-06-01T12:34:56.789Z"
});
export type UserSavedExplanationType = z.infer<typeof userSavedExplanationSchema>;

/**
 * Schema for tracking OpenAI API call metrics and details
 * @example
 * {
 *   model: "gpt-4o-mini",
 *   finish_reason: "stop",
 *   prompt_tokens: 150,
 *   completion_tokens: 200,
 *   total_tokens: 350,
 *   reasoning_tokens: 0,
 *   content: "The response content from the AI",
 *   prompt: "Explain photosynthesis",
 *   call_source: "explanation_generator",
 *   raw_api_response: "{\"id\":\"chatcmpl-123\",\"object\":\"chat.completion\",...}"
 * }
 */
export const llmCallTrackingSchema = z.object({
    userid: z.string(),
    prompt: z.string(),
    content: z.string(),
    call_source: z.string(),
    raw_api_response: z.string(),
    model: z.string(),
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    reasoning_tokens: z.number().int().nonnegative().optional(),
    finish_reason: z.string(),
});

export type LlmCallTrackingType = z.infer<typeof llmCallTrackingSchema>;

/**
 * Schema for tracking user events related to explanations
 * @example
 * {
 *   event_name: "explanation_viewed",
 *   userid: "user123",
 *   explanation_id: 456,
 *   value: 1,
 *   metadata: "{\"duration_seconds\": 30, \"source\": \"search\"}"
 * }
 */
export const userExplanationEventsSchema = z.object({
    event_name: z.string(),
    userid: z.string(),
    explanationid: z.number().int(),
    value: z.number().int(),
    metadata: z.string(),
});

export type UserExplanationEventsType = z.infer<typeof userExplanationEventsSchema>;

/**
 * Default function logging configuration with type inference
 * • Controls which aspects of function execution are logged
 * • Provides data sanitization for sensitive fields
 * • Sets limits on input/output data length for performance
 * Used by: withLogging, withLoggingAndTracing functions
 * Calls: sanitizeData for data cleaning
 */
export const defaultLogConfig = {
  enabled: true,
  logInputs: true,
  logOutputs: true,
  logErrors: true,
  maxInputLength: 1000,
  maxOutputLength: 1000,
  sensitiveFields: ['password', 'apiKey', 'token', 'secret', 'pass']
} as const;

/**
 * Configuration type derived from default logging values
 */
export type LogConfig = typeof defaultLogConfig;

/**
 * Default OpenTelemetry tracing configuration with type inference
 * • Controls span creation and attribute inclusion
 * • Manages performance vs observability tradeoffs
 * • Defines tracer categorization for different operations
 * Used by: withTracing, withLoggingAndTracing functions
 * Calls: createAppSpan for telemetry span creation
 */
export const defaultTracingConfig = {
  enabled: true,
  tracerName: 'app' as 'app' | 'llm' | 'db' | 'vector',
  includeInputs: false, // Don't include inputs by default for privacy
  includeOutputs: false, // Don't include outputs by default for performance
  customAttributes: {} as Record<string, string | number>
} as const;

/**
 * Configuration type derived from default tracing values
 */
export type TracingConfig = typeof defaultTracingConfig;
