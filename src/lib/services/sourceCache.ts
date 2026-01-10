import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import {
  FetchStatus,
  sourceCacheInsertSchema,
  articleSourceInsertSchema,
  type SourceCacheInsertType,
  type SourceCacheFullType,
  type ArticleSourceInsertType
} from '@/lib/schemas/schemas';
import { fetchAndExtractSource, needsSummarization, calculateExpiryDate } from './sourceFetcher';
import { summarizeSourceContent } from './sourceSummarizer';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';

/**
 * Service for managing source cache operations
 *
 * Provides CRUD operations for source_cache and article_sources tables,
 * with caching logic for URL content.
 */

// ============================================================================
// SOURCE CACHE CRUD OPERATIONS
// ============================================================================

/**
 * Insert a new source into the cache
 *
 * • Validates input against sourceCacheInsertSchema
 * • Handles duplicate URLs gracefully (returns existing)
 */
async function insertSourceCacheImpl(
  source: SourceCacheInsertType
): Promise<SourceCacheFullType> {
  const supabase = await createSupabaseServerClient();

  // Validate input
  const validationResult = sourceCacheInsertSchema.safeParse(source);
  if (!validationResult.success) {
    throw new Error(`Invalid source cache data: ${validationResult.error.message}`);
  }

  const validatedSource = validationResult.data;

  // Check for existing source by URL
  const { data: existing, error: selectError } = await supabase
    .from('source_cache')
    .select()
    .eq('url', validatedSource.url)
    .single();

  if (selectError && selectError.code !== 'PGRST116') throw selectError;
  if (existing) return existing;

  // Insert new source
  const { data, error } = await supabase
    .from('source_cache')
    .insert({
      ...validatedSource,
      fetched_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get a source by URL
 */
async function getSourceByUrlImpl(url: string): Promise<SourceCacheFullType | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('source_cache')
    .select()
    .eq('url', url)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Get a source by ID
 */
async function getSourceByIdImpl(id: number): Promise<SourceCacheFullType | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('source_cache')
    .select()
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Update a source cache entry
 */
async function updateSourceCacheImpl(
  id: number,
  updates: Partial<SourceCacheInsertType>
): Promise<SourceCacheFullType> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('source_cache')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Check if a cached source is expired
 */
export function isSourceExpired(source: SourceCacheFullType): boolean {
  if (!source.expires_at) return true;
  return new Date(source.expires_at) < new Date();
}

/**
 * Get or create a cached source for a URL
 *
 * • Checks cache first
 * • If cached and not expired, returns cached version
 * • If not cached or expired, fetches and caches
 * • Handles summarization for long content
 */
async function getOrCreateCachedSourceImpl(
  url: string,
  userid: string
): Promise<{
  source: SourceCacheFullType | null;
  isFromCache: boolean;
  error: string | null;
}> {
  logger.info('getOrCreateCachedSource: Starting', { url });

  // Check cache first
  const cached = await getSourceByUrlImpl(url);

  if (cached && !isSourceExpired(cached)) {
    logger.info('getOrCreateCachedSource: Cache hit', { url, id: cached.id });
    return {
      source: cached,
      isFromCache: true,
      error: null
    };
  }

  // Fetch fresh content
  const fetchResult = await fetchAndExtractSource(url);

  if (!fetchResult.success || !fetchResult.data) {
    // Store failed fetch in cache to avoid repeated failures
    if (cached) {
      // Update existing with error
      const updated = await updateSourceCacheImpl(cached.id, {
        fetch_status: FetchStatus.Failed,
        error_message: fetchResult.error,
        expires_at: calculateExpiryDate()
      });
      return {
        source: updated,
        isFromCache: false,
        error: fetchResult.error
      };
    }

    // Insert new failed entry
    const failedSource = await insertSourceCacheImpl({
      url,
      title: null,
      favicon_url: null,
      domain: new URL(url).hostname.replace(/^www\./, ''),
      extracted_text: null,
      is_summarized: false,
      original_length: null,
      fetch_status: FetchStatus.Failed,
      error_message: fetchResult.error,
      expires_at: calculateExpiryDate()
    });

    return {
      source: failedSource,
      isFromCache: false,
      error: fetchResult.error
    };
  }

  // Check if summarization is needed
  let sourceData = fetchResult.data;
  if (sourceData.original_length && needsSummarization(sourceData.original_length)) {
    logger.info('getOrCreateCachedSource: Summarizing content', {
      url,
      originalLength: sourceData.original_length
    });

    const summarizeResult = await summarizeSourceContent(
      sourceData.extracted_text!,
      3000,
      userid
    );

    sourceData = {
      ...sourceData,
      extracted_text: summarizeResult.summarized,
      is_summarized: !summarizeResult.isVerbatim
    };
  }

  // Insert or update cache
  let source: SourceCacheFullType;
  if (cached) {
    source = await updateSourceCacheImpl(cached.id, {
      ...sourceData,
      fetch_status: FetchStatus.Success,
      error_message: null
    });
  } else {
    source = await insertSourceCacheImpl(sourceData);
  }

  logger.info('getOrCreateCachedSource: Cached new source', {
    url,
    id: source.id,
    isSummarized: source.is_summarized
  });

  return {
    source,
    isFromCache: false,
    error: null
  };
}

// ============================================================================
// ARTICLE SOURCES JUNCTION OPERATIONS
// ============================================================================

/**
 * Link sources to an explanation
 *
 * • Creates article_sources junction records
 * • Assigns positions 1-5 based on array order
 */
async function linkSourcesToExplanationImpl(
  explanationId: number,
  sourceIds: number[]
): Promise<void> {
  if (sourceIds.length === 0) return;
  if (sourceIds.length > 5) {
    throw new Error('Maximum 5 sources allowed per explanation');
  }

  const supabase = await createSupabaseServerClient();

  // Create junction records with positions
  const records: ArticleSourceInsertType[] = sourceIds.map((sourceId, index) => ({
    explanation_id: explanationId,
    source_cache_id: sourceId,
    position: index + 1
  }));

  // Validate all records
  for (const record of records) {
    const validationResult = articleSourceInsertSchema.safeParse(record);
    if (!validationResult.success) {
      throw new Error(`Invalid article source data: ${validationResult.error.message}`);
    }
  }

  const { error } = await supabase
    .from('article_sources')
    .insert(records);

  if (error) throw error;

  logger.info('linkSourcesToExplanation: Linked sources', {
    explanationId,
    sourceCount: sourceIds.length
  });
}

/**
 * Get all sources for an explanation
 *
 * • Returns sources in position order
 * • Joins source_cache data
 */
async function getSourcesByExplanationIdImpl(
  explanationId: number
): Promise<SourceCacheFullType[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('article_sources')
    .select(`
      position,
      source_cache (*)
    `)
    .eq('explanation_id', explanationId)
    .order('position');

  if (error) throw error;

  // Extract and return source_cache data in order
  return (data || [])
    .map(record => record.source_cache as unknown as SourceCacheFullType)
    .filter(Boolean);
}

/**
 * Remove all sources from an explanation
 */
async function unlinkSourcesFromExplanationImpl(
  explanationId: number
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('article_sources')
    .delete()
    .eq('explanation_id', explanationId);

  if (error) throw error;
}

// Wrap all async functions with automatic logging for entry/exit/timing
export const insertSourceCache = withLogging(
  insertSourceCacheImpl,
  'insertSourceCache',
  { logErrors: true }
);

export const getSourceByUrl = withLogging(
  getSourceByUrlImpl,
  'getSourceByUrl',
  { logErrors: true }
);

export const getSourceById = withLogging(
  getSourceByIdImpl,
  'getSourceById',
  { logErrors: true }
);

export const updateSourceCache = withLogging(
  updateSourceCacheImpl,
  'updateSourceCache',
  { logErrors: true }
);

// Note: isSourceExpired is sync and already exported at its definition

export const getOrCreateCachedSource = withLogging(
  getOrCreateCachedSourceImpl,
  'getOrCreateCachedSource',
  { logErrors: true }
);

export const linkSourcesToExplanation = withLogging(
  linkSourcesToExplanationImpl,
  'linkSourcesToExplanation',
  { logErrors: true }
);

export const getSourcesByExplanationId = withLogging(
  getSourcesByExplanationIdImpl,
  'getSourcesByExplanationId',
  { logErrors: true }
);

export const unlinkSourcesFromExplanation = withLogging(
  unlinkSourcesFromExplanationImpl,
  'unlinkSourcesFromExplanation',
  { logErrors: true }
);
