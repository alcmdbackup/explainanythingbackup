'use server'

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { callOpenAIModel, default_model } from '@/lib/services/llms';
import { createStandaloneTitlePrompt } from '@/lib/prompts';
import { assertUserId } from '@/lib/utils/validation';
import {
  linkWhitelistInsertSchema,
  linkAliasInsertSchema,
  articleHeadingLinkInsertSchema,
  multipleStandaloneTitlesSchema,
  type LinkWhitelistInsertType,
  type LinkWhitelistFullType,
  type LinkAliasInsertType,
  type LinkAliasFullType,
  type MultipleStandaloneTitlesType,
  type WhitelistCacheEntryType,
  type LinkWhitelistSnapshotType
} from '@/lib/schemas/schemas';

/**
 * Service for managing the link whitelist system
 *
 * Provides CRUD operations for whitelist terms, aliases, heading link cache,
 * and snapshot management for efficient lookups.
 */

// ============================================================================
// WHITELIST CRUD OPERATIONS
// ============================================================================

/**
 * Create a new whitelist term
 *
 * • Validates input against linkWhitelistInsertSchema
 * • Checks for existing term with same canonical_term_lower
 * • Returns existing term if duplicate found
 * • Calls rebuildSnapshot() after successful insert
 */
export async function createWhitelistTerm(
  term: LinkWhitelistInsertType
): Promise<LinkWhitelistFullType> {
  const supabase = await createSupabaseServerClient();

  // Validate input
  const validationResult = linkWhitelistInsertSchema.safeParse(term);
  if (!validationResult.success) {
    throw new Error(`Invalid whitelist term data: ${validationResult.error.message}`);
  }

  const validatedTerm = validationResult.data;
  const termLower = validatedTerm.canonical_term.toLowerCase();

  // Check for existing term (idempotency)
  const { data: existing, error: selectError } = await supabase
    .from('link_whitelist')
    .select()
    .eq('canonical_term_lower', termLower)
    .single();

  if (selectError && selectError.code !== 'PGRST116') throw selectError;
  if (existing) return existing;

  // Insert new term
  const { data, error } = await supabase
    .from('link_whitelist')
    .insert({
      ...validatedTerm,
      canonical_term_lower: termLower
    })
    .select()
    .single();

  if (error) throw error;

  // Rebuild snapshot after insert
  await rebuildSnapshot();

  return data;
}

/**
 * Get all active whitelist terms
 *
 * • Returns only terms with is_active = true
 * • Orders by canonical_term for consistent results
 */
export async function getAllActiveWhitelistTerms(): Promise<LinkWhitelistFullType[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('link_whitelist')
    .select()
    .eq('is_active', true)
    .order('canonical_term');

  if (error) throw error;
  return data || [];
}

/**
 * Update an existing whitelist term
 *
 * • Validates partial updates against schema
 * • Updates canonical_term_lower if canonical_term is changed
 * • Calls rebuildSnapshot() after successful update
 */
export async function updateWhitelistTerm(
  id: number,
  updates: Partial<LinkWhitelistInsertType>
): Promise<LinkWhitelistFullType> {
  const supabase = await createSupabaseServerClient();

  // Validate partial updates
  const validationResult = linkWhitelistInsertSchema.partial().safeParse(updates);
  if (!validationResult.success) {
    throw new Error(`Invalid whitelist update data: ${validationResult.error.message}`);
  }

  const validatedUpdates = validationResult.data;

  // If canonical_term is being updated, also update the lowercase version
  const updateData: Record<string, unknown> = { ...validatedUpdates };
  if (validatedUpdates.canonical_term) {
    updateData.canonical_term_lower = validatedUpdates.canonical_term.toLowerCase();
  }

  const { data, error } = await supabase
    .from('link_whitelist')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  // Rebuild snapshot after update
  await rebuildSnapshot();

  return data;
}

/**
 * Delete a whitelist term
 *
 * • Cascades to delete associated aliases (via foreign key)
 * • Calls rebuildSnapshot() after successful delete
 */
export async function deleteWhitelistTerm(id: number): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('link_whitelist')
    .delete()
    .eq('id', id);

  if (error) throw error;

  // Rebuild snapshot after delete
  await rebuildSnapshot();
}

// ============================================================================
// ALIAS MANAGEMENT
// ============================================================================

/**
 * Add multiple aliases to a whitelist term
 *
 * • Validates each alias against linkAliasInsertSchema
 * • Skips duplicates (by alias_term_lower)
 * • Calls rebuildSnapshot() after successful inserts
 */
export async function addAliases(
  whitelistId: number,
  aliases: string[]
): Promise<LinkAliasFullType[]> {
  const supabase = await createSupabaseServerClient();

  if (aliases.length === 0) return [];

  // Prepare alias records
  const aliasRecords: Array<LinkAliasInsertType & { alias_term_lower: string }> = [];
  for (const alias of aliases) {
    const aliasData: LinkAliasInsertType = {
      whitelist_id: whitelistId,
      alias_term: alias.trim()
    };

    const validationResult = linkAliasInsertSchema.safeParse(aliasData);
    if (!validationResult.success) {
      logger.error('Invalid alias data', { error: validationResult.error.message });
      throw new Error(`Invalid alias data: ${validationResult.error.message}`);
    }

    aliasRecords.push({
      ...validationResult.data,
      alias_term_lower: validationResult.data.alias_term.toLowerCase()
    });
  }

  // Get existing aliases for deduplication
  const aliasLowers = aliasRecords.map(a => a.alias_term_lower);
  const { data: existingAliases, error: selectError } = await supabase
    .from('link_whitelist_aliases')
    .select()
    .in('alias_term_lower', aliasLowers);

  if (selectError) throw selectError;

  // Filter out existing aliases
  const existingLowers = new Set(existingAliases?.map(a => a.alias_term_lower) || []);
  const newAliases = aliasRecords.filter(a => !existingLowers.has(a.alias_term_lower));

  if (newAliases.length === 0) {
    return existingAliases || [];
  }

  // Insert new aliases
  const { data, error } = await supabase
    .from('link_whitelist_aliases')
    .insert(newAliases)
    .select();

  if (error) throw error;

  // Rebuild snapshot after adding aliases
  await rebuildSnapshot();

  return [...(existingAliases || []), ...(data || [])];
}

/**
 * Remove a single alias by ID
 *
 * • Calls rebuildSnapshot() after successful delete
 */
export async function removeAlias(aliasId: number): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('link_whitelist_aliases')
    .delete()
    .eq('id', aliasId);

  if (error) throw error;

  // Rebuild snapshot after delete
  await rebuildSnapshot();
}

// ============================================================================
// WHITELIST LOOKUP MAP
// ============================================================================

/**
 * Build a lookup map of all active whitelist terms including aliases
 *
 * • Returns Map where keys are lowercase terms/aliases
 * • Values contain canonical_term and standalone_title
 * • Aliases are resolved to their parent whitelist entry
 */
export async function getActiveWhitelistAsMap(): Promise<Map<string, WhitelistCacheEntryType>> {
  const supabase = await createSupabaseServerClient();

  // Get all active whitelist terms
  const { data: terms, error: termsError } = await supabase
    .from('link_whitelist')
    .select()
    .eq('is_active', true);

  if (termsError) throw termsError;

  // Get all aliases for active terms
  const activeIds = (terms || []).map(t => t.id);
  const { data: aliases, error: aliasesError } = await supabase
    .from('link_whitelist_aliases')
    .select()
    .in('whitelist_id', activeIds.length > 0 ? activeIds : [-1]);

  if (aliasesError) throw aliasesError;

  // Build lookup map
  const map = new Map<string, WhitelistCacheEntryType>();

  // Add canonical terms
  for (const term of terms || []) {
    map.set(term.canonical_term_lower, {
      canonical_term: term.canonical_term,
      standalone_title: term.standalone_title
    });
  }

  // Build term lookup for alias resolution
  const termById = new Map(
    (terms || []).map(t => [t.id, { canonical_term: t.canonical_term, standalone_title: t.standalone_title }])
  );

  // Add aliases (resolved to their parent canonical term)
  for (const alias of aliases || []) {
    const parent = termById.get(alias.whitelist_id);
    if (parent) {
      map.set(alias.alias_term_lower, parent);
    }
  }

  return map;
}

/**
 * Rebuild the whitelist snapshot cache
 *
 * • Builds fresh snapshot from link_whitelist and link_whitelist_aliases tables
 * • Atomically increments version number
 * • Stores in link_whitelist_snapshot table (single row, id=1)
 */
export async function rebuildSnapshot(): Promise<LinkWhitelistSnapshotType> {
  const supabase = await createSupabaseServerClient();

  // Get current version
  const { data: current } = await supabase
    .from('link_whitelist_snapshot')
    .select()
    .eq('id', 1)
    .single();

  const newVersion = (current?.version ?? 0) + 1;

  // Build fresh data
  const whitelistMap = await getActiveWhitelistAsMap();
  const snapshotData: Record<string, WhitelistCacheEntryType> = Object.fromEntries(whitelistMap);

  // Upsert snapshot
  const { data, error } = await supabase
    .from('link_whitelist_snapshot')
    .upsert({
      id: 1,
      version: newVersion,
      data: snapshotData,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

/**
 * Get the current snapshot cache
 *
 * • Returns cached snapshot if exists
 * • Rebuilds snapshot if not found
 */
export async function getSnapshot(): Promise<LinkWhitelistSnapshotType> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('link_whitelist_snapshot')
    .select()
    .eq('id', 1)
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  // If no snapshot exists, rebuild it
  if (!data) {
    return await rebuildSnapshot();
  }

  return data;
}

// ============================================================================
// HEADING LINK CACHE
// ============================================================================

/**
 * Get cached heading links for an article
 *
 * • Returns Map of heading_text_lower → standalone_title
 * • Empty map if no cached headings found
 */
export async function getHeadingLinksForArticle(
  explanationId: number
): Promise<Map<string, string>> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('article_heading_links')
    .select()
    .eq('explanation_id', explanationId);

  if (error) throw error;

  const map = new Map<string, string>();
  for (const item of data || []) {
    map.set(item.heading_text_lower, item.standalone_title);
  }

  return map;
}

/**
 * Save heading links for an article (upsert)
 *
 * • Takes Record<string, string> mapping heading_text → standalone_title
 * • Upserts each heading (updates if exists, inserts if not)
 * • Does NOT delete headings not in the new set (additive)
 */
export async function saveHeadingLinks(
  explanationId: number,
  headings: Record<string, string>
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  if (Object.keys(headings).length === 0) return;

  // Prepare records
  const records = Object.entries(headings).map(([headingText, standaloneTitle]) => {
    const record = {
      explanation_id: explanationId,
      heading_text: headingText.trim(),
      heading_text_lower: headingText.trim().toLowerCase(),
      standalone_title: standaloneTitle.trim()
    };

    // Validate
    const validation = articleHeadingLinkInsertSchema.safeParse({
      explanation_id: record.explanation_id,
      heading_text: record.heading_text,
      standalone_title: record.standalone_title
    });

    if (!validation.success) {
      throw new Error(`Invalid heading link data: ${validation.error.message}`);
    }

    return record;
  });

  // Upsert each heading link
  const { error } = await supabase
    .from('article_heading_links')
    .upsert(records, {
      onConflict: 'explanation_id,heading_text_lower',
      ignoreDuplicates: false
    });

  if (error) throw error;
}

/**
 * Delete all heading links for an article
 *
 * • Used when article content changes significantly
 */
export async function deleteHeadingLinksForArticle(explanationId: number): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('article_heading_links')
    .delete()
    .eq('explanation_id', explanationId);

  if (error) throw error;
}

/**
 * Generate standalone titles for headings using AI
 *
 * • Extracts h2 and h3 headings from content
 * • Calls LLM to generate standalone titles
 * • Returns Record<string, string> mapping heading text → standalone title
 * • Does NOT save to DB (caller should use saveHeadingLinks)
 */
export async function generateHeadingStandaloneTitles(
  content: string,
  articleTitle: string,
  userid: string,
  debug: boolean = false
): Promise<Record<string, string>> {
  assertUserId(userid, 'generateHeadingStandaloneTitles');
  // Regex to match h2 and h3 headings
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const matches = [...content.matchAll(headingRegex)];

  if (matches.length === 0) {
    if (debug) {
      logger.debug('No headings found to generate standalone titles');
    }
    return {};
  }

  // Extract heading texts
  const headingTexts = matches.map(match => match[2].trim());

  if (debug) {
    logger.debug(`Generating standalone titles for ${headingTexts.length} headings`, {
      articleTitle,
      headings: headingTexts
    });
  }

  try {
    if (!articleTitle?.trim()) {
      throw new Error('Article title is required');
    }

    const prompt = createStandaloneTitlePrompt(articleTitle, headingTexts);

    const aiResponse = await callOpenAIModel(
      prompt,
      'generateHeadingStandaloneTitles',
      userid,
      default_model,
      false,
      null,
      multipleStandaloneTitlesSchema,
      'multipleStandaloneTitles',
      debug
    );

    // Parse structured response
    const parsedResponse: MultipleStandaloneTitlesType = JSON.parse(aiResponse);
    const standaloneTitles = parsedResponse.titles.map(title =>
      title.trim().replace(/^["']|["']$/g, '')
    );

    // Build result mapping
    const result: Record<string, string> = {};
    for (let i = 0; i < headingTexts.length; i++) {
      const headingText = headingTexts[i];
      const standaloneTitle = standaloneTitles[i];

      if (standaloneTitle) {
        result[headingText] = standaloneTitle;

        if (debug) {
          logger.debug('Generated heading title', {
            heading: headingText,
            standalone: standaloneTitle
          });
        }
      }
    }

    if (debug) {
      logger.debug('Heading title generation complete', {
        totalHeadings: headingTexts.length,
        successfulTitles: Object.keys(result).length
      });
    }

    return result;

  } catch (error) {
    if (debug) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error generating heading standalone titles: ${errorMessage}`);
    }

    // Fallback: return empty mappings if generation fails
    return {};
  }
}

/**
 * Get aliases for a specific whitelist term
 */
export async function getAliasesForTerm(whitelistId: number): Promise<LinkAliasFullType[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('link_whitelist_aliases')
    .select()
    .eq('whitelist_id', whitelistId)
    .order('alias_term');

  if (error) throw error;
  return data || [];
}

/**
 * Get a whitelist term by ID
 */
export async function getWhitelistTermById(id: number): Promise<LinkWhitelistFullType> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('link_whitelist')
    .select()
    .eq('id', id)
    .single();

  if (error) throw error;
  if (!data) {
    throw new Error(`Whitelist term not found for ID: ${id}`);
  }

  return data;
}
