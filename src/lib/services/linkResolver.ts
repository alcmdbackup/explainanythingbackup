'use server'

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

/**
 * Link Resolver Service
 *
 * Core of the link overlay system. Resolves links at render time by:
 * 1. Processing headings (always linked, cached AI-generated titles)
 * 2. Matching whitelist terms (first occurrence only)
 * 3. Applying per-article overrides (custom titles or disabled)
 */

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

  const beforeOk = startIndex === 0 || isBoundary(content[startIndex - 1]);
  const afterOk = endIndex >= content.length || isBoundary(content[endIndex]);

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
    headings.push(match[1].toLowerCase());
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
export async function getOverridesForArticle(
  explanationId: number
): Promise<Map<string, ArticleLinkOverrideFullType>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('article_link_overrides')
    .select()
    .eq('explanation_id', explanationId);

  if (error) throw error;

  const map = new Map<string, ArticleLinkOverrideFullType>();
  for (const item of data || []) {
    map.set(item.term_lower, item);
  }

  return map;
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
    headings.push({ match: { ...match, index: match.index } as RegExpExecArray, text: match[2] });
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
export async function resolveLinksForArticle(
  explanationId: number,
  content: string
): Promise<ResolvedLinkType[]> {
  const links: ResolvedLinkType[] = [];

  // === STEP 1: HEADINGS (always linked, processed first) ===
  const headingLinks = await resolveHeadingLinks(explanationId, content);
  links.push(...headingLinks);

  // Build exclusion zones from heading positions to prevent double-linking
  const headingRanges = headingLinks.map(h => ({ start: h.startIndex, end: h.endIndex }));

  // === STEP 2: KEY TERMS (whitelist only) ===
  const snapshot = await getSnapshot();
  const whitelist = new Map<string, WhitelistCacheEntryType>(
    Object.entries(snapshot.data)
  );

  const overrides = await getOverridesForArticle(explanationId);
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
