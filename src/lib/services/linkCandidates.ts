import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { createWhitelistTerm } from '@/lib/services/linkWhitelist';
import {
  CandidateStatus,
  type LinkCandidateFullType,
  type CandidateOccurrenceFullType,
} from '@/lib/schemas/schemas';
import { logger } from '@/lib/server_utilities';
import { withLogging } from '@/lib/logging/server/automaticServerLoggingBase';

/**
 * Service for managing link candidates
 *
 * Provides CRUD operations for candidates, occurrence tracking,
 * and approval workflow integration with the whitelist system.
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Escape special regex characters in a string
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count occurrences of a term in content (case-insensitive, word boundary)
 */
export function countTermOccurrences(content: string, term: string): number {
  const regex = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

// ============================================================================
// CANDIDATE CRUD OPERATIONS
// ============================================================================

/**
 * Upsert a candidate term
 *
 * • If term_lower exists, returns existing candidate
 * • Otherwise inserts new candidate with first_seen_explanation_id
 */
async function upsertCandidateImpl(
  term: string,
  explanationId: number
): Promise<LinkCandidateFullType> {
  const supabase = await createSupabaseServerClient();
  const termLower = term.toLowerCase();

  // Check for existing candidate
  const { data: existing, error: selectError } = await supabase
    .from('link_candidates')
    .select()
    .eq('term_lower', termLower)
    .single();

  if (selectError && selectError.code !== 'PGRST116') throw selectError;
  if (existing) return existing;

  // Insert new candidate
  const { data, error } = await supabase
    .from('link_candidates')
    .insert({
      term,
      term_lower: termLower,
      source: 'llm',
      status: 'pending',
      first_seen_explanation_id: explanationId,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get a candidate by ID
 */
async function getCandidateByIdImpl(id: number): Promise<LinkCandidateFullType> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('link_candidates')
    .select()
    .eq('id', id)
    .single();

  if (error) throw error;
  if (!data) throw new Error(`Candidate not found for ID: ${id}`);

  return data;
}

/**
 * Get all candidates, optionally filtered by status
 */
async function getAllCandidatesImpl(
  status?: CandidateStatus
): Promise<LinkCandidateFullType[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from('link_candidates')
    .select()
    .order('total_occurrences', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data || [];
}

/**
 * Delete a candidate by ID
 *
 * • Cascades to delete associated occurrences
 */
async function deleteCandidateImpl(id: number): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('link_candidates')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ============================================================================
// OCCURRENCE TRACKING
// ============================================================================

/**
 * Insert or update an occurrence record
 */
async function upsertOccurrenceImpl(
  candidateId: number,
  explanationId: number,
  count: number
): Promise<CandidateOccurrenceFullType> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('candidate_occurrences')
    .upsert(
      {
        candidate_id: candidateId,
        explanation_id: explanationId,
        occurrence_count: count,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'candidate_id,explanation_id',
        ignoreDuplicates: false,
      }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get occurrences for a specific explanation
 */
async function getOccurrencesForExplanationImpl(
  explanationId: number
): Promise<CandidateOccurrenceFullType[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('candidate_occurrences')
    .select()
    .eq('explanation_id', explanationId);

  if (error) throw error;
  return data || [];
}

/**
 * Recalculate aggregate fields for all candidates
 *
 * Updates total_occurrences and article_count based on candidate_occurrences
 */
async function recalculateCandidateAggregatesImpl(): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // Get all candidates
  const { data: candidates, error: candidatesError } = await supabase
    .from('link_candidates')
    .select('id');

  if (candidatesError) throw candidatesError;

  // Update each candidate's aggregates
  for (const candidate of candidates || []) {
    const { data: occurrences, error: occError } = await supabase
      .from('candidate_occurrences')
      .select('occurrence_count')
      .eq('candidate_id', candidate.id);

    if (occError) throw occError;

    const totalOccurrences = (occurrences || []).reduce(
      (sum, occ) => sum + occ.occurrence_count,
      0
    );
    const articleCount = (occurrences || []).length;

    const { error: updateError } = await supabase
      .from('link_candidates')
      .update({
        total_occurrences: totalOccurrences,
        article_count: articleCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', candidate.id);

    if (updateError) throw updateError;
  }
}

/**
 * Recalculate aggregates for a specific candidate
 */
async function recalculateSingleCandidateAggregatesImpl(candidateId: number): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { data: occurrences, error: occError } = await supabase
    .from('candidate_occurrences')
    .select('occurrence_count')
    .eq('candidate_id', candidateId);

  if (occError) throw occError;

  const totalOccurrences = (occurrences || []).reduce(
    (sum, occ) => sum + occ.occurrence_count,
    0
  );
  const articleCount = (occurrences || []).length;

  const { error: updateError } = await supabase
    .from('link_candidates')
    .update({
      total_occurrences: totalOccurrences,
      article_count: articleCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', candidateId);

  if (updateError) throw updateError;
}

// ============================================================================
// HIGH-LEVEL OPERATIONS
// ============================================================================

/**
 * Save candidates from LLM extraction (called on new article creation)
 *
 * • Upserts each candidate
 * • Counts occurrences in content
 * • Creates occurrence records
 * • Recalculates aggregates for affected candidates
 */
async function saveCandidatesFromLLMImpl(
  explanationId: number,
  content: string,
  candidates: string[],
  debug: boolean = false
): Promise<void> {
  if (candidates.length === 0) {
    if (debug) {
      logger.debug('No candidates to save');
    }
    return;
  }

  if (debug) {
    logger.debug(`Saving ${candidates.length} candidates for explanation ${explanationId}`);
  }

  const affectedCandidateIds: number[] = [];

  for (const term of candidates) {
    try {
      const count = countTermOccurrences(content, term);
      const candidate = await upsertCandidateImpl(term, explanationId);
      await upsertOccurrenceImpl(candidate.id, explanationId, count);
      affectedCandidateIds.push(candidate.id);

      if (debug) {
        logger.debug(`Saved candidate "${term}" with ${count} occurrences`);
      }
    } catch (error) {
      logger.error(`Error saving candidate "${term}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Recalculate aggregates for affected candidates
  for (const candidateId of affectedCandidateIds) {
    await recalculateSingleCandidateAggregatesImpl(candidateId);
  }
}

/**
 * Update occurrences for an article (called on edit)
 *
 * • Gets existing occurrences for the explanation
 * • Re-counts occurrences of each linked candidate
 * • Updates occurrence records
 * • Recalculates aggregates
 *
 * Note: Does NOT generate new candidates on edit - only updates counts
 */
async function updateOccurrencesForArticleImpl(
  explanationId: number,
  content: string,
  debug: boolean = false
): Promise<void> {
  const existingOccurrences = await getOccurrencesForExplanationImpl(explanationId);

  if (existingOccurrences.length === 0) {
    if (debug) {
      logger.debug(`No existing occurrences for explanation ${explanationId}`);
    }
    return;
  }

  if (debug) {
    logger.debug(`Updating ${existingOccurrences.length} occurrences for explanation ${explanationId}`);
  }

  const affectedCandidateIds: number[] = [];

  for (const occ of existingOccurrences) {
    try {
      const candidate = await getCandidateByIdImpl(occ.candidate_id);
      const newCount = countTermOccurrences(content, candidate.term);
      await upsertOccurrenceImpl(occ.candidate_id, explanationId, newCount);
      affectedCandidateIds.push(occ.candidate_id);

      if (debug) {
        logger.debug(`Updated occurrence for "${candidate.term}": ${newCount}`);
      }
    } catch (error) {
      logger.error(`Error updating occurrence ${occ.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Recalculate aggregates for affected candidates
  for (const candidateId of affectedCandidateIds) {
    await recalculateSingleCandidateAggregatesImpl(candidateId);
  }
}

// ============================================================================
// APPROVAL WORKFLOW
// ============================================================================

/**
 * Approve a candidate
 *
 * • Creates a whitelist entry with the provided standalone_title
 * • Updates candidate status to 'approved'
 */
async function approveCandidateImpl(
  id: number,
  standaloneTitle: string
): Promise<LinkCandidateFullType> {
  const supabase = await createSupabaseServerClient();

  // Get the candidate
  const candidate = await getCandidateByIdImpl(id);

  // Create whitelist entry
  await createWhitelistTerm({
    canonical_term: candidate.term,
    standalone_title: standaloneTitle,
    is_active: true,
  });

  // Update candidate status
  const { data, error } = await supabase
    .from('link_candidates')
    .update({
      status: 'approved',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Reject a candidate
 *
 * • Updates candidate status to 'rejected'
 * • Candidate is kept for deduplication purposes
 */
async function rejectCandidateImpl(id: number): Promise<LinkCandidateFullType> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('link_candidates')
    .update({
      status: 'rejected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Wrap async functions with automatic logging for entry/exit/timing
export const upsertCandidate = withLogging(
  upsertCandidateImpl,
  'upsertCandidate',
  { logErrors: true }
);

export const getCandidateById = withLogging(
  getCandidateByIdImpl,
  'getCandidateById',
  { logErrors: true }
);

export const getAllCandidates = withLogging(
  getAllCandidatesImpl,
  'getAllCandidates',
  { logErrors: true }
);

export const deleteCandidate = withLogging(
  deleteCandidateImpl,
  'deleteCandidate',
  { logErrors: true }
);

export const upsertOccurrence = withLogging(
  upsertOccurrenceImpl,
  'upsertOccurrence',
  { logErrors: true }
);

export const getOccurrencesForExplanation = withLogging(
  getOccurrencesForExplanationImpl,
  'getOccurrencesForExplanation',
  { logErrors: true }
);

export const recalculateCandidateAggregates = withLogging(
  recalculateCandidateAggregatesImpl,
  'recalculateCandidateAggregates',
  { logErrors: true }
);

export const saveCandidatesFromLLM = withLogging(
  saveCandidatesFromLLMImpl,
  'saveCandidatesFromLLM',
  { logErrors: true }
);

export const updateOccurrencesForArticle = withLogging(
  updateOccurrencesForArticleImpl,
  'updateOccurrencesForArticle',
  { logErrors: true }
);

export const approveCandidate = withLogging(
  approveCandidateImpl,
  'approveCandidate',
  { logErrors: true }
);

export const rejectCandidate = withLogging(
  rejectCandidateImpl,
  'rejectCandidate',
  { logErrors: true }
);
