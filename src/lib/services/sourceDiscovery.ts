/**
 * Service for discovering and ranking sources across the platform.
 * Provides leaderboard queries (top sources by citation count), domain grouping,
 * popular-by-topic discovery, and similar-article source suggestions.
 */

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { type SourceCitationCountType, type SourceCacheFullType } from '@/lib/schemas/schemas';
import { getSourcesByExplanationId } from './sourceCache';
import { loadFromPineconeUsingExplanationId, searchForSimilarVectors } from './vectorsim';

export type TimePeriodFilter = 'week' | 'month' | 'year' | 'all';
export type SourceSortMode = 'citations' | 'domain' | 'recent';

export interface SourceLeaderboardFilters {
  period: TimePeriodFilter;
  sort: SourceSortMode;
  limit?: number;
}

// --------------------------------------------------------------------------
// getTopSources — Fetches ranked sources using the get_source_citation_counts RPC
// --------------------------------------------------------------------------

async function getTopSourcesImpl(
  filters: SourceLeaderboardFilters
): Promise<SourceCitationCountType[]> {
  const supabase = await createSupabaseServerClient();
  const limit = filters.limit ?? 50;

  const { data, error } = await supabase.rpc('get_source_citation_counts', {
    p_period: filters.period,
    p_limit: limit,
  });

  if (error) throw error;
  if (!data) return [];

  const rows = data as SourceCitationCountType[];

  // Client-side sort (RPC returns by citation count desc by default)
  if (filters.sort === 'domain') {
    rows.sort((a, b) => a.domain.localeCompare(b.domain));
  }
  // 'citations' and 'recent' use the default RPC order

  return rows;
}

export const getTopSources = withLogging(getTopSourcesImpl, 'getTopSources', { logErrors: true });

// --------------------------------------------------------------------------
// getSourcesByDomain — Fetches all sources for a specific domain
// --------------------------------------------------------------------------

async function getSourcesByDomainImpl(
  domain: string,
  limit: number = 20
): Promise<SourceCitationCountType[]> {
  const supabase = await createSupabaseServerClient();

  // Use the same RPC with a high limit, then filter client-side by domain.
  // A dedicated RPC would be more efficient at scale, but this keeps the MVP simple.
  const { data, error } = await supabase.rpc('get_source_citation_counts', {
    p_period: 'all',
    p_limit: 200,
  });

  if (error) throw error;
  if (!data) return [];

  return (data as SourceCitationCountType[])
    .filter(row => row.domain === domain)
    .slice(0, limit);
}

export const getSourcesByDomain = withLogging(getSourcesByDomainImpl, 'getSourcesByDomain', { logErrors: true });

// --------------------------------------------------------------------------
// Discovery: suggested source type returned by discovery functions
// --------------------------------------------------------------------------

export interface DiscoveredSource {
  source_cache_id: number;
  url: string;
  domain: string;
  title: string | null;
  favicon_url: string | null;
  frequency: number;  // how many times this source appears across the set
}

// --------------------------------------------------------------------------
// getPopularSourcesByTopic — Sources most cited in explanations sharing a topic
// --------------------------------------------------------------------------

async function getPopularSourcesByTopicImpl(
  topicId: number,
  limit: number = 10
): Promise<DiscoveredSource[]> {
  const supabase = await createSupabaseServerClient();

  // Find explanations in this topic, then aggregate their sources
  const { data: explanations, error: expError } = await supabase
    .from('explanations')
    .select('id')
    .or(`primary_topic_id.eq.${topicId},secondary_topic_id.eq.${topicId}`)
    .limit(50);

  if (expError) throw expError;
  if (!explanations || explanations.length === 0) return [];

  const explanationIds = explanations.map(e => e.id);

  // Get all article_sources for these explanations
  const { data: links, error: linkError } = await supabase
    .from('article_sources')
    .select('source_cache_id')
    .in('explanation_id', explanationIds);

  if (linkError) throw linkError;
  if (!links || links.length === 0) return [];

  // Count frequency of each source
  const freq = new Map<number, number>();
  for (const link of links) {
    freq.set(link.source_cache_id, (freq.get(link.source_cache_id) || 0) + 1);
  }

  // Sort by frequency, take top N
  const topIds = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  // Fetch source details
  const { data: sources, error: srcError } = await supabase
    .from('source_cache')
    .select('id, url, domain, title, favicon_url')
    .in('id', topIds.map(([id]) => id));

  if (srcError) throw srcError;
  if (!sources) return [];

  // Build result with frequency, preserving freq sort order
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  return topIds
    .map(([id, count]) => {
      const src = sourceMap.get(id);
      if (!src) return null;
      return {
        source_cache_id: src.id,
        url: src.url,
        domain: src.domain,
        title: src.title,
        favicon_url: src.favicon_url,
        frequency: count,
      };
    })
    .filter((s): s is DiscoveredSource => s !== null);
}

export const getPopularSourcesByTopic = withLogging(
  getPopularSourcesByTopicImpl, 'getPopularSourcesByTopic', { logErrors: true }
);

// --------------------------------------------------------------------------
// getSimilarArticleSources — Sources from explanations semantically similar
// --------------------------------------------------------------------------

async function getSimilarArticleSourcesImpl(
  explanationId: number,
  limit: number = 10
): Promise<DiscoveredSource[]> {
  // Step 1: Get the current explanation's vector
  const vectorResult = await loadFromPineconeUsingExplanationId(explanationId);
  if (!vectorResult?.values) return [];

  // Step 2: Find similar explanations using the vector
  const similarMatches = await searchForSimilarVectors(
    vectorResult.values,
    false,   // isAnchor
    null,    // anchorSet
    10,      // topK
    'default'
  );

  if (!similarMatches || similarMatches.length === 0) return [];

  // Extract explanation IDs from matches (exclude self)
  const similarExplanationIds = similarMatches
    .filter(m => m.metadata?.explanation_id && m.metadata.explanation_id !== explanationId)
    .map(m => m.metadata!.explanation_id as number)
    .slice(0, 5);

  if (similarExplanationIds.length === 0) return [];

  // Step 3: Get sources for each similar explanation
  const allSources: SourceCacheFullType[] = [];
  for (const simId of similarExplanationIds) {
    try {
      const sources = await getSourcesByExplanationId(simId);
      allSources.push(...sources);
    } catch {
      // Skip explanations that fail to load sources
    }
  }

  if (allSources.length === 0) return [];

  // Step 4: Deduplicate and rank by frequency
  const freq = new Map<number, { source: SourceCacheFullType; count: number }>();
  for (const src of allSources) {
    const existing = freq.get(src.id);
    if (existing) {
      existing.count++;
    } else {
      freq.set(src.id, { source: src, count: 1 });
    }
  }

  return [...freq.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(({ source, count }) => ({
      source_cache_id: source.id,
      url: source.url,
      domain: source.domain,
      title: source.title,
      favicon_url: source.favicon_url,
      frequency: count,
    }));
}

export const getSimilarArticleSources = withLogging(
  getSimilarArticleSourcesImpl, 'getSimilarArticleSources', { logErrors: true }
);

// --------------------------------------------------------------------------
// Source Profile — full metadata + citing articles + co-cited sources
// --------------------------------------------------------------------------

export interface SourceProfileData {
  source: SourceCacheFullType;
  citingArticles: { id: number; explanation_title: string; content: string }[];
  coCitedSources: DiscoveredSource[];
}

async function getSourceProfileImpl(
  sourceCacheId: number
): Promise<SourceProfileData | null> {
  const supabase = await createSupabaseServerClient();

  // Get source metadata
  const { data: source, error: srcError } = await supabase
    .from('source_cache')
    .select('*')
    .eq('id', sourceCacheId)
    .single();

  if (srcError || !source) return null;

  // Get citing articles
  const { data: links } = await supabase
    .from('article_sources')
    .select('explanation_id')
    .eq('source_cache_id', sourceCacheId);

  let citingArticles: SourceProfileData['citingArticles'] = [];
  if (links && links.length > 0) {
    const explanationIds = links.map(l => l.explanation_id);
    const { data: explanations } = await supabase
      .from('explanations')
      .select('id, explanation_title, content')
      .in('id', explanationIds)
      .eq('status', 'published')
      .limit(20);

    citingArticles = explanations || [];
  }

  // Get co-cited sources
  let coCitedSources: DiscoveredSource[] = [];
  const { data: coCited, error: coError } = await supabase.rpc('get_co_cited_sources', {
    p_source_id: sourceCacheId,
    p_limit: 10,
  });

  if (!coError && coCited) {
    coCitedSources = (coCited as { source_cache_id: number; co_citation_count: number; domain: string; title: string | null; favicon_url: string | null; url: string }[]).map(row => ({
      source_cache_id: row.source_cache_id,
      url: row.url || '',
      domain: row.domain,
      title: row.title,
      favicon_url: row.favicon_url,
      frequency: Number(row.co_citation_count),
    }));
  }

  return { source: source as SourceCacheFullType, citingArticles, coCitedSources };
}

export const getSourceProfile = withLogging(
  getSourceProfileImpl, 'getSourceProfile', { logErrors: true }
);
