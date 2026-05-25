import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { encodeStandaloneTitleParam } from '@/lib/services/links';
import {
  getSnapshot,
  getHeadingLinksForArticle
} from '@/lib/services/linkWhitelist';
import {
  type ResolvedLinkType,
  type ArticleLinkOverrideFullType,
  LinkOverrideType,
  type WhitelistCacheEntryType
} from '@/lib/schemas/schemas';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';
import { logger } from '@/lib/server_utilities';

/**
 * Link Resolver Service
 *
 * Core of the link overlay system. Resolves links at render time by:
 * 1. Processing headings (always linked, cached AI-generated titles)
 * 2. Matching whitelist terms (first occurrence only)
 * 3. Applying per-article overrides (custom titles or disabled)
 */

// ============================================================================
// BYPASS-MODE CACHE (demo / LINKS_BYPASS_WHITELIST=true)
// ============================================================================

// Module-scope TTL cache for the merged (whitelist + approved candidates) map.
// The system already caches the whitelist via `link_whitelist_snapshot`; this
// mirror cache covers the bypass branch so it isn't a per-render DB hit against
// the candidates table.
type BypassCacheEntry = { value: Map<string, WhitelistCacheEntryType>; expiresAt: number };
let bypassMergedCache: BypassCacheEntry | null = null;
const BYPASS_CACHE_TTL_MS = 5 * 60 * 1000;

// Test-only: reset the cache between tests so env-var toggles take effect.
export function __resetBypassCacheForTests(): void {
  bypassMergedCache = null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if match is at word boundaries
 * Boundaries: whitespace, punctuation (except hyphen), start/end of string
 * Hyphens are NOT boundaries to avoid matching inside compound terms
 */
export function isWordBoundary(
  content: string,
  startIndex: number,
  endIndex: number
): boolean {
  // Boundary chars: whitespace and punctuation EXCEPT hyphen
  const isBoundary = (char: string) => /[\s.,;:!?()\[\]{}'\"<>\/]/.test(char);

  const beforeOk = startIndex === 0 || isBoundary(content[startIndex - 1]!);
  const afterOk = endIndex >= content.length || isBoundary(content[endIndex]!);

  return beforeOk && afterOk;
}

/**
 * Check if a range overlaps with an existing link
 */
export function overlaps(
  link: ResolvedLinkType,
  start: number,
  end: number
): boolean {
  return !(end <= link.startIndex || start >= link.endIndex);
}

/**
 * Extract heading texts from content (h2 and h3)
 * Returns lowercase heading texts for comparison
 */
export function extractHeadings(content: string): string[] {
  const regex = /^#{2,3}\s+(.+)$/gm;
  const headings: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    headings.push(match[1]!.toLowerCase());
  }
  return headings;
}

/**
 * Check if two heading arrays match
 */
export function headingsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((h, i) => h === b[i]);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// OVERRIDE FUNCTIONS
// ============================================================================

/**
 * Get per-article link overrides from database
 *
 * Returns Map of term_lower → override data
 */
async function getOverridesForArticleImpl(
  explanationId: number
): Promise<Map<string, ArticleLinkOverrideFullType>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('article_link_overrides')
    .select()
    .eq('explanation_id', explanationId);

  if (error) throw error;

  const map = new Map<string, ArticleLinkOverrideFullType>();
  for (const item of (data || []) as ArticleLinkOverrideFullType[]) {
    map.set(item.term_lower, item);
  }

  return map;
}

/**
 * Set an override for a term in a specific article
 *
 * @param explanationId - The article ID
 * @param term - The term to override
 * @param overrideType - 'custom_title' or 'disabled'
 * @param customTitle - The custom standalone title (required if overrideType is 'custom_title')
 */
async function setOverrideImpl(
  explanationId: number,
  term: string,
  overrideType: 'custom_title' | 'disabled',
  customTitle?: string
): Promise<ArticleLinkOverrideFullType> {
  const supabase = await createSupabaseServerClient();
  const termLower = term.toLowerCase();

  if (overrideType === 'custom_title' && !customTitle) {
    throw new Error('customTitle is required when overrideType is custom_title');
  }

  const { data, error } = await supabase
    .from('article_link_overrides')
    .upsert({
      explanation_id: explanationId,
      term: term,
      term_lower: termLower,
      override_type: overrideType,
      custom_standalone_title: overrideType === 'custom_title' ? customTitle : null
    }, {
      onConflict: 'explanation_id,term_lower'
    })
    .select()
    .single();

  if (error) throw error;
  return data as ArticleLinkOverrideFullType;
}

/**
 * Remove an override for a term in a specific article (revert to global default)
 */
async function removeOverrideImpl(
  explanationId: number,
  term: string
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const termLower = term.toLowerCase();

  const { error } = await supabase
    .from('article_link_overrides')
    .delete()
    .eq('explanation_id', explanationId)
    .eq('term_lower', termLower);

  if (error) throw error;
}

// ============================================================================
// HEADING LINK RESOLUTION
// ============================================================================

/**
 * Resolve heading links - NO AI calls at render time
 * Titles are pre-generated at creation time and stored in article_heading_links
 */
async function resolveHeadingLinks(
  explanationId: number,
  content: string
): Promise<ResolvedLinkType[]> {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: { match: RegExpExecArray; text: string }[] = [];

  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({ match: { ...match, index: match.index } as RegExpExecArray, text: match[2]! });
  }

  if (headings.length === 0) return [];

  // Fetch ALL cached titles from DB (created at explanation creation time)
  const cachedTitles = await getHeadingLinksForArticle(explanationId);

  // Build resolved links - titles should always exist (created at save time)
  return headings.map(h => ({
    term: h.match[0],
    startIndex: h.match.index,
    endIndex: h.match.index + h.match[0].length,
    standaloneTitle: cachedTitles.get(h.text.toLowerCase()) ?? h.text, // fallback to raw heading
    type: 'heading' as const
  }));
}

// ============================================================================
// MAIN RESOLVER
// ============================================================================

/**
 * Resolve links for an article at render time
 *
 * Algorithm:
 * 1. Process HEADINGS first: Always linked, AI-generated titles (cached in DB)
 * 2. Process KEY TERMS: Only if in whitelist, excluding heading regions
 * 3. First occurrence only per key term
 * 4. Apply overrides
 *
 * @param explanationId - The explanation ID to resolve links for
 * @param content - The markdown content to resolve links in
 * @returns Array of resolved links sorted by position
 */
async function resolveLinksForArticleImpl(
  explanationId: number,
  content: string
): Promise<ResolvedLinkType[]> {
  const links: ResolvedLinkType[] = [];

  // === STEP 1: HEADINGS (always linked, processed first) ===
  const headingLinks = await resolveHeadingLinks(explanationId, content);
  links.push(...headingLinks);

  // Build exclusion zones from heading positions to prevent double-linking
  const headingRanges = headingLinks.map(h => ({ start: h.startIndex, end: h.endIndex }));

  // === STEP 2: KEY TERMS (whitelist, or whitelist ∪ approved candidates in bypass mode) ===
  const snapshot = await getSnapshot();
  let whitelist = new Map<string, WhitelistCacheEntryType>(
    Object.entries(snapshot.data)
  );

  // Demo bypass: merge approved candidates so inline links render even for
  // terms that haven't been admin-approved into link_whitelist. Module-scope
  // TTL cache (5 min) avoids a per-render DB hit against link_candidates.
  // Whitelist entries take precedence on collision (preserves any admin overrides).
  const bypassRaw = process.env.LINKS_BYPASS_WHITELIST;
  const bypassActive = bypassRaw === 'true';
  logger.info('linkResolver: bypass branch eval', {
    explanationId,
    bypassRaw,
    bypassActive,
    snapshotEntryCount: whitelist.size,
  });
  if (bypassActive) {
    if (bypassMergedCache && bypassMergedCache.expiresAt > Date.now()) {
      whitelist = bypassMergedCache.value;
      logger.info('linkResolver: bypass cache hit', {
        explanationId,
        mergedSize: whitelist.size,
      });
    } else {
      // link_candidates has no standalone_title column (only link_whitelist does,
      // populated at admin approval time). For the demo bypass, use the term itself
      // as the standalone_title — clicks route to /standalone-title?t=<encoded-term>
      // which triggers a search-or-generate on the term, which is the desired
      // demo behavior anyway.
      const supabase = await createSupabaseServerClient();
      const { data: candidates, error: candidatesError } = await supabase
        .from('link_candidates')
        .select('term, term_lower')
        .limit(2000); // safety cap
      logger.info('linkResolver: candidates fetch result', {
        explanationId,
        candidateCount: candidates?.length ?? 0,
        candidatesIsNull: candidates === null,
        errorMessage: candidatesError?.message ?? null,
        errorCode: candidatesError?.code ?? null,
        sampleTerms: (candidates ?? []).slice(0, 5).map((c) => c.term_lower),
      });
      const merged = new Map(whitelist);
      for (const c of candidates ?? []) {
        if (!merged.has(c.term_lower)) {
          merged.set(c.term_lower, {
            canonical_term: c.term,
            standalone_title: c.term, // self-titled — clicks search/generate for the term
          });
        }
      }
      bypassMergedCache = { value: merged, expiresAt: Date.now() + BYPASS_CACHE_TTL_MS };
      whitelist = merged;
      logger.info('linkResolver: bypass merge complete', {
        explanationId,
        mergedSize: merged.size,
      });
    }
  }

  const overrides = await getOverridesForArticleImpl(explanationId);
  const matchedTerms = new Set<string>();

  // Content in lowercase for matching
  const contentLower = content.toLowerCase();

  // Sort terms by length (longest first) to prioritize longer matches
  const sortedTerms = [...whitelist.entries()]
    .sort((a, b) => b[0].length - a[0].length);

  for (const [termLower, entry] of sortedTerms) {
    // First occurrence only
    if (matchedTerms.has(termLower)) continue;

    // Check for override
    const override = overrides.get(termLower);
    if (override?.override_type === LinkOverrideType.Disabled) {
      matchedTerms.add(termLower);
      continue;
    }

    // Find all occurrences using regex with word boundaries
    const escapedTerm = escapeRegex(termLower);
    const regex = new RegExp(escapedTerm, 'gi');
    let termMatch;

    while ((termMatch = regex.exec(contentLower)) !== null) {
      const startIndex = termMatch.index;
      const endIndex = startIndex + termMatch[0].length;

      // Skip if inside a heading region
      if (headingRanges.some(r => startIndex >= r.start && endIndex <= r.end)) {
        continue;
      }

      // Check word boundaries (regex \b doesn't work well for all cases)
      if (!isWordBoundary(content, startIndex, endIndex)) {
        continue;
      }

      // Skip if overlaps with already-matched term
      if (links.some(l => overlaps(l, startIndex, endIndex))) {
        continue;
      }

      // Found valid match - add to links
      links.push({
        term: content.slice(startIndex, endIndex), // Preserve original case
        startIndex,
        endIndex,
        standaloneTitle: override?.override_type === LinkOverrideType.CustomTitle && override.custom_standalone_title
          ? override.custom_standalone_title
          : entry.standalone_title,
        type: 'term'
      });

      matchedTerms.add(termLower);
      break; // First occurrence only
    }
  }

  // Sort by position
  return links.sort((a, b) => a.startIndex - b.startIndex);
}

// ============================================================================
// CONTENT APPLICATION
// ============================================================================

/**
 * Apply resolved links to content for display
 * Returns markdown with links inserted
 *
 * @param content - The original markdown content
 * @param links - Array of resolved links to apply
 * @returns Markdown content with links inserted
 */
export function applyLinksToContent(
  content: string,
  links: ResolvedLinkType[]
): string {
  if (links.length === 0) return content;

  // Apply from end to start to preserve positions
  let result = content;
  const sortedLinks = [...links].sort((a, b) => b.startIndex - a.startIndex);

  for (const link of sortedLinks) {
    const before = result.slice(0, link.startIndex);
    const after = result.slice(link.endIndex);
    const encoded = encodeStandaloneTitleParam(link.standaloneTitle);

    if (link.type === 'heading') {
      // For headings, wrap the text portion in a link (preserve the # prefix)
      const headingMatch = link.term.match(/^(#{2,3})\s+(.+)$/);
      if (headingMatch) {
        const hashes = headingMatch[1];
        const text = headingMatch[2];
        result = `${before}${hashes} [${text}](/standalone-title?t=${encoded})${after}`;
      } else {
        // Fallback: wrap entire term
        result = `${before}[${link.term}](/standalone-title?t=${encoded})${after}`;
      }
    } else {
      // For regular terms, just wrap the term
      result = `${before}[${link.term}](/standalone-title?t=${encoded})${after}`;
    }
  }

  return result;
}

// Wrap async functions with automatic logging for entry/exit/timing
export const getOverridesForArticle = withLogging(
  getOverridesForArticleImpl,
  'getOverridesForArticle',
  { logErrors: true }
);

export const setOverride = withLogging(
  setOverrideImpl,
  'setOverride',
  { logErrors: true }
);

export const removeOverride = withLogging(
  removeOverrideImpl,
  'removeOverride',
  { logErrors: true }
);

export const resolveLinksForArticle = withLogging(
  resolveLinksForArticleImpl,
  'resolveLinksForArticle',
  { logErrors: true }
);
