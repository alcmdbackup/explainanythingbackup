/* eslint-disable @typescript-eslint/no-unused-vars */
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
  TitleFromRegenerate = "title from regenerate",
  Rewrite = "rewrite",
  RewriteWithTags = "rewrite with tags",
  EditWithTags = "edit with tags"
}

export enum AnchorSet {
  Main = "main"
}

/**
 * Metadata stored with vectors in Pinecone
 * Used by: vectorsim.ts for upsert and search operations
 */
export interface VectorSearchMetadata {
  text: string;
  explanation_id: number;
  topic_id: number;
  startIdx: number;
  length: number;
  isAnchor: boolean;
  anchorSet?: AnchorSet | null;
}

/**
 * Structure of a vector search result from Pinecone
 * Used by: vectorsim.ts, findMatches.ts for vector similarity operations
 * Note: score is optional per Pinecone SDK, but always present in query results
 */
export interface VectorSearchResult {
  id: string;
  score?: number;
  metadata: VectorSearchMetadata;
  values?: number[];
}

/**
 * Enum for TagBar display modes
 * • Normal: Standard tag display without modification interface
 * • RewriteWithTags: Shows modification interface for rewriting explanations with tags
 * • EditWithTags: Shows modification interface for editing existing explanations with tags
 * 
 * Used by: TagBar component to determine display behavior
 * Calls: None (enum definition)
 */
export enum TagBarMode {
  Normal = "normal",
  RewriteWithTags = "rewrite with tags",
  EditWithTags = "edit with tags"
}

/**
 * Enum for explanation status
 * • Draft: Not yet published, can be edited and refined, cannot be saved to user library
 * • Published: Finalized, available for broader consumption, can be saved to user library
 *
 * Used by: Explanation creation and state management throughout the application
 * Calls: None (enum definition)
 */
export enum ExplanationStatus {
  Draft = "draft",
  Published = "published"
}

/**
 * Enum for import source tracking
 * • chatgpt: Imported from ChatGPT
 * • claude: Imported from Claude
 * • gemini: Imported from Gemini
 * • other: Imported from other AI source
 * • generated: Created via ExplainAnything generation flow
 * • null: Legacy content (no source tracking)
 *
 * Used by: Import feature to track content origin
 * Calls: None (enum definition)
 */
export const ImportSourceSchema = z.enum(['chatgpt', 'claude', 'gemini', 'other', 'generated']);
export type ImportSource = z.infer<typeof ImportSourceSchema>;

/**
 * Sort mode for discovery/explore tab
 * • new: Sort by creation timestamp (newest first)
 * • top: Sort by view count during selected time period
 */
export type SortMode = 'new' | 'top';

/**
 * Time period for filtering "top" explanations
 * • hour: Last 1 hour
 * • today: Last 24 hours
 * • week: Last 7 days
 * • month: Last 30 days
 * • all: All time (no time filter)
 */
export type TimePeriod = 'hour' | 'today' | 'week' | 'month' | 'all';

/**
 * Schema for validating allowed LLM models
 * • Restricts model parameter to approved OpenAI models only
 * • Ensures consistent model usage across the application
 * • Provides type safety for LLM API calls
 * Used by: callOpenAIModel function for parameter validation
 * Calls: N/A (validation schema)
 */
export const allowedLLMModelSchema = z.enum(["gpt-4o-mini", "gpt-4.1-nano", "gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini", "gpt-4.1-nano"]);

export type AllowedLLMModelType = z.infer<typeof allowedLLMModelSchema>;

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
        similarity: z.number(),
        diversity_score: z.number().nullable()
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
    summary_teaser: z.string().nullable(),  // AI-generated preview, null for older explanations
    timestamp: z.string(),                   // Creation timestamp for display (empty string if missing)
});

/**
 * Schema for inserting user query data, extends userQueryDataSchema with explanation_id, userid, newExplanation, userInputType, and allowedQuery
 * @example
 * {
 *   user_query: "How does photosynthesis work?",
 *   explanation_title: "Photosynthesis Process",
 *   content: "Photosynthesis is the process by which plants...",
 *   matches: [...],
 *   explanation_id: 123,
 *   userid: "user123",
 *   newExplanation: true,
 *   userInputType: UserInputType.Query,
 *   allowedQuery: true
 * }
 */
export const userQueryInsertSchema = z.object({
    matches: z.array(matchWithCurrentContentSchema),
    user_query: z.string(),
    explanation_id: z.number().nullable(),
    userid: z.string(),
    newExplanation: z.boolean(),
    userInputType: z.nativeEnum(UserInputType),
    allowedQuery: z.boolean(),
    previousExplanationViewedId: z.number().nullable(),
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
    secondary_topic_id: z.number().optional(),
    status: z.nativeEnum(ExplanationStatus).default(ExplanationStatus.Published),
    source: ImportSourceSchema.optional()
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
    // Summary fields for discoverability, SEO, and search (nullable for backwards compatibility)
    summary_teaser: z.string().nullable().optional(),
    meta_description: z.string().max(160).nullable().optional(),
    keywords: z.array(z.string()).nullable().optional(),
});

/**
 * Schema for LLM structured output when generating article summaries.
 * Used by explanationSummarizer.ts for AI-generated summaries.
 * @example
 * {
 *   summary_teaser: "This article explains how photosynthesis works...",
 *   meta_description: "Learn about photosynthesis, the process plants use to convert sunlight into energy.",
 *   keywords: ["photosynthesis", "plants", "sunlight", "chlorophyll", "energy"]
 * }
 */
export const explanationSummarySchema = z.object({
    summary_teaser: z.string()
        .min(50).max(200)
        .describe('1-2 sentence teaser summarizing the article, 30-50 words'),
    meta_description: z.string()
        .min(50).max(160)
        .describe('SEO-optimized description for search engines and social cards'),
    keywords: z.array(z.string().min(2).max(30))
        .min(5).max(10)
        .describe('Relevant search terms for this article'),
});
export type ExplanationSummary = z.infer<typeof explanationSummarySchema>;

// Derive types from schemas
export type explanationBaseType = z.infer<typeof explanationBaseSchema>;
export type MatchType = z.infer<typeof matchSchema>;
export type matchWithCurrentContentType = z.infer<typeof matchWithCurrentContentSchema>;
export type ExplanationInsertType = z.infer<typeof explanationInsertSchema>;
export type ExplanationFullDbType = z.infer<typeof ExplanationFullDbSchema>;
export type ExplanationWithViewCount = ExplanationFullDbType & { viewCount?: number };

/**
 * Extended explanation type that includes engagement metrics for feed display.
 * Extends ExplanationWithViewCount to add total_saves for engagement bar.
 */
export type ExplanationWithMetrics = ExplanationWithViewCount & { total_saves?: number };
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
    tag_description: z.string(),
    presetTagId: z.number().nullable(),
});

/**
 * Full tag schema including database fields
 * @example
 * {
 *   id: 123,
 *   tag_name: "beginner",
 *   tag_description: "Suitable for beginners with no prior knowledge",
 *   presetTagId: null,
 *   created_at: "2024-03-20T10:30:00Z"
 * }
 */
export const tagFullDbSchema = tagInsertSchema.extend({
    id: z.number(),
    created_at: z.string()
});

/**
 * Schema for tag data with UI-specific active state
 * @example
 * {
 *   id: 123,
 *   tag_name: "beginner",
 *   tag_description: "Suitable for beginners with no prior knowledge",
 *   presetTagId: null,
 *   created_at: "2024-03-20T10:30:00Z",
 *   tag_active_current: true,
 *   tag_active_initial: true
 * }
 */
export const simpleTagUISchema = tagFullDbSchema.extend({
    tag_active_current: z.boolean(),
    tag_active_initial: z.boolean()
});

export type TagInsertType = z.infer<typeof tagInsertSchema>;
export type TagFullDbType = z.infer<typeof tagFullDbSchema>;
export type SimpleTagUIType = z.infer<typeof simpleTagUISchema>;

/**
 * Schema for preset tag UI data with active state and reference IDs
 * @example
 * {
 *   tags: [
 *     { id: 1, tag_name: "beginner", tag_description: "For beginners", presetTagId: null, created_at: "2024-03-20T10:30:00Z" },
 *     { id: 2, tag_name: "intermediate", tag_description: "For intermediate users", presetTagId: null, created_at: "2024-03-20T10:30:00Z" }
 *   ],
 *   tag_active_current: true,
 *   tag_active_initial: true,
 *   currentActiveTagId: 1,
 *   originalTagId: 2
 * }
 */
export const PresetTagUISchema = z.object({
    tags: z.array(tagFullDbSchema),
    tag_active_current: z.boolean(),
    tag_active_initial: z.boolean(),
    currentActiveTagId: z.number().int(),
    originalTagId: z.number().int()
}).refine(
    (data) => {
        const tagIds = data.tags.map(tag => tag.id);
        return tagIds.includes(data.currentActiveTagId) && tagIds.includes(data.originalTagId);
    },
    {
        message: "currentActiveTagId and originalTagId must correspond to one of the tag IDs in the array",
        path: ["currentActiveTagId", "originalTagId"]
    }
);

export type PresetTagUIType = z.infer<typeof PresetTagUISchema>;

/**
 * Union type for tag UI schemas - can be either a simple tag or a preset tag collection
 * @example
 * // Simple tag
 * {
 *   id: 123,
 *   tag_name: "beginner",
 *   tag_description: "For beginners",
 *   presetTagId: null,
 *   created_at: "2024-03-20T10:30:00Z",
 *   tag_active_current: true,
 *   tag_active_initial: true
 * }
 * 
 * // Preset tag collection
 * {
 *   tags: [{ id: 1, tag_name: "beginner", ... }, { id: 2, tag_name: "intermediate", ... }],
 *   tag_active_current: true,
 *   tag_active_initial: true,
 *   currentActiveTagId: 1,
 *   originalTagId: 2
 * }
 */
export const SimpleOrPresetTagUISchema = z.union([simpleTagUISchema, PresetTagUISchema]);
export type TagUIType = z.infer<typeof SimpleOrPresetTagUISchema>;

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
    isDeleted: z.boolean().default(false),
});

/**
 * Full explanation-tag schema including database fields
 * @example
 * {
 *   id: 789,
 *   explanation_id: 456,
 *   tag_id: 123,
 *   isDeleted: false,
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
export const tagEvaluationSchema = z.object({
    difficultyLevel: z.number().int().min(1).max(3),
    length: z.number().int().min(4).max(6),
    simpleTags: z.array(z.number().int()).nullable()
});

export type TagEvaluationType = z.infer<typeof tagEvaluationSchema>;

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
 * Configuration type for logging
 */
export interface LogConfig {
  enabled: boolean;
  logInputs: boolean;
  logOutputs: boolean;
  logErrors: boolean;
  maxInputLength: number;
  maxOutputLength: number;
  sensitiveFields: readonly string[];
}

/**
 * Default function logging configuration with type inference
 * • Controls which aspects of function execution are logged
 * • Provides data sanitization for sensitive fields
 * • Sets limits on input/output data length for performance
 * Used by: withServerLogging, withServerLoggingAndTracing functions
 * Calls: sanitizeData for data cleaning
 */
export const defaultLogConfig: LogConfig = {
  enabled: true,
  logInputs: true,
  logOutputs: true,
  logErrors: true,
  maxInputLength: 1000,
  maxOutputLength: 1000,
  sensitiveFields: ['password', 'apiKey', 'token', 'secret', 'pass']
};

/**
 * Default OpenTelemetry tracing configuration with type inference
 * • Controls span creation and attribute inclusion
 * • Manages performance vs observability tradeoffs
 * • Defines tracer categorization for different operations
 * Used by: withServerTracing, withServerLoggingAndTracing functions
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

/**
 * Schema for multiple standalone titles generated from headings
 * @example
 * {
 *   titles: [
 *     "Machine Learning Model Training",
 *     "Neural Network Architecture", 
 *     "Deep Learning Applications"
 *   ]
 * }
 */
export const multipleStandaloneTitlesSchema = z.object({
    titles: z.array(z.string())
});

export type MultipleStandaloneTitlesType = z.infer<typeof multipleStandaloneTitlesSchema>;

/**
 * Schema for aggregate explanation metrics table
 * Stores consolidated metrics per explanation including saves, views, and engagement ratio
 * @example
 * {
 *   explanationid: 123,
 *   total_saves: 15,
 *   total_views: 245,
 *   save_rate: 0.061, // 15/245 = 6.1% save rate
 *   last_updated: "2024-12-19T10:30:00.000Z"
 * }
 */
// Schema for metrics returned from stored procedures (use explanation_id)
export const explanationMetricsSchema = z.object({
  id: z.number().int().positive().optional(), // Primary key, auto-generated
  explanation_id: z.number().int().positive(), // Returned from DB functions as `explanation_id`
  total_saves: z.number().int().min(0).default(0),
  total_views: z.number().int().min(0).default(0),
  save_rate: z.number().min(0).max(1).default(0), // Ratio of saves/views (0.0 to 1.0)
  last_updated: z.union([
    z.string().datetime(), // ISO 8601 string
    z.date(), // Date object
    z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: "Invalid date string"
    }) // Any parseable date string
  ]), // Accept multiple date formats
});

// Schema for metrics when querying table directly (uses explanationid - no underscore)
export const explanationMetricsTableSchema = z.object({
  id: z.number().int().positive().optional(),
  explanationid: z.number().int().positive(), // Direct table column name
  total_saves: z.number().int().min(0).default(0),
  total_views: z.number().int().min(0).default(0),
  save_rate: z.number().min(0).max(1).default(0),
  last_updated: z.union([
    z.string().datetime(),
    z.date(),
    z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: "Invalid date string"
    })
  ]),
});

export type ExplanationMetricsType = z.infer<typeof explanationMetricsSchema>;
export type ExplanationMetricsTableType = z.infer<typeof explanationMetricsTableSchema>;

/**
 * Schema for inserting new explanation metrics records
 */
export const explanationMetricsInsertSchema = explanationMetricsSchema.omit({ id: true });

export type ExplanationMetricsInsertType = z.infer<typeof explanationMetricsInsertSchema>;

// =============================================================================
// LINK WHITELIST SYSTEM SCHEMAS
// =============================================================================

/**
 * Override type enum for article link overrides
 */
export enum LinkOverrideType {
  CustomTitle = "custom_title",
  Disabled = "disabled"
}

/**
 * Schema for link whitelist insert data
 * @example
 * {
 *   canonical_term: "Machine Learning",
 *   standalone_title: "Machine Learning (Computer Science)",
 *   description: "A branch of AI focused on learning from data",
 *   is_active: true
 * }
 */
export const linkWhitelistInsertSchema = z.object({
  canonical_term: z.string().min(1).max(255),
  standalone_title: z.string().min(1).max(500),
  description: z.string().optional(),
  is_active: z.boolean().default(true),
});

/**
 * Full link whitelist schema including database fields
 */
export const linkWhitelistFullSchema = linkWhitelistInsertSchema.extend({
  id: z.number().int().positive(),
  canonical_term_lower: z.string().max(255),
  created_at: z.string(),
  updated_at: z.string(),
});

export type LinkWhitelistInsertType = z.infer<typeof linkWhitelistInsertSchema>;
export type LinkWhitelistFullType = z.infer<typeof linkWhitelistFullSchema>;

/**
 * Schema for link whitelist alias insert data
 * @example
 * {
 *   whitelist_id: 1,
 *   alias_term: "ML"
 * }
 */
export const linkAliasInsertSchema = z.object({
  whitelist_id: z.number().int().positive(),
  alias_term: z.string().min(1).max(255),
});

/**
 * Full link alias schema including database fields
 */
export const linkAliasFullSchema = linkAliasInsertSchema.extend({
  id: z.number().int().positive(),
  alias_term_lower: z.string().max(255),
  created_at: z.string(),
});

export type LinkAliasInsertType = z.infer<typeof linkAliasInsertSchema>;
export type LinkAliasFullType = z.infer<typeof linkAliasFullSchema>;

/**
 * Schema for article heading link insert data
 * @example
 * {
 *   explanation_id: 123,
 *   heading_text: "Training Process",
 *   standalone_title: "Machine Learning Training Process"
 * }
 */
export const articleHeadingLinkInsertSchema = z.object({
  explanation_id: z.number().int().positive(),
  heading_text: z.string().min(1).max(500),
  standalone_title: z.string().min(1).max(500),
});

/**
 * Full article heading link schema including database fields
 */
export const articleHeadingLinkFullSchema = articleHeadingLinkInsertSchema.extend({
  id: z.number().int().positive(),
  heading_text_lower: z.string().max(500),
  created_at: z.string(),
});

export type ArticleHeadingLinkInsertType = z.infer<typeof articleHeadingLinkInsertSchema>;
export type ArticleHeadingLinkFullType = z.infer<typeof articleHeadingLinkFullSchema>;

/**
 * Schema for article link override insert data
 * @example
 * {
 *   explanation_id: 123,
 *   term: "neural networks",
 *   override_type: "custom_title",
 *   custom_standalone_title: "Artificial Neural Networks"
 * }
 */
export const articleLinkOverrideInsertSchema = z.object({
  explanation_id: z.number().int().positive(),
  term: z.string().min(1).max(255),
  override_type: z.nativeEnum(LinkOverrideType),
  custom_standalone_title: z.string().max(500).optional(),
});

/**
 * Full article link override schema including database fields
 */
export const articleLinkOverrideFullSchema = articleLinkOverrideInsertSchema.extend({
  id: z.number().int().positive(),
  term_lower: z.string().max(255),
  created_at: z.string(),
});

export type ArticleLinkOverrideInsertType = z.infer<typeof articleLinkOverrideInsertSchema>;
export type ArticleLinkOverrideFullType = z.infer<typeof articleLinkOverrideFullSchema>;

/**
 * Schema for whitelist cache entry (used in snapshot data)
 */
export const whitelistCacheEntrySchema = z.object({
  canonical_term: z.string(),
  standalone_title: z.string(),
});

export type WhitelistCacheEntryType = z.infer<typeof whitelistCacheEntrySchema>;

/**
 * Schema for link whitelist snapshot
 * @example
 * {
 *   id: 1,
 *   version: 5,
 *   data: { "machine learning": { canonical_term: "Machine Learning", standalone_title: "..." } },
 *   updated_at: "2024-03-20T10:30:00Z"
 * }
 */
export const linkWhitelistSnapshotSchema = z.object({
  id: z.number().int().default(1),
  version: z.number().int().nonnegative(),
  data: z.record(z.string(), whitelistCacheEntrySchema),
  updated_at: z.string(),
});

export type LinkWhitelistSnapshotType = z.infer<typeof linkWhitelistSnapshotSchema>;

/**
 * Schema for resolved link (output of link resolver)
 */
export const resolvedLinkSchema = z.object({
  term: z.string(),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().nonnegative(),
  standaloneTitle: z.string(),
  type: z.enum(['heading', 'term']),
});

export type ResolvedLinkType = z.infer<typeof resolvedLinkSchema>;

// =============================================================================
// LINK CANDIDATES SYSTEM SCHEMAS
// =============================================================================

/**
 * Candidate status enum for link candidates
 */
export enum CandidateStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected'
}

/**
 * Schema for link candidate insert data
 * @example
 * {
 *   term: "Machine Learning",
 *   source: "llm",
 *   first_seen_explanation_id: 123
 * }
 */
export const linkCandidateInsertSchema = z.object({
  term: z.string().min(1).max(255),
  source: z.enum(['llm', 'manual']).default('llm'),
  first_seen_explanation_id: z.number().int().positive().nullable().optional(),
});

/**
 * Full link candidate schema including database fields
 */
export const linkCandidateFullSchema = linkCandidateInsertSchema.extend({
  id: z.number().int().positive(),
  term_lower: z.string().max(255),
  status: z.nativeEnum(CandidateStatus).default(CandidateStatus.Pending),
  total_occurrences: z.number().int().min(0).default(0),
  article_count: z.number().int().min(0).default(0),
  created_at: z.string(),
  updated_at: z.string(),
});

export type LinkCandidateInsertType = z.infer<typeof linkCandidateInsertSchema>;
export type LinkCandidateFullType = z.infer<typeof linkCandidateFullSchema>;

/**
 * Schema for candidate occurrence insert data
 * @example
 * {
 *   candidate_id: 1,
 *   explanation_id: 123,
 *   occurrence_count: 5
 * }
 */
export const candidateOccurrenceInsertSchema = z.object({
  candidate_id: z.number().int().positive(),
  explanation_id: z.number().int().positive(),
  occurrence_count: z.number().int().min(0).default(1),
});

/**
 * Full candidate occurrence schema including database fields
 */
export const candidateOccurrenceFullSchema = candidateOccurrenceInsertSchema.extend({
  id: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CandidateOccurrenceInsertType = z.infer<typeof candidateOccurrenceInsertSchema>;
export type CandidateOccurrenceFullType = z.infer<typeof candidateOccurrenceFullSchema>;

/**
 * Schema for LLM link candidates extraction response
 * @example
 * {
 *   candidates: ["quantum entanglement", "photon", "wave function"]
 * }
 */
export const linkCandidatesExtractionSchema = z.object({
  candidates: z.array(z.string()),
});

// =============================================================================
// SOURCE CACHE SYSTEM SCHEMAS
// =============================================================================

/**
 * Enum for source fetch status
 */
export enum FetchStatus {
  Pending = 'pending',
  Success = 'success',
  Failed = 'failed'
}

/**
 * Schema for source cache insert data
 * @example
 * {
 *   url: "https://example.com/article",
 *   title: "Example Article",
 *   favicon_url: "https://example.com/favicon.ico",
 *   domain: "example.com",
 *   extracted_text: "Article content...",
 *   is_summarized: false,
 *   original_length: 1500,
 *   fetch_status: "success",
 *   expires_at: "2024-03-27T10:30:00Z"
 * }
 */
export const sourceCacheInsertSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  favicon_url: z.string().url().nullable(),
  domain: z.string(),
  extracted_text: z.string().nullable(),
  is_summarized: z.boolean().default(false),
  original_length: z.number().int().nullable(),
  fetch_status: z.nativeEnum(FetchStatus).default(FetchStatus.Pending),
  error_message: z.string().nullable(),
  expires_at: z.string().datetime().nullable(),
});

/**
 * Full source cache schema including database fields
 */
export const sourceCacheFullSchema = sourceCacheInsertSchema.extend({
  id: z.number().int().positive(),
  url_hash: z.string(),
  fetched_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
});

export type SourceCacheInsertType = z.infer<typeof sourceCacheInsertSchema>;
export type SourceCacheFullType = z.infer<typeof sourceCacheFullSchema>;

/**
 * Schema for article sources junction table insert
 * @example
 * {
 *   explanation_id: 123,
 *   source_cache_id: 456,
 *   position: 1
 * }
 */
export const articleSourceInsertSchema = z.object({
  explanation_id: z.number().int().positive(),
  source_cache_id: z.number().int().positive(),
  position: z.number().int().min(1).max(5),
});

/**
 * Full article source schema including database fields
 */
export const articleSourceFullSchema = articleSourceInsertSchema.extend({
  id: z.number().int().positive(),
  created_at: z.string().datetime(),
});

export type ArticleSourceInsertType = z.infer<typeof articleSourceInsertSchema>;
export type ArticleSourceFullType = z.infer<typeof articleSourceFullSchema>;

/**
 * Schema for UI source chip display
 * Used by SourceChip, SourceInput, SourceList components
 * @example
 * {
 *   url: "https://example.com/article",
 *   title: "Example Article",
 *   favicon_url: "https://example.com/favicon.ico",
 *   domain: "example.com",
 *   status: "success",
 *   error_message: null
 * }
 */
export const sourceChipSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  favicon_url: z.string().nullable(),
  domain: z.string(),
  status: z.enum(['loading', 'success', 'failed']),
  error_message: z.string().nullable(),
});

export type SourceChipType = z.infer<typeof sourceChipSchema>;

/**
 * Schema for source data passed to LLM prompts
 * Used by createExplanationWithSourcesPrompt
 * @example
 * {
 *   index: 1,
 *   title: "Example Article",
 *   domain: "example.com",
 *   content: "Article content...",
 *   isVerbatim: true
 * }
 */
export const sourceForPromptSchema = z.object({
  index: z.number().int().min(1).max(5),
  title: z.string(),
  domain: z.string(),
  content: z.string(),
  isVerbatim: z.boolean(),
});

export type SourceForPromptType = z.infer<typeof sourceForPromptSchema>;

/**
 * Schema for AI suggestion session data
 * Used to pass context (explanation info and sources) to the AI suggestions pipeline
 */
export const aiSuggestionSessionDataSchema = z.object({
  explanation_id: z.number().int().positive(),
  explanation_title: z.string(),
  user_prompt: z.string().optional(),
  sources: z.array(sourceForPromptSchema).optional(),
});

export type AISuggestionSessionDataType = z.infer<typeof aiSuggestionSessionDataSchema>;
